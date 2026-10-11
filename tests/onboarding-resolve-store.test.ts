import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SIGNATURES } from "@/lib/onboarding/resolve/exceptions";
import { isExistingRecordId, existingToRawRecords, rawRecordsFromImportRows, type ImportRowLike } from "@/lib/onboarding/resolve/from-import";
import { ruleFromAnswer } from "@/lib/onboarding/resolve/memory";
import { PAGE_SIZE, groupPayloads, itemPayloads, pagesOf, pairPayloads, recordPayloads, rulesFromRows, stagePayloads } from "@/lib/onboarding/resolve/payloads";
import {
  RESOLVE_ENGINE_VERSION,
  RPC,
  answerGroup,
  loadInbox,
  loadRuns,
  makeRunConfig,
  readImportRows,
  resolveImportRun,
  resolveStagedRun,
  revokeRule,
  stageRecords,
  type ResolveDb,
} from "@/lib/onboarding/resolve/store";
import { parseInbox, parseItemDetail, parseRuns } from "@/lib/onboarding/resolve/views";
import type { RawRecord } from "@/lib/onboarding/resolve/types";

import { buildGolden } from "./fixtures/onboarding-resolve/golden";
import { TODAY, rec, run } from "./fixtures/onboarding-resolve/helpers";

// ── The migrations, read as text (CRLF or LF) ─────────────────────────────────────────────────────────────────────────
const migrations = join(process.cwd(), "supabase", "migrations");
const sql = (prefix: string): string => {
  const file = readdirSync(migrations).find((f) => f.startsWith(prefix));
  if (!file) throw new Error(`no migration ${prefix}`);
  return readFileSync(join(migrations, file), "utf8").replace(/\r\n/g, "\n");
};

type CatalogRow = {
  signature: string;
  tier: string;
  answers: string[];
  rememberable: boolean;
  scope: string;
  route: string | null;
  money: boolean;
  sameForRest: boolean;
  scopes: string[];
  itemKind: string;
};

/** The rows the migration seeds into app.import_signatures. */
function catalogRows(): CatalogRow[] {
  const m0630 = sql("0630_");
  const re = /\('([a-z_]+)',\s*'([CD])',\s*array\[([^\]]*)\],\s*(true|false),\s*'([a-z_]+)',\s*(null|'[a-z]+'),\s*(true|false),\s*(true|false),\s*(array\[[^\]]*\]|'\{\}'::text\[\]),\s*'(pair|record)'\)/g;
  return [...m0630.matchAll(re)].map((m) => ({
    signature: m[1],
    tier: m[2],
    answers: [...m[3].matchAll(/'([a-z_]+)'/g)].map((a) => a[1]),
    rememberable: m[4] === "true",
    scope: m[5],
    route: m[6] === "null" ? null : m[6].replace(/'/g, ""),
    money: m[7] === "true",
    sameForRest: m[8] === "true",
    scopes: [...m[9].matchAll(/'([a-z_]+)'/g)].map((a) => a[1]),
    itemKind: m[10],
  }));
}

/** Where the database is deliberately stricter than the engine's SIGNATURES (the owner's recommendation, enforced now). */
const STRICTER_NOT_REMEMBERED = ["duplicate_gift_two_sources", "name_only"];
const STRICTER_NOT_IN_BULK = ["minor_record"];

describe("the database catalog and the engine say the same thing", () => {
  const m0630 = sql("0630_");
  const rows = catalogRows();

  it("lists every kind of question with the answers, scope, route and flags the engine has", () => {
    expect(rows.length).toBe(Object.keys(SIGNATURES).length);
    for (const r of rows) {
      const spec = SIGNATURES[r.signature as keyof typeof SIGNATURES];
      expect(spec, r.signature).toBeDefined();
      expect(r.tier, r.signature).toBe(spec.tier);
      expect(r.answers, r.signature).toEqual([...spec.answers]);
      expect(r.scope, r.signature).toBe(spec.defaultScope);
      expect(r.route, r.signature).toBe(spec.routeTo);
      expect(r.money, r.signature).toBe(spec.money);
    }
  });

  it("is never looser than the engine, and stricter in exactly the places it says it is", () => {
    const stricterRemember: string[] = [];
    const stricterBulk: string[] = [];
    for (const r of rows) {
      const spec = SIGNATURES[r.signature as keyof typeof SIGNATURES];
      if (r.rememberable) expect(spec.rememberable, `${r.signature} is remembered by the database only if the engine remembers it`).toBe(true);
      else if (spec.rememberable) stricterRemember.push(r.signature);
      if (r.sameForRest) expect(spec.sameForRest, `${r.signature} is answered in bulk by the database only if the engine allows it`).toBe(true);
      else if (spec.sameForRest) stricterBulk.push(r.signature);
    }
    expect(stricterRemember.sort()).toEqual(STRICTER_NOT_REMEMBERED);
    expect(stricterBulk.sort()).toEqual(STRICTER_NOT_IN_BULK);
  });

  it("never remembers money, a name alone, or a held kind; and says how widely each kind may be remembered", () => {
    for (const r of rows) {
      if (r.money || r.tier === "D" || STRICTER_NOT_REMEMBERED.includes(r.signature)) expect(r.rememberable, r.signature).toBe(false);
      expect(r.rememberable, r.signature).toBe(r.scopes.length > 0);
      if (r.rememberable) expect(r.scopes, r.signature).toContain(r.scope);
    }
    expect(rows.filter((r) => r.scopes.includes("pattern")).map((r) => r.signature)).toEqual(["spouse_maiden_name"]);
  });

  it("knows which kinds are about one row and which about a pair, as the engine builds them", () => {
    expect(rows.filter((r) => r.itemKind === "record").map((r) => r.signature).sort()).toEqual(["low_confidence_read", "minor_record", "uncertain_type", "unreadable_money"]);
  });

  it("refuses, in the table itself, a remembered answer for every kind the database will not remember", () => {
    const check = /constraint import_decision_rules_never_held check \(signature not in\s*\(([^)]*)\)\)/.exec(m0630);
    expect(check).not.toBeNull();
    const listed = [...(check as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(listed).toEqual(rows.filter((r) => !r.rememberable).map((r) => r.signature).sort());
    // Every held kind (tier D) is among them.
    for (const r of rows) if (r.tier === "D") expect(listed, r.signature).toContain(r.signature);
  });

  it("allows only the answers of the kinds that can be remembered, as a remembered answer", () => {
    const check = /answer\s+text not null check \(answer in \(([^)]*)\)\)/.exec(m0630);
    expect(check).not.toBeNull();
    const listed = [...(check as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    const rememberable = new Set<string>();
    for (const r of rows) if (r.rememberable) for (const a of r.answers) rememberable.add(a);
    expect(listed).toEqual([...rememberable].sort());
  });

  it("is called with exactly the arguments the functions of 0631 take, in the same order", () => {
    const m0631 = sql("0631_");
    const declared = new Map<string, string[]>();
    for (const m of m0631.matchAll(/create or replace function app\.(resolve_[a-z_]+)\(([^)]*)\)/g)) {
      declared.set(m[1], m[2].split(",").map((p) => p.trim().split(/\s+/)[0]));
    }
    for (const [fn, args] of Object.entries(RPC)) {
      expect(declared.has(fn), `${fn} is declared in 0631`).toBe(true);
      expect(declared.get(fn), fn).toEqual([...args]);
    }
  });

  it("registers the keys the screen will record, in the shape the stream accepts", () => {
    const m0632 = sql("0632_");
    const keys = [...m0632.matchAll(/\('(onboarding\.[a-z_]+)',/g)].map((m) => m[1]);
    expect(keys).toEqual(["onboarding.find_matches", "onboarding.answer_question", "onboarding.defer_question", "onboarding.reopen_question"]);
    for (const k of keys) expect(/^[a-z][a-z0-9_]{1,40}(\.[a-z][a-z0-9_]{1,40}){0,2}$/.test(k)).toBe(true);
    expect(m0632).toContain("'screen:/setup/onboarding/questions'");
  });

  it("keeps the tables that hold uploaded rows, or personal values made from them, out of the audit log row by row", () => {
    const audited = [...m0630.matchAll(/create trigger audit_([a-z_]+) after insert/g)].map((m) => m[1]).sort();
    expect(audited).toEqual(["import_run_metrics", "import_signatures"]);
    const t13 = readFileSync(join(process.cwd(), "supabase", "tests", "13_modules_audit_test.sql"), "utf8");
    for (const t of ["import_staged_records", "import_record_links", "import_clusters", "import_exceptions", "import_exception_items", "import_decision_rules"]) {
      expect(t13).toContain(`'${t}'`);
    }
  });
});

// ── From the import engine's rows ───────────────────────────────────────────────────────────────────────────────────────
describe("records made from the rows an import run staged", () => {
  const people: ImportRowLike[] = [
    {
      row_no: 3,
      data: { first_name: "Mira", last_name: "Shah", email: "mira@example.com", phone_e164: "+17135550142", date_of_birth: "1984-03-02", member_number: "M-17" },
      extra: { legacy_id: "P-3", crm_id: "N-3", household_id: { $ref: "household", value: "H-9", by: "legacy" }, relationship: "spouse", other_emails: "m2@example.com; m3@example.com" },
    },
    { row_no: 2, data: { first_name: "Dev", last_name: "Shah" }, extra: { household_id: { $ref: "household", value: "H-9", by: "legacy" }, relationship: "child" } },
  ];

  it("reads a people file: names, contact details, birth date, the household it belongs to, in row order", () => {
    const out = rawRecordsFromImportRows("people", people, "people.csv");
    expect(out.map((r) => r.id)).toEqual(["people.csv#2", "people.csv#3"]);
    expect(out[1]).toMatchObject({
      kind: "person",
      sourceKind: "spreadsheet",
      row: 3,
      firstName: "Mira",
      lastName: "Shah",
      email: "mira@example.com",
      email2: "m2@example.com",
      phone: "+17135550142",
      dob: "1984-03-02",
      role: "spouse",
      ids: { person_connect: "M-17", person_crm: "N-3", person_legacy: "P-3", household_legacy: "H-9" },
    });
    // A child's relationship goes to the engine, which holds the row.
    expect(out[0].role).toBe("child");
    expect(run(out).dispositions.find((d) => d.id === "people.csv#2")?.status).toBe("held");
  });

  it("names the household IDs so the engine knows they say 'same household', never 'same person'", () => {
    const hh = rawRecordsFromImportRows(
      "households",
      [{ row_no: 1, data: { display_name: "Shah Family", address_line1: "12 Lotus Ln", city: "Sugar Land", state_region: "TX", postal_code: "77478", household_number: "0417" }, extra: { legacy_id: "H-9" } }],
      "households.csv",
    );
    expect(hh[0]).toMatchObject({ kind: "household", name: "Shah Family", zip: "77478", ids: { household_number: "0417", household_legacy: "H-9" } });
    const ids = Object.keys(hh[0].ids ?? {});
    expect(ids.every((k) => /household/.test(k))).toBe(true);
  });

  it("reads a payments file as gifts: dollars from cents, the check number, the donor through the references", () => {
    const out = rawRecordsFromImportRows(
      "payments",
      [{ row_no: 5, data: { amount_cents: 12505, received_on: "2025-12-31", check_number: "1042", household_id: { $ref: "household", value: "0417", by: "number" } }, extra: {} }],
      "gifts.csv",
    );
    expect(out[0]).toMatchObject({ kind: "gift", gift: { amount: "125.05", date: "2025-12-31", ref: "1042" }, ids: { household_number: "0417" } });
  });

  it("leaves out what is not there instead of inventing it", () => {
    const out = rawRecordsFromImportRows("people", [{ row_no: 1, data: {}, extra: null }], "p.csv");
    expect(out[0].firstName).toBeNull();
    expect(out[0].ids).toEqual({});
  });

  it("turns the households already in the records into link targets that are not rows of the file", () => {
    const out = existingToRawRecords([
      {
        id: "h-1",
        number: "0417",
        name: "Shah Family",
        address1: "12 Lotus Ln",
        address2: null,
        city: "Sugar Land",
        zip: "77478",
        people: [{ name: "Mira Shah", email: "mira@example.com", phone: "+17135550142" }],
        aliases: [],
      },
    ]);
    expect(out.map((r) => r.id)).toEqual(["existing:h:h-1", "existing:p:h-1:0"]);
    expect(out.every((r) => r.sourceKind === "existing" && r.existing?.householdId === "h-1")).toBe(true);
    expect(out.every((r) => isExistingRecordId(r.id))).toBe(true);
    expect(isExistingRecordId("people.csv#1")).toBe(false);
  });
});

// ── The pages sent to the database ──────────────────────────────────────────────────────────────────────────────────────
describe("the result as pages for the database", () => {
  const golden = buildGolden({ rows: 300, seed: 1 });
  const cfg = makeRunConfig(golden.records, TODAY);
  const result = run(golden.records, { dateOrderBySource: cfg.dateOrderBySource });

  it("is plain JSON: sending it and reading it back changes nothing", () => {
    const pages = [recordPayloads(result), pairPayloads(result.pairs), groupPayloads(result.groups), itemPayloads(result.items, result.answeredByRules), stagePayloads(golden.records)];
    for (const page of pages) expect(JSON.parse(JSON.stringify(page))).toEqual(JSON.parse(JSON.stringify(page)));
    expect(JSON.stringify(pages)).not.toContain("undefined");
  });

  it("has one entry for every record, every distinct pair and every question, in the engine's order", () => {
    expect(recordPayloads(result)).toHaveLength(golden.records.length);
    expect(new Set(pairPayloads(result.pairs).map((p) => `${p.a}|${p.b}`)).size).toBe(pairPayloads(result.pairs).length);
    const groups = groupPayloads(result.groups);
    expect(groups.map((g) => g.signature)).toEqual(result.groups.map((g) => g.signature));
    expect(groups.map((g) => g.rank_no)).toEqual(groups.map((_, i) => i));
    expect(groups.every((g) => g.recommended === SIGNATURES[g.signature].answers[0])).toBe(true);
  });

  it("splits into pages no bigger than the functions accept", () => {
    const pages = pagesOf(Array.from({ length: 1201 }, (_, i) => i), PAGE_SIZE.records);
    expect(pages.map((p) => p.length)).toEqual([500, 500, 201]);
  });

  it("never carries a remembered answer on a held item or a record", () => {
    const held = result.items.find((i) => i.tier === "D" || i.kind === "record");
    expect(held).toBeDefined();
    expect(() => itemPayloads([held!], [{ itemKey: held!.key, ruleId: "rule:x", answer: SIGNATURES[held!.signature].answers[0] }])).toThrow(/decide each time/);
  });

  it("marks the items a remembered answer already answers, and only those", () => {
    const item = result.items.find((i) => i.tier === "C" && i.kind === "pair")!;
    const payload = itemPayloads([item], [{ itemKey: item.key, ruleId: "rule:r", answer: SIGNATURES[item.signature].answers[0] }]);
    expect(payload[0]).toMatchObject({ key: item.key, rule_id: "rule:r", rule_answer: SIGNATURES[item.signature].answers[0] });
    expect(itemPayloads([item], [])[0]).toMatchObject({ rule_id: null, rule_answer: null });
  });

  it("reads the remembered answers of the database and drops what it cannot read, counting it", () => {
    const good = { id: "rule:a", signature: "name_only", scope: "exact_pair", conditions: [{ type: "pair", fingerprints: ["a", "b"] }], answer: "separate", decidedBy: "u1", decidedAt: "2026-10-11T10:00:00.000Z", fromGroup: "grp:name_only", revokedAt: null };
    const parsed = rulesFromRows([good, { ...good, id: "rule:b", signature: "not_a_kind" }, { id: "rule:c" }, "nonsense"]);
    expect(parsed.rules.map((r) => r.id)).toEqual(["rule:a"]);
    expect(parsed.skipped).toBe(3);
    expect(rulesFromRows(null)).toEqual({ rules: [], skipped: 0 });
  });
});

// ── The flow, against a fake database ────────────────────────────────────────────────────────────────────────────────────
type Call = { fn: string; args: Record<string, unknown> };

function fakeDb(opts: { rules?: unknown[]; importRows?: ImportRowLike[]; fail?: { fn: string; error: { code?: string; message: string; details?: string } } } = {}) {
  const calls: Call[] = [];
  const staged = new Map<string, { order_no: number; raw: RawRecord }>();
  const stored = { records: [] as unknown[], pairs: [] as unknown[], clusters: [] as unknown[], groups: [] as unknown[], items: [] as Array<Record<string, unknown>>, metrics: null as unknown };
  const db: ResolveDb = {
    async rpc(fn, args) {
      calls.push({ fn, args });
      if (opts.fail?.fn === fn) return { data: null, error: opts.fail.error };
      switch (fn) {
        case "resolve_stage_records": {
          if (args.p_first) staged.clear();
          const page = args.p_records as Array<{ id: string; order_no: number; raw: RawRecord }>;
          for (const r of page) staged.set(r.id, { order_no: r.order_no, raw: r.raw });
          return { data: page.length, error: null };
        }
        case "resolve_staged_page": {
          const after = args.p_after as number;
          const rows = [...staged.entries()]
            .map(([id, v]) => ({ id, order_no: v.order_no, raw: v.raw }))
            .filter((r) => r.order_no > after)
            .sort((a, b) => a.order_no - b.order_no)
            .slice(0, args.p_limit as number);
          return { data: rows, error: null };
        }
        case "resolve_rules":
          return { data: opts.rules ?? [], error: null };
        case "resolve_begin":
          return { data: "batch-1", error: null };
        case "resolve_store_records":
          stored.records.push(...(args.p_records as unknown[]));
          return { data: (args.p_records as unknown[]).length, error: null };
        case "resolve_store_pairs":
          stored.pairs.push(...(args.p_pairs as unknown[]));
          return { data: (args.p_pairs as unknown[]).length, error: null };
        case "resolve_store_clusters":
          stored.clusters.push(...(args.p_clusters as unknown[]));
          return { data: (args.p_clusters as unknown[]).length, error: null };
        case "resolve_store_groups":
          stored.groups.push(...(args.p_groups as unknown[]));
          return { data: (args.p_groups as unknown[]).length, error: null };
        case "resolve_store_items":
          stored.items.push(...(args.p_items as Array<Record<string, unknown>>));
          return { data: (args.p_items as unknown[]).length, error: null };
        case "resolve_finish":
          stored.metrics = args.p_metrics;
          return { data: {}, error: null };
        case "resolve_inbox":
          return { data: { status: "ready", groups: [] }, error: null };
        case "resolve_runs":
          return { data: [{ id: "run-1", run_number: 3, entity: "people", entity_label: "People", file_name: "people.csv", status: "staged", rows_total: 40, result: "ready", groups_total: 2, questions_left: 1 }, { id: "x" }], error: null };
        case "resolve_answer":
          return { data: { answered: 1, open_items: 0, status: "answered", remembered_as: "rule:x" }, error: null };
        default:
          return { data: null, error: null };
      }
    },
    async importRows(_run, from, to) {
      return { data: (opts.importRows ?? []).slice(from, to + 1), error: null };
    },
  };
  return { db, calls, stored, staged };
}

const golden = buildGolden({ rows: 300, seed: 1 });
const input = { runId: "run-1", centerId: "center-1", today: TODAY };

describe("looking for matches in a staged run", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stages the records in pages, starting the staging over on the first page only", async () => {
    const f = fakeDb();
    const many: RawRecord[] = Array.from({ length: 1100 }, (_, i) => rec({ id: `p${i}`, firstName: "A", lastName: `L${i}` }));
    const res = await stageRecords(f.db, "run-1", many);
    expect(res).toEqual({ ok: true, data: { staged: 1100 } });
    const stage = f.calls.filter((c) => c.fn === "resolve_stage_records");
    expect(stage.map((c) => (c.args.p_records as unknown[]).length)).toEqual([500, 500, 100]);
    expect(stage.map((c) => c.args.p_first)).toEqual([true, false, false]);
  });

  it("saves the whole result: records, pairs, clusters, questions and items, then finishes with the numbers", async () => {
    const f = fakeDb();
    expect((await stageRecords(f.db, input.runId, golden.records)).ok).toBe(true);
    const res = await resolveStagedRun(f.db, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.data;
    expect(s.rows).toBe(300);
    expect(s.engineVersion).toBe(RESOLVE_ENGINE_VERSION);
    expect(f.stored.records).toHaveLength(300);
    expect(f.stored.groups).toHaveLength(s.questions);
    expect(f.stored.items).toHaveLength(s.items);
    expect(s.questions).toBeGreaterThan(0);
    // The engine's own result, not a copy of it.
    const direct = run(golden.records, { dateOrderBySource: makeRunConfig(golden.records, TODAY).dateOrderBySource });
    expect(f.stored.pairs).toHaveLength(pairPayloads(direct.pairs).length);
    expect(f.stored.metrics).toEqual(direct.metrics);
    // The order of the calls: staged rows read, rules read, then begin, the stores, finish last.
    const names = f.calls.map((c) => c.fn);
    expect(names.indexOf("resolve_begin")).toBeGreaterThan(names.indexOf("resolve_rules"));
    expect(names[names.length - 1]).toBe("resolve_finish");
    for (const c of f.calls.filter((x) => x.fn.startsWith("resolve_store_") || x.fn === "resolve_finish")) expect(c.args.p_batch).toBe("batch-1");
    // Only arguments the database functions take.
    for (const c of f.calls) for (const k of Object.keys(c.args)) expect((RPC[c.fn as keyof typeof RPC] as readonly string[]).includes(k), `${c.fn}.${k}`).toBe(true);
    // No page is bigger than a function accepts.
    for (const c of f.calls) for (const v of Object.values(c.args)) if (Array.isArray(v)) expect(v.length).toBeLessThanOrEqual(500);
  });

  it("saves the same result again without changing it", async () => {
    const f = fakeDb();
    await stageRecords(f.db, input.runId, golden.records);
    const first = await resolveStagedRun(f.db, input);
    const items1 = JSON.stringify(f.stored.items);
    f.stored.items.length = 0;
    const second = await resolveStagedRun(f.db, input);
    expect(second).toEqual(first);
    expect(JSON.stringify(f.stored.items)).toBe(items1);
  });

  it("never asks twice: a second file is not asked what the community already answered", async () => {
    const f1 = fakeDb();
    await stageRecords(f1.db, input.runId, golden.records);
    const first = await resolveStagedRun(f1.db, input);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A person answers the biggest question that can be remembered; the database keeps the answer as a rule.
    const engine = run(golden.records, { dateOrderBySource: makeRunConfig(golden.records, TODAY).dateOrderBySource });
    const rememberable = new Set(catalogRows().filter((r) => r.rememberable).map((r) => r.signature));
    const group = engine.groups.find((g) => g.tier === "C" && rememberable.has(g.signature) && g.items.length >= 1)!;
    expect(group).toBeDefined();
    const made = ruleFromAnswer({ group, answer: SIGNATURES[group.signature].answers[0], decidedBy: "user-1", decidedAt: "2026-10-11T12:00:00.000Z" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;

    // The same people again (a nightly pull), in a new run, with the rule loaded from the database.
    const f2 = fakeDb({ rules: [made.rule] });
    await stageRecords(f2.db, "run-2", golden.records);
    const second = await resolveStagedRun(f2.db, { ...input, runId: "run-2" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.rulesUsed).toBe(1);
    expect(second.data.answeredByRules).toBeGreaterThan(0);
    const answered = f2.stored.items.filter((i) => i.rule_id);
    expect(answered.length).toBe(second.data.answeredByRules);
    expect(answered.every((i) => i.tier === "C" && i.kind === "pair" && i.rule_id === made.rule.id && i.signature === group.signature)).toBe(true);
    // Fewer things left to ask than the first time.
    const askedFirst = first.data.items - first.data.answeredByRules;
    const askedSecond = second.data.items - second.data.answeredByRules;
    expect(askedSecond).toBeLessThan(askedFirst);
    // Held items (a child, a money conflict) are asked again every time.
    expect(f2.stored.items.filter((i) => i.tier === "D").every((i) => i.rule_id === null)).toBe(true);
  });

  it("counts link targets (households already in the records) out of the rows of the file", async () => {
    const f = fakeDb();
    const targets = existingToRawRecords([{ id: "h-1", number: "0417", name: "Zed Family", address1: "1 Elm St", address2: null, city: "Katy", zip: "77494", people: [{ name: "Zed Zed", email: null, phone: null }], aliases: [] }]);
    const rows: RawRecord[] = [rec({ id: "f#1", firstName: "Ann", lastName: "Lee", email: "ann@example.com" }), rec({ id: "f#2", firstName: "Bo", lastName: "Kim", email: "bo@example.com" }), ...targets];
    await stageRecords(f.db, input.runId, rows);
    const res = await resolveStagedRun(f.db, input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.rows).toBe(2);
    expect(res.data.linkTargets).toBe(2);
    expect((f.stored.metrics as { rows: number }).rows).toBe(2);
  });

  it("stops with a plain sentence when a step fails, and logs the code and message only", async () => {
    const f = fakeDb({ fail: { fn: "resolve_store_pairs", error: { code: "P0001", message: "Another check for matches started on Import #3, so this one was stopped. Try again.", details: "Failing row contains (Raj Shah, raj@example.com)" } } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await stageRecords(f.db, input.runId, golden.records);
    const res = await resolveStagedRun(f.db, input);
    expect(res).toEqual({ ok: false, error: "Could not look for matches — Another check for matches started on Import #3, so this one was stopped. Try again." });
    expect(f.calls.some((c) => c.fn === "resolve_finish")).toBe(false);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("P0001");
    expect(logged).not.toContain("Raj Shah");
    expect(logged).not.toContain("raj@example.com");
  });

  it("says what access is missing when the database refuses, in the database's own words", async () => {
    const f = fakeDb({ fail: { fn: "resolve_answer", error: { code: "42501", message: "Answering questions about gifts needs one of these permissions: giving.manage." } } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await answerGroup(f.db, { groupId: "g1", answer: "same_gift" });
    expect(res).toEqual({ ok: false, denied: true, error: "Could not record your answer — Answering questions about gifts needs one of these permissions: giving.manage." });
  });

  it("explains a plain row-level-security refusal in the usual words", async () => {
    const f = fakeDb({ fail: { fn: "resolve_inbox", error: { code: "42501", message: 'new row violates row-level security policy for table "import_exceptions"' } } });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await loadInbox(f.db, "run-1");
    expect(res).toMatchObject({ ok: false, denied: true });
    expect((res as { error: string }).error).toBe("Could not open the questions — you don't have permission to make this change.");
  });

  it("refuses a file of a kind it does not check yet, and reads the rows of one it does", async () => {
    const f = fakeDb({ importRows: [{ row_no: 1, data: { first_name: "Ann", last_name: "Lee" }, extra: {} }] });
    expect(await readImportRows(f.db, "run-1", "events", "e.csv")).toMatchObject({ ok: false });
    const ok = await readImportRows(f.db, "run-1", "people", "p.csv");
    expect(ok.ok && ok.data.map((r) => r.id)).toEqual(["p.csv#1"]);
  });

  it("checks an import run from its rows to the saved result", async () => {
    const rows: ImportRowLike[] = Array.from({ length: 40 }, (_, i) => ({ row_no: i + 1, data: { first_name: `Name${i}`, last_name: `Fam${i}`, email: `n${i}@example.com` }, extra: {} }));
    const f = fakeDb({ importRows: rows });
    const res = await resolveImportRun(f.db, { ...input, entity: "people", source: "people.csv" });
    expect(res.ok && res.data.rows).toBe(40);
    expect(f.calls[0].fn).toBe("resolve_stage_records");
    expect(f.stored.records).toHaveLength(40);
  });

  it("lists the imports that can be checked, with where each check stands, and leaves out what it cannot read", async () => {
    const f = fakeDb();
    const res = await loadRuns(f.db, "center-1");
    expect(res.ok && res.data).toEqual([
      { id: "run-1", runNumber: 3, entity: "people", entityLabel: "People", fileName: "people.csv", status: "staged", rowsTotal: 40, createdAt: null, result: "ready", storedAt: null, groupsTotal: 2, questionsLeft: 1 },
    ]);
    expect(parseRuns({ not: "a list" })).toBeNull();
  });

  it("withdraws a remembered answer through the database", async () => {
    const f = fakeDb();
    expect(await revokeRule(f.db, { centerId: "center-1", ruleId: "rule:x" })).toEqual({ ok: true, data: null });
    expect(f.calls[0]).toEqual({ fn: "resolve_revoke_rule", args: { p_center: "center-1", p_rule: "rule:x" } });
  });
});

// ── What the screens read ────────────────────────────────────────────────────────────────────────────────────────────────
describe("reading the inbox", () => {
  const group = {
    id: "g-1",
    signature: "spouse_maiden_name",
    tier: "C",
    status: "open",
    question: { title: "14 rows list a spouse under another family name.", detail: "x", answers: [], recommended: "same_household", sameForRest: { available: true, others: 13, label: "Same answer for the other 13" } },
    recommended: "same_household",
    route_suggested: "membership",
    open_items: 14,
    answered_items: 0,
    money_cents: 0,
    members: 28,
    rank: 0,
    next_item_id: "i-1",
    same_for_rest: true,
    rememberable: true,
  };

  it("reads the questions, the numbers and what is left", () => {
    const view = parseInbox({ status: "ready", stalled: false, record_count: 300, progress: { groups_total: 1, questions_left: 1, items_open: 14, minutes_left: 0.5 }, metrics: { rows: 300, autoShare: 0.8 }, groups: [group, { ...group, id: "g-2", signature: "made_up" }] });
    expect(view?.status).toBe("ready");
    expect(view?.groups).toHaveLength(1);
    expect(view?.groups[0]).toMatchObject({ id: "g-1", signature: "spouse_maiden_name", openItems: 14, nextItemId: "i-1", sameForRest: true, routeSuggested: "membership" });
    expect(view?.progress).toMatchObject({ questionsLeft: 1, itemsOpen: 14, minutesLeft: 0.5 });
    expect(parseInbox({ status: "nonsense" })).toBeNull();
    expect(parseInbox(null)).toBeNull();
  });

  it("never opens a child's record: it has a name of its row and no card", () => {
    const detail = parseItemDetail({
      item: { id: "i-1", key: "k", signature: "minor_record", kind: "record", tier: "D", subject: "r1", record_ids: ["r1"] },
      link: null,
      records: [{ id: "r1", minor: true, row_no: 4, source: "kids.csv", kind: "person", card: { name: "Should not be here" } }],
    });
    expect(detail?.records[0]).toMatchObject({ minor: true, rowNo: 4, card: null });
    expect(JSON.stringify(detail)).not.toContain("Should not be here");
  });

  it("reads a card with the details that tell households apart, and the evidence beside it", () => {
    const detail = parseItemDetail({
      item: { id: "i-2", key: "k2", signature: "shared_phone_households", kind: "pair", tier: "C", subject: "b", record_ids: ["a", "b"], money_cents: 0 },
      link: { evidence: [{ kind: "phone", label: "same mobile", independent: true }], conflicts: [{ kind: "unit", label: "a different unit at the same address", severity: "lower" }], tier_reasons: ["one identifier agrees"] },
      records: [{ id: "a", minor: false, row_no: 1, source: "f.csv", source_kind: "spreadsheet", kind: "person", card: { name: "Mira Shah", mobile: "+17135550142", address1: "12 Lotus Ln", zip: "77478", ids: { household_number: "0417" }, existing: { number: "0417" } } }],
    });
    expect(detail?.evidence).toEqual([{ kind: "phone", label: "same mobile", independent: true }]);
    expect(detail?.conflicts[0].severity).toBe("lower");
    expect(detail?.records[0].card).toMatchObject({ name: "Mira Shah", address1: "12 Lotus Ln", existingNumber: "0417", ids: { household_number: "0417" } });
  });
});

describe("the number the person saw, and changing an answer on purpose", () => {
  it("sends the number of others with 'the same answer for the others', and not otherwise", async () => {
    const f = fakeDb();
    await answerGroup(f.db, { groupId: "g", answer: "separate", itemId: "i", applyToRest: true, expectedOthers: 13 });
    await answerGroup(f.db, { groupId: "g", answer: "separate", itemId: "i", applyToRest: false, expectedOthers: 13 });
    expect(f.calls[0].args).toMatchObject({ p_apply_rest: true, p_expected_others: 13 });
    expect(f.calls[1].args.p_apply_rest).toBe(false);
    expect("p_expected_others" in f.calls[1].args).toBe(false);
  });

  it("asks for a change of answer only when it is asked for", async () => {
    const f = fakeDb();
    await answerGroup(f.db, { groupId: "g", answer: "same_household", itemId: "i", change: true });
    await answerGroup(f.db, { groupId: "g", answer: "same_household", itemId: "i" });
    expect(f.calls[0].args.p_change).toBe(true);
    expect("p_change" in f.calls[1].args).toBe(false);
  });

  it("reads why an answer was not remembered, and whether a card is limited", () => {
    const out = parseItemDetail({ item: { id: "i", signature: "amount_differs", kind: "pair", tier: "D", limited: true }, link: null, records: [] });
    expect(out?.limited).toBe(true);
    expect(parseItemDetail({ item: { id: "i", signature: "name_only", kind: "pair", tier: "C" }, records: [] })?.limited).toBe(false);
  });
});
