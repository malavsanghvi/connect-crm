import "server-only";

// The server half of the matching questions: reads an import run's rows, hands them to the pure engine (./run), and saves what
// the engine found through the database functions of migration 0631. Everything runs as the signed-in person, under their own
// session: the database checks who may use the run (the people who may import today), so nothing here widens access.
//
// PERSONAL DATA. The records are the uploaded rows. Nothing here logs a row, a value, or a database error's `details` (a
// constraint error's details can quote the row): only the error code and its message are logged, and the messages of our own
// functions are plain sentences. Nothing is sent to a model.
//
// The database is reached through `ResolveDb`, a narrow interface (two calls), so the flow can be tested with a fake and does
// not depend on the generated types of functions that did not exist when it was written.

import { fetchAll } from "@/lib/data/fetch-all";
import { explainError, type DbErrorLike } from "@/lib/errors";

import { makeConfig, type ConfigOverrides, type ResolveConfig } from "./config";
import type { AnswerCode } from "./exceptions";
import { isExistingRecordId, isResolvableEntity, rawRecordsFromImportRows, type ImportRowLike } from "./from-import";
import { detectDateOrder } from "./normalize";
import {
  PAGE_SIZE,
  clusterPayloads,
  groupPayloads,
  itemPayloads,
  metricsForRun,
  pagesOf,
  pairPayloads,
  recordPayloads,
  rulesFromRows,
  stagePayloads,
} from "./payloads";
import { resolveRecords } from "./run";
import type { DecisionRule } from "./memory";
import type { RunMetrics } from "./metrics";
import type { Locale } from "./strings";
import type { RawRecord } from "./types";
import {
  parseAnswerOutcome,
  parseInbox,
  parseItemDetail,
  parseRunMetrics,
  parseRuns,
  type AnswerOutcome,
  type InboxView,
  type ItemDetail,
  type RunMetricsView,
  type RunRow,
} from "./views";

/** Written with every saved result, so a run can be told apart from one made by a later version of the rules. */
export const RESOLVE_ENGINE_VERSION = "resolve-1";

// ---------------------------------------------------------------------------
// The database, as far as this module needs it
// ---------------------------------------------------------------------------

type DbResult<T> = PromiseLike<{ data: T; error: DbErrorLike | null }>;

export type ResolveDb = {
  /** A database function of the app schema, by name, with named arguments (RPC). */
  rpc(fn: string, args: Record<string, unknown>): DbResult<unknown>;
  /** A page of the staged rows of an import run (columns of import_rows), by row number. */
  importRows(runId: string, from: number, to: number): DbResult<ImportRowLike[] | null>;
};

type ClientLike = {
  rpc(fn: string, args: Record<string, unknown>): DbResult<unknown>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { order(column: string): { range(from: number, to: number): DbResult<ImportRowLike[] | null> } };
    };
  };
};

/** Wraps the signed-in person's Supabase client (`session.db`). The client's generic types are deliberately not carried over. */
export function resolveDbOf(client: unknown): ResolveDb {
  const c = client as ClientLike;
  return {
    rpc: (fn, args) => c.rpc(fn, args),
    importRows: (runId, from, to) => c.from("import_rows").select("row_no, source_key, data, extra").eq("run_id", runId).order("row_no").range(from, to),
  };
}

/** The arguments of each database function this module calls (tests/onboarding-resolve-store.test.ts keeps them equal to 0631). */
export const RPC = {
  resolve_stage_records: ["p_run", "p_records", "p_first"],
  resolve_staged_page: ["p_run", "p_after", "p_limit"],
  resolve_begin: ["p_run", "p_engine_version", "p_config"],
  resolve_store_records: ["p_run", "p_batch", "p_records"],
  resolve_store_pairs: ["p_run", "p_batch", "p_pairs"],
  resolve_store_clusters: ["p_run", "p_batch", "p_clusters"],
  resolve_store_groups: ["p_run", "p_batch", "p_groups"],
  resolve_store_items: ["p_run", "p_batch", "p_items"],
  resolve_finish: ["p_run", "p_batch", "p_metrics"],
  resolve_rules: ["p_center"],
  resolve_inbox: ["p_run"],
  resolve_item_detail: ["p_item"],
  resolve_run_metrics: ["p_run"],
  resolve_runs: ["p_center"],
  resolve_answer: ["p_group", "p_answer", "p_item", "p_apply_rest", "p_remember", "p_scope", "p_expected_others", "p_change"],
  resolve_set_group_status: ["p_group", "p_status", "p_routed_to"],
  resolve_reopen: ["p_group"],
  resolve_revoke_rule: ["p_center", "p_rule"],
} as const satisfies Record<string, readonly string[]>;

export type RpcName = keyof typeof RPC;

// ---------------------------------------------------------------------------
// Results and errors
// ---------------------------------------------------------------------------

/** Either the answer, or one plain-English sentence for the person ("Could not … — …") and whether the cause was access. */
export type StoreResult<T> = { ok: true; data: T } | { ok: false; error: string; denied?: boolean };

class StepError extends Error {
  constructor(
    readonly context: string,
    readonly cause: DbErrorLike | { message: string },
  ) {
    super(context);
  }
}

/** The sentence for a database error. Our own functions raise plain sentences; a permission one keeps its sentence. */
function reasonOf(error: DbErrorLike): string {
  const message = String(error.message ?? "").trim();
  if (error.code === "42501" && message && !/row-level security|permission denied/i.test(message)) return message;
  return explainError(error);
}

function toFailure(context: string, error: unknown): { ok: false; error: string; denied?: boolean } {
  if (error instanceof StepError) {
    const e = error.cause as DbErrorLike;
    // Code and message only: a constraint error's details can quote the row.
    console.error(`[onboarding-resolve] ${error.context}:`, { code: e.code ?? null, message: String(e.message ?? "").slice(0, 300) });
    const reason = reasonOf(e);
    const text = `${error.context} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`;
    return { ok: false, error: text, ...(e.code === "42501" ? { denied: true } : {}) };
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[onboarding-resolve] ${context}:`, { message: message.slice(0, 300) });
  return { ok: false, error: `${context} — ${message}${/[.!?]$/.test(message) ? "" : "."}` };
}

async function call<T = unknown>(db: ResolveDb, fn: RpcName, args: Record<string, unknown>, context: string): Promise<T> {
  const allowed: readonly string[] = RPC[fn];
  for (const k of Object.keys(args)) if (!allowed.includes(k)) throw new Error(`${fn} does not take ${k}`);
  const res = await db.rpc(fn, args);
  if (res.error) throw new StepError(context, res.error);
  return res.data as T;
}

/** Sends pages a few at a time (the pages of one kind touch different rows, so their order does not matter). */
async function sendPages<T>(pages: readonly T[][], send: (page: T[]) => Promise<unknown>, concurrency = 3): Promise<void> {
  for (let i = 0; i < pages.length; i += concurrency) await Promise.all(pages.slice(i, i + concurrency).map((p) => send(p)));
}

// ---------------------------------------------------------------------------
// Settings of a run
// ---------------------------------------------------------------------------

/**
 * The engine's settings for these records: the defaults, today's date in the community's time zone, and for each source the
 * day/month order its own dates prove (a date the engine cannot read one way is flagged, never guessed).
 */
export function makeRunConfig(records: readonly RawRecord[], today: string, overrides: ConfigOverrides = {}): ResolveConfig {
  const bySource = new Map<string, unknown[]>();
  for (const r of records) {
    const list = bySource.get(r.source) ?? [];
    if (r.dob) list.push(r.dob);
    if (r.gift) list.push(r.gift.date);
    bySource.set(r.source, list);
  }
  const dateOrderBySource: Record<string, "mdy" | "dmy"> = { ...overrides.dateOrderBySource };
  for (const [source, values] of bySource) {
    if (source in dateOrderBySource) continue;
    const found = detectDateOrder(values);
    if (found.order !== "unknown") dateOrderBySource[source] = found.order;
  }
  return makeConfig(today, { ...overrides, dateOrderBySource });
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

/** Stages records for matching, replacing whatever was staged for the run. */
export async function stageRecords(db: ResolveDb, runId: string, records: readonly RawRecord[]): Promise<StoreResult<{ staged: number }>> {
  const context = "Could not get the rows ready to look for matches";
  try {
    const pages = pagesOf(stagePayloads(records), PAGE_SIZE.records);
    if (pages.length === 0) return { ok: false, error: `${context} — there are no rows.` };
    let staged = 0;
    for (const [i, page] of pages.entries()) {
      const n = await call<number>(db, "resolve_stage_records", { p_run: runId, p_records: page, p_first: i === 0 }, context);
      staged += typeof n === "number" ? n : page.length;
    }
    return { ok: true, data: { staged } };
  } catch (e) {
    return toFailure(context, e);
  }
}

/** The staged rows of an import run as records (rows of the people, households or payments file), in row order. */
export async function readImportRows(db: ResolveDb, runId: string, entity: string, source: string): Promise<StoreResult<RawRecord[]>> {
  const context = "Could not read the rows of the import";
  if (!isResolvableEntity(entity)) return { ok: false, error: `${context} — rows of this kind are not checked for matches yet.` };
  const got = await fetchAll<ImportRowLike>((from, to) => db.importRows(runId, from, to), { pageSize: 1000, max: 200_000 });
  if (got.error) return toFailure(context, new StepError(context, got.error));
  if (got.truncated) return { ok: false, error: `${context} — the file has more rows than can be checked in one go (200,000).` };
  return { ok: true, data: rawRecordsFromImportRows(entity, got.data, source) };
}

async function readStaged(db: ResolveDb, runId: string, context: string): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  let after = -1;
  for (;;) {
    const page = await call<Array<{ id: string; order_no: number; raw: RawRecord | null }>>(
      db,
      "resolve_staged_page",
      { p_run: runId, p_after: after, p_limit: 500 },
      context,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      if (!row.raw || typeof row.raw !== "object") {
        throw new Error("the original rows of this import were cleared after 90 days. Upload the file again.");
      }
      out.push(row.raw);
      after = Math.max(after, row.order_no);
    }
    if (page.length < 500) break;
  }
  return out;
}

/** The community's remembered answers, as the engine reads them. */
export async function loadRules(db: ResolveDb, centerId: string): Promise<StoreResult<{ rules: DecisionRule[]; skipped: number }>> {
  const context = "Could not read the answers you gave before";
  try {
    return { ok: true, data: rulesFromRows(await call(db, "resolve_rules", { p_center: centerId }, context)) };
  } catch (e) {
    return toFailure(context, e);
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type ResolveRunInput = {
  runId: string;
  centerId: string;
  /** YYYY-MM-DD in the community's time zone (decides who is under 18). */
  today: string;
  overrides?: ConfigOverrides;
  locale?: Locale;
};

export type ResolveSummary = {
  runId: string;
  engineVersion: string;
  /** Rows of the file (households already in the records, kept as link targets, are not counted). */
  rows: number;
  linkTargets: number;
  /** Questions after grouping, and the items inside them. */
  questions: number;
  items: number;
  /** Items a remembered answer already answered, and how many remembered answers were used. */
  answeredByRules: number;
  rulesUsed: number;
  /** Remembered answers that could not be read (those questions are asked again). */
  rulesSkipped: number;
  metrics: RunMetrics;
  /** One plain sentence about the questions against the target. */
  summary: string;
};

/**
 * Looks for matches in the rows already staged for the run and saves what it finds: the records with what happens to each, the
 * scored pairs, the households and people joined, the questions (ranked by value) and their items. The community's remembered
 * answers are loaded first, so a question a person has already answered is not asked again. Saving the same result twice changes
 * nothing, and a person's earlier answers are kept.
 */
export async function resolveStagedRun(db: ResolveDb, input: ResolveRunInput): Promise<StoreResult<ResolveSummary>> {
  const context = "Could not look for matches";
  try {
    const records = await readStaged(db, input.runId, context);
    if (records.length === 0) return { ok: false, error: `${context} — there are no rows to check.` };
    const loaded = rulesFromRows(await call(db, "resolve_rules", { p_center: input.centerId }, context));
    const cfg = makeRunConfig(records, input.today, input.overrides);
    const result = resolveRecords({ records, config: cfg, rules: loaded.rules, locale: input.locale });
    const metrics = metricsForRun(result, cfg, isExistingRecordId);

    const batch = await call<string>(db, "resolve_begin", { p_run: input.runId, p_engine_version: RESOLVE_ENGINE_VERSION, p_config: cfg }, context);
    const send = (fn: RpcName, key: string) => (page: unknown[]) => call(db, fn, { p_run: input.runId, p_batch: batch, [key]: page }, context);
    await sendPages(pagesOf(recordPayloads(result), PAGE_SIZE.records), send("resolve_store_records", "p_records"));
    await sendPages(pagesOf(pairPayloads(result.pairs), PAGE_SIZE.pairs), send("resolve_store_pairs", "p_pairs"));
    await sendPages(pagesOf(clusterPayloads(result), PAGE_SIZE.clusters), send("resolve_store_clusters", "p_clusters"));
    await sendPages(pagesOf(groupPayloads(result.groups), PAGE_SIZE.groups), send("resolve_store_groups", "p_groups"));
    await sendPages(pagesOf(itemPayloads(result.items, result.answeredByRules, loaded.rules), PAGE_SIZE.items), send("resolve_store_items", "p_items"));
    await call(db, "resolve_finish", { p_run: input.runId, p_batch: batch, p_metrics: metrics }, context);

    const targets = result.records.filter((r) => isExistingRecordId(r.id)).length;
    return {
      ok: true,
      data: {
        runId: input.runId,
        engineVersion: RESOLVE_ENGINE_VERSION,
        rows: result.records.length - targets,
        linkTargets: targets,
        questions: result.groups.length,
        items: result.items.length,
        answeredByRules: result.answeredByRules.length,
        rulesUsed: new Set(result.answeredByRules.map((a) => a.ruleId)).size,
        rulesSkipped: loaded.skipped,
        metrics,
        summary: result.budget.summary,
      },
    };
  } catch (e) {
    return toFailure(context, e);
  }
}

export type ResolveImportRunInput = ResolveRunInput & {
  /** The run's data type: people, households or payments. */
  entity: string;
  /** The file's name, used to name its rows ("people.csv#12"). */
  source: string;
  /** Households already in the records, as link targets (see existingToRawRecords). */
  linkTargets?: readonly RawRecord[];
};

/** The whole thing for an import run: its staged rows become records, are staged for matching, and are checked. */
export async function resolveImportRun(db: ResolveDb, input: ResolveImportRunInput): Promise<StoreResult<ResolveSummary>> {
  const rows = await readImportRows(db, input.runId, input.entity, input.source);
  if (!rows.ok) return rows;
  const records = [...rows.data, ...(input.linkTargets ?? [])];
  const staged = await stageRecords(db, input.runId, records);
  if (!staged.ok) return staged;
  return resolveStagedRun(db, input);
}

// ---------------------------------------------------------------------------
// What the screens read and do
// ---------------------------------------------------------------------------

async function read<T>(context: string, get: () => Promise<unknown>, parse: (json: unknown) => T | null): Promise<StoreResult<T>> {
  try {
    const value = parse(await get());
    if (value === null) return { ok: false, error: `${context} — the database answered in a form this page does not understand. Reload the page.` };
    return { ok: true, data: value };
  } catch (e) {
    return toFailure(context, e);
  }
}

/** The imports of the community that can be checked for matches, newest first, with where each check stands. */
export function loadRuns(db: ResolveDb, centerId: string): Promise<StoreResult<RunRow[]>> {
  const context = "Could not list your imports";
  return read(context, () => call(db, "resolve_runs", { p_center: centerId }, context), parseRuns);
}

/** The inbox of a run: the questions ranked by value, and where they stand. */
export function loadInbox(db: ResolveDb, runId: string): Promise<StoreResult<InboxView>> {
  const context = "Could not open the questions";
  return read(context, () => call(db, "resolve_inbox", { p_run: runId }, context), parseInbox);
}

/** One item for its card: the pair, what agrees and what does not, and each record. */
export function loadItemDetail(db: ResolveDb, itemId: string): Promise<StoreResult<ItemDetail>> {
  const context = "Could not open this question";
  return read(context, () => call(db, "resolve_item_detail", { p_item: itemId }, context), parseItemDetail);
}

/** What the engine measured for the run, and how the questions stand now. */
export function loadRunMetrics(db: ResolveDb, runId: string): Promise<StoreResult<RunMetricsView>> {
  const context = "Could not read the numbers of this check";
  return read(context, () => call(db, "resolve_run_metrics", { p_run: runId }, context), parseRunMetrics);
}

export type AnswerInput = {
  groupId: string;
  answer: AnswerCode;
  /** The item the answer is for; the first open one when left out. */
  itemId?: string;
  /** "Same answer for the other N". */
  applyToRest?: boolean;
  /** The N the person was shown: the database refuses when the number it would answer is not this one. Needed with applyToRest. */
  expectedOthers?: number;
  /** Replace an answer the item already has, on purpose. One item at a time. */
  change?: boolean;
  /** Remember it for the community (default yes). */
  remember?: boolean;
  scope?: "exact_pair" | "identifier" | "pattern";
};

/** A person's answer. Held items (a child, a money conflict) are answered one at a time and never remembered. */
export function answerGroup(db: ResolveDb, input: AnswerInput): Promise<StoreResult<AnswerOutcome>> {
  const context = "Could not record your answer";
  return read(
    context,
    () =>
      call(
        db,
        "resolve_answer",
        {
          p_group: input.groupId,
          p_answer: input.answer,
          ...(input.itemId ? { p_item: input.itemId } : {}),
          p_apply_rest: input.applyToRest === true,
          p_remember: input.remember !== false,
          ...(input.scope ? { p_scope: input.scope } : {}),
          ...(input.applyToRest === true && input.expectedOthers !== undefined ? { p_expected_others: input.expectedOthers } : {}),
          ...(input.change === true ? { p_change: true } : {}),
        },
        context,
      ),
    parseAnswerOutcome,
  );
}

/** Put a question off (later), skip it, send it on, or open it again. */
export async function setGroupStatus(
  db: ResolveDb,
  input: { groupId: string; status: "open" | "postponed" | "skipped" | "sent"; routedTo?: string },
): Promise<StoreResult<null>> {
  const context = input.status === "open" ? "Could not open the question again" : input.status === "sent" ? "Could not pass the question on" : "Could not put the question off";
  try {
    await call(db, "resolve_set_group_status", { p_group: input.groupId, p_status: input.status, ...(input.routedTo ? { p_routed_to: input.routedTo } : {}) }, context);
    return { ok: true, data: null };
  } catch (e) {
    return toFailure(context, e);
  }
}

/** Take a question's answers back (and withdraw the remembered answers made from it). */
export async function reopenGroup(db: ResolveDb, groupId: string): Promise<StoreResult<null>> {
  const context = "Could not take the answers back";
  try {
    await call(db, "resolve_reopen", { p_group: groupId }, context);
    return { ok: true, data: null };
  } catch (e) {
    return toFailure(context, e);
  }
}

/** Withdraw one remembered answer. */
export async function revokeRule(db: ResolveDb, input: { centerId: string; ruleId: string }): Promise<StoreResult<null>> {
  const context = "Could not withdraw the remembered answer";
  try {
    await call(db, "resolve_revoke_rule", { p_center: input.centerId, p_rule: input.ruleId }, context);
    return { ok: true, data: null };
  } catch (e) {
    return toFailure(context, e);
  }
}
