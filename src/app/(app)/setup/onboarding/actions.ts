"use server";

import type { Json } from "@/lib/database.types";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { explainError } from "@/lib/errors";
import { canImportEntity, entityDef } from "@/lib/import/registry";
import { isModuleEnabled } from "@/lib/modules";
import { assembleExisting, type ExistingHousehold } from "@/lib/onboarding/existing";
import { parseProgressPayload, STAGES, type Outcomes, type ProgressView, type SavePatch, type StoredList } from "@/lib/onboarding/progress";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Guided onboarding: saving and resuming the wizard, reading the households already in the records, and helping
// with the rows an import run stops on. Every action re-checks the session here (UI convenience); the database
// checks again (app.onboarding_* and RLS) and is the enforcement.
//
// PERSONAL DATA. The rows these actions carry are personal data (names, emails, mobiles, addresses, amounts):
// they are held like import staging data. Nothing here logs a row, a value or a database error's `details` (a
// constraint error's details can quote the row): only the error code and its message are logged, and the message
// of our own functions is a plain sentence.

export type OnbResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; conflict?: boolean };

function fail(context: string, error: unknown): { ok: false; error: string; conflict?: boolean } {
  const e = (typeof error === "object" && error !== null ? error : {}) as { code?: string | null; message?: string | null };
  console.error(`[onboarding] ${context}:`, { code: e.code ?? null, message: String(e.message ?? "").slice(0, 300) });
  const reason = explainError(error);
  return { ok: false, error: `${context} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`, ...(e.code === "40001" ? { conflict: true } : {}) };
}

const refused = (context: string, why: string) => ({ ok: false as const, error: `${context} — ${why}` });

function toJson(x: unknown): Json {
  return x as Json;
}

// ── The draft ──────────────────────────────────────────────────────────────────

/** Start the organization's draft (or return the one already there). */
export async function startOnboardingAction(): Promise<OnbResult<ProgressView>> {
  const a = await authorizeAction("dataImport", "start the guided onboarding");
  if (!a.ok) return a;
  const { data, error } = await a.session.db.rpc("onboarding_start", { p_center: a.session.center.id });
  if (error) return fail("Could not start the guided onboarding", error);
  const payload = parseProgressPayload(data);
  if (!payload?.draft) return refused("Could not start the guided onboarding", "the database answered in a form this page does not understand. Reload and try again.");
  return { ok: true, data: payload.draft };
}

/** Save where the wizard stands. `version` is the version this browser last saw; a newer one means someone else saved. */
export async function saveProgressAction(input: { id: string; version: number; patch: SavePatch }): Promise<OnbResult<{ version: number; updatedAt: string }>> {
  const a = await authorizeAction("dataImport", "save your progress");
  if (!a.ok) return a;
  const ctx = "Could not save your progress";
  if (!isUuid(input.id) || !Number.isInteger(input.version)) return refused(ctx, "this page lost track of the draft. Reload the page.");
  const p = input.patch ?? {};
  if (p.stage !== undefined && !STAGES.includes(p.stage)) return refused(ctx, "that step is not known.");
  const { data, error } = await a.session.db.rpc("onboarding_save", {
    p_id: input.id,
    p_version: input.version,
    p_stage: p.stage,
    p_state: p.state ? toJson(p.state) : undefined,
    p_answers: p.answers ? toJson(p.answers) : undefined,
    p_outcomes: p.outcomes ? toJson(p.outcomes) : undefined,
  });
  if (error) return fail(ctx, error);
  const d = (data ?? {}) as { version?: number; updated_at?: string };
  if (typeof d.version !== "number") return refused(ctx, "the database answered in a form this page does not understand. Reload the page.");
  return { ok: true, data: { version: d.version, updatedAt: String(d.updated_at ?? "") } };
}

/** Finish ("created") or start over ("abandoned"): the saved rows are deleted at once. */
export async function closeProgressAction(input: { id: string; status: "created" | "abandoned"; outcomes?: Outcomes }): Promise<OnbResult> {
  const a = await authorizeAction("dataImport", input.status === "created" ? "finish the guided onboarding" : "start over");
  if (!a.ok) return a;
  const ctx = input.status === "created" ? "Could not record that the guided onboarding is finished" : "Could not start over";
  if (!isUuid(input.id) || (input.status !== "created" && input.status !== "abandoned")) return refused(ctx, "this page lost track of the draft. Reload the page.");
  const { error } = await a.session.db.rpc("onboarding_close", { p_id: input.id, p_status: input.status, p_outcomes: input.outcomes ? toJson(input.outcomes) : undefined });
  if (error) return fail(ctx, error);
  return { ok: true };
}

// ── The saved rows ─────────────────────────────────────────────────────────────

const LISTS: readonly StoredList[] = ["donations", "members", "family", "plan"];
const MAX_ROWS_PER_CALL = 300;

/** What the wizard must be allowed before a list of rows can be kept for it. */
function listBlocker(session: Parameters<typeof canImportEntity>[0] & { modulesOff?: readonly string[] }, list: StoredList): string | null {
  if (list === "donations") {
    if (!isModuleEnabled(session, "giving")) return "Pledges & donations is switched off for your community.";
    const e = entityDef("payments");
    if (e && !canImportEntity(session, e)) return `saving past donations needs ${e.writePerms.join(" or ")}.`;
    return null;
  }
  const e = entityDef("people");
  if (e && !canImportEntity(session, e)) return `saving people needs ${e.writePerms.join(" or ")}.`;
  return null;
}

/** Save one batch (at most 300 rows) of a checked list. The first batch of an upload replaces what the list held. */
export async function saveRowsAction(input: { id: string; list: StoredList; chunk: number; rows: unknown[]; first: boolean }): Promise<OnbResult<{ stored: number; version: number }>> {
  const a = await authorizeAction("dataImport", "save your rows");
  if (!a.ok) return a;
  const ctx = "Could not save your rows";
  if (!isUuid(input.id) || !LISTS.includes(input.list)) return refused(ctx, "this page lost track of the draft. Reload the page.");
  if (!Array.isArray(input.rows) || input.rows.length > MAX_ROWS_PER_CALL) return refused(ctx, `send at most ${MAX_ROWS_PER_CALL} rows at a time.`);
  if (!Number.isInteger(input.chunk) || input.chunk < 0) return refused(ctx, "the batch number is not valid.");
  const blocked = listBlocker(a.session, input.list);
  if (blocked) return refused(ctx, blocked);
  const { data, error } = await a.session.db.rpc("onboarding_put_rows", {
    p_id: input.id,
    p_dataset: input.list,
    p_chunk: input.chunk,
    p_rows: toJson(input.rows),
    p_first: Boolean(input.first),
  });
  if (error) return fail(ctx, error);
  const d = (data ?? {}) as { stored?: number; version?: number };
  if (typeof d.stored !== "number" || typeof d.version !== "number") return refused(ctx, "the database answered in a form this page does not understand. Reload the page.");
  return { ok: true, data: { stored: d.stored, version: d.version } };
}

/**
 * Read saved rows back, a few batches at a time (`from` is the batch to start at). Row-level security decides what
 * this person may read, so the wizard compares the count it got with the count saved and says so when they differ.
 */
export async function loadRowsAction(input: { id: string; list: StoredList; from: number; batches?: number }): Promise<OnbResult<{ rows: unknown[]; next: number | null }>> {
  const a = await authorizeAction("dataImport", "read your saved rows");
  if (!a.ok) return a;
  const ctx = "Could not read your saved rows";
  if (!isUuid(input.id) || !LISTS.includes(input.list) || !Number.isInteger(input.from) || input.from < 0) return refused(ctx, "this page lost track of the draft. Reload the page.");
  const batches = Math.max(1, Math.min(Number(input.batches ?? 8) || 8, 12));
  const { data, error } = await a.session.db
    .from("onboarding_rows")
    .select("chunk_no, staged_rows")
    .eq("center_id", a.session.center.id)
    .eq("progress_id", input.id)
    .eq("dataset", input.list)
    .gte("chunk_no", input.from)
    .order("chunk_no")
    .limit(batches);
  if (error) return fail(ctx, error);
  const got = data ?? [];
  const rows = got.flatMap((r) => (Array.isArray(r.staged_rows) ? (r.staged_rows as unknown[]) : []));
  const last = got[got.length - 1];
  return { ok: true, data: { rows, next: got.length === batches && last ? last.chunk_no + 1 : null } };
}

// ── Households already in the records ──────────────────────────────────────────

export type ExistingLoad = {
  households: ExistingHousehold[];
  /** More than the cap: only the first ones were compared. */
  truncated: boolean;
  /** Households with no Connect number cannot be named to the import tool, so they are left out. */
  withoutNumber: number;
};

const ID_PAGE = 1000;

/**
 * The organization's households with only what matching needs: the household's name and address, each current
 * member's name, email and mobile, and the names it has paid under (bank payer names, and the "Also paid as" custom
 * field). Read under the signed-in person's row-level security, a page at a time.
 */
export async function loadExistingHouseholdsAction(): Promise<OnbResult<ExistingLoad>> {
  const a = await authorizeAction("households", "compare with the households you already have");
  if (!a.ok) return a;
  const { db, center } = a.session;
  const ctx = "Could not read the households you already have";

  // The custom field that holds payer names has whatever key the organization's own definition gave it.
  const defs = await db.from("custom_field_definitions").select("key, label").eq("center_id", center.id).eq("entity", "households").eq("status", "active");
  if (defs.error) return fail(ctx, defs.error);
  const aliasKey = (defs.data ?? []).find((d) => d.label.trim().toLowerCase() === "also paid as")?.key ?? null;

  const limits = { pageSize: ID_PAGE, max: 50_000 };
  const [hh, members, people, payers, staff] = await Promise.all([
    fetchAll(
      (f, t) =>
        db
          .from("households")
          .select("id, display_name, household_number, address_line1, address_line2, city, postal_code, custom")
          .eq("center_id", center.id)
          .is("merged_into_id", null)
          .order("id")
          .range(f, t),
      limits,
    ),
    fetchAll((f, t) => db.from("household_members").select("household_id, person_id").eq("center_id", center.id).is("left_at", null).order("household_id").order("person_id").range(f, t), limits),
    fetchAll((f, t) => db.from("people").select("id, first_name, last_name, preferred_name, email, phone_e164").eq("center_id", center.id).is("merged_into_id", null).order("id").range(f, t), limits),
    fetchAll((f, t) => db.from("external_ids").select("household_id, value").eq("center_id", center.id).eq("kind", "bank_payer").is("valid_to", null).not("household_id", "is", null).order("id").range(f, t), limits),
    // Staff-only custom values are kept apart from the record (app.custom_staff_values): "Also paid as" is one.
    aliasKey
      ? fetchAll((f, t) => db.from("custom_staff_values").select("record_key, custom").eq("center_id", center.id).eq("entity", "households").order("record_key").range(f, t), limits)
      : Promise.resolve({ data: [] as { record_key: string; custom: Json }[], error: null, truncated: false }),
  ]);
  for (const [what, r] of [["households", hh], ["household members", members], ["people", people], ["payer names", payers], ["payer names", staff]] as const) {
    if (r.error) return fail(`${ctx} (${what})`, r.error);
  }

  const { households, withoutNumber } = assembleExisting({
    households: hh.data,
    members: members.data,
    people: people.data.map((p) => ({ ...p, email: p.email ? String(p.email) : null })),
    payerNames: payers.data,
    staffValues: staff.data,
    aliasKey,
  });
  return { ok: true, data: { households, truncated: hh.truncated || people.truncated || members.truncated, withoutNumber } };
}

// ── Runs that stop for the owner ───────────────────────────────────────────────

export type RunStatus = {
  status: string;
  preview: { create: number; update: number; skip: number; needs_decision: number; error: number; total: number } | null;
  /** Rows that need a decision and have none yet. */
  undecided: number;
};

/** Where an import run stands: its status, its preview counts and how many decisions are still owed. */
export async function runStatusAction(runId: string): Promise<OnbResult<RunStatus>> {
  const a = await authorizeAction("dataImport", "check the import");
  if (!a.ok) return a;
  const ctx = "Could not check the import";
  if (!isUuid(runId)) return refused(ctx, "that import was not found.");
  const got = await a.session.db.rpc("import_run_get", { p_run: runId });
  if (got.error) return fail(ctx, got.error);
  const run = (got.data ?? {}) as { status?: string; counts?: { preview?: RunStatus["preview"] } | null };
  const open = await a.session.db
    .from("import_rows")
    .select("row_no", { count: "exact", head: true })
    .eq("run_id", runId)
    .eq("status", "staged")
    .eq("action", "needs_decision")
    .is("decision", null);
  if (open.error) return fail(ctx, open.error);
  return { ok: true, data: { status: String(run.status ?? ""), preview: run.counts?.preview ?? null, undecided: open.count ?? 0 } };
}

export type DecisionCandidate = { title: string; detail: string };
export type DecisionRow = {
  rowNo: number;
  entity: "households" | "people";
  /** The row from the file, in a few words. */
  title: string;
  detail: string;
  /** lookalike: only the name matches; ambiguous: an email or mobile fits several records. */
  why: "lookalike" | "ambiguous";
  decision: "create" | "skip" | null;
  candidates: DecisionCandidate[];
};

const fmt = (x: unknown): string => (typeof x === "string" ? x : "");

/**
 * The rows an import run stops on ("needs a decision") that have no decision yet, each with the records it looks
 * like, told apart by more than a name: the household card (Connect number, members, city) of each one.
 */
export async function loadDecisionRowsAction(runId: string, entity: "households" | "people"): Promise<OnbResult<{ rows: DecisionRow[]; more: number }>> {
  const a = await authorizeAction("dataImport", "read the rows that need a decision");
  if (!a.ok) return a;
  const ctx = "Could not read the rows that need a decision";
  if (!isUuid(runId) || (entity !== "households" && entity !== "people")) return refused(ctx, "that import was not found.");
  const { db } = a.session;
  const res = await db
    .from("import_rows")
    .select("row_no, data, match, decision", { count: "exact" })
    .eq("run_id", runId)
    .eq("status", "staged")
    .eq("action", "needs_decision")
    .is("decision", null)
    .order("row_no")
    .limit(200);
  if (res.error) return fail(ctx, res.error);
  const rows = res.data ?? [];

  // The records each row looks like.
  const idsOf = (m: Json): string[] => {
    const x = m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, Json>) : {};
    const list = Array.isArray(x.lookalikes) ? x.lookalikes : Array.isArray(x.ambiguous) ? x.ambiguous : [];
    return list.filter((v): v is string => typeof v === "string" && isUuid(v));
  };
  const wanted = [...new Set(rows.flatMap((r) => idsOf(r.match)))];
  const personHousehold = new Map<string, string>();
  const personName = new Map<string, string>();
  const householdIds = new Set<string>();
  if (entity === "people") {
    for (const ids of chunk(wanted)) {
      const [p, m] = await Promise.all([
        db.from("people").select("id, first_name, last_name").in("id", ids),
        db.from("household_members").select("person_id, household_id").in("person_id", ids).is("left_at", null),
      ]);
      if (p.error) return fail(ctx, p.error);
      if (m.error) return fail(ctx, m.error);
      for (const r of p.data ?? []) personName.set(r.id, `${r.first_name} ${r.last_name}`.trim());
      for (const r of m.data ?? []) {
        if (!personHousehold.has(r.person_id)) personHousehold.set(r.person_id, r.household_id);
        householdIds.add(r.household_id);
      }
    }
  } else {
    for (const id of wanted) householdIds.add(id);
  }
  const cards = new Map<string, string>();
  for (const ids of chunk([...householdIds].slice(0, 200), 10)) {
    const got = await Promise.all(ids.map((id) => db.rpc("household_card", { p_household: id }).then((r) => ({ id, ...r }))));
    for (const card of got) {
      if (card.error) return fail(ctx, card.error);
      const c = (card.data ?? [])[0];
      if (!c) continue;
      cards.set(card.id, [`${c.household_name} (${c.household_number})`, c.city, c.members ? `members: ${c.members}` : null].filter(Boolean).join(" · "));
    }
  }

  const out: DecisionRow[] = rows.map((r) => {
    const d = (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? r.data : {}) as Record<string, Json>;
    const m = (r.match && typeof r.match === "object" && !Array.isArray(r.match) ? r.match : {}) as Record<string, Json>;
    const ids = idsOf(r.match);
    const isPerson = entity === "people";
    const title = isPerson ? `${fmt(d.first_name)} ${fmt(d.last_name)}`.trim() : fmt(d.display_name);
    const detail = isPerson ? [fmt(d.email), fmt(d.phone_e164)].filter(Boolean).join(" · ") : [fmt(d.address_line1), fmt(d.city)].filter(Boolean).join(" · ");
    return {
      rowNo: r.row_no,
      entity,
      title: title || `Row ${r.row_no}`,
      detail,
      why: Array.isArray(m.ambiguous) ? "ambiguous" : "lookalike",
      decision: r.decision === "create" || r.decision === "skip" ? r.decision : null,
      candidates: ids.slice(0, 4).map((id) => {
        if (isPerson) {
          const hid = personHousehold.get(id);
          return { title: personName.get(id) ?? "Someone in your records", detail: (hid ? cards.get(hid) : null) ?? "not in a household yet" };
        }
        return { title: cards.get(id)?.split(" (")[0] ?? "A household in your records", detail: cards.get(id) ?? "" };
      }),
    };
  });
  return { ok: true, data: { rows: out, more: Math.max(0, (res.count ?? out.length) - out.length) } };
}
