// Calls to the Pathshala registration objects of migration 0590 (docs/PATHSHALA_REGISTRATION_PLAN.md §2.10–§2.11):
// the new columns of app.pathshala_terms and app.pathshala_levels, app.pathshala_level_fees, and the functions
// save_pathshala_level, set_pathshala_level_fees, set_pathshala_term_rules, open_pathshala_registration,
// pathshala_fee_example, pathshala_seats and pathshala_pay_now_ready. The generated types (src/lib/database.types.ts)
// are regenerated from the database by CI and do not know them until 0590 has run, so every call goes through ONE
// narrow cast here, the way src/lib/access-db.ts and src/lib/gyan-homework/db.ts do. Nothing else in the portal names
// these objects. Delete the cast, and use db.from / db.rpc directly, once the generated types carry them.
//
// Every call is defensive: a database without 0590 answers "does not exist" (PGRST202 / 42883 / 42P01 / 42703 /
// PGRST204 / PGRST205), and the caller then says "This needs the database update that is on its way" instead of an
// empty table or a crash.

import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";

import {
  LEVEL_COLUMNS,
  LEVEL_FEE_COLUMNS,
  TERM_RULE_COLUMNS,
  parseLevelFees,
  parseLevelRow,
  parseLevelRows,
  parseOpenResult,
  parsePayNowReady,
  parseQuote,
  parseSeats,
  parseTermRulesList,
  type ExampleLineInput,
  type LevelFee,
  type LevelFeeInput,
  type LevelInput,
  type LevelPatch,
  type LevelRow,
  type LevelSeats,
  type OpenResult,
  type Parsed,
  type Quote,
  type TermRules,
  type TermRulesInput,
} from "./contract";

type RpcError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };
type Rows = PromiseLike<RpcResult> & {
  eq: (column: string, value: string) => Rows;
  in: (column: string, values: readonly string[]) => Rows;
  order: (column: string, opts?: { ascending?: boolean }) => Rows;
};
type RegistrationClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: string) => { select: (columns: string) => Rows };
};

/** The same client, able to read the 0590 tables and columns and call its functions by name (the client itself is unchanged). */
function registrationDb(db: object): RegistrationClient {
  return db as unknown as RegistrationClient;
}

/** What the screens say while the database is older than 0590. */
export const NEEDS_UPDATE = "This needs the database update that is on its way (Pathshala levels and fees).";

export type Loaded<T> =
  | { status: "ok"; value: T }
  /** The database does not have migration 0590 yet. */
  | { status: "missing" }
  /** The call failed (permission, network, …): the error is for the page's plain-English message. */
  | { status: "error"; error: unknown }
  /** The call worked but sent something this page cannot read. */
  | { status: "shape"; message: string };

/** A write: `missing` when the database has no such function yet (older than 0590). */
export type Written<T> = { ok: true; value: T } | { ok: false; missing: boolean; error: unknown };

async function read<T>(what: string, call: () => PromiseLike<RpcResult>, parse: (data: unknown) => Parsed<T>): Promise<Loaded<T>> {
  try {
    const { data, error } = await call();
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce(what, error);
        return { status: "missing" };
      }
      console.error(`[pathshala-registration] could not read ${what}:`, error);
      return { status: "error", error };
    }
    const parsed = parse(data);
    if (!parsed.ok) {
      console.error(`[pathshala-registration] ${what} sent an unexpected shape (${parsed.error}):`, data);
      return { status: "shape", message: parsed.error };
    }
    return { status: "ok", value: parsed.value };
  } catch (e) {
    console.error(`[pathshala-registration] reading ${what} threw:`, e);
    return { status: "error", error: e };
  }
}

/**
 * A write whose answer the screen does not depend on (it reads the rows again): an unreadable answer after a write
 * that worked is logged and still reported as saved, never as a failure.
 */
async function write<T>(what: string, call: () => PromiseLike<RpcResult>, parse: (data: unknown) => T): Promise<Written<T>> {
  try {
    const { data, error } = await call();
    if (error) {
      if (isMissingObject(error)) warnMissingOnce(what, error);
      return { ok: false, missing: isMissingObject(error), error };
    }
    return { ok: true, value: parse(data) };
  } catch (e) {
    return { ok: false, missing: false, error: e };
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The 0590 rules of these terms (app.pathshala_terms' new columns), by term id. */
export function loadTermRules(db: object, termIds: readonly string[]): Promise<Loaded<Map<string, TermRules>>> {
  if (!termIds.length) return Promise.resolve({ status: "ok", value: new Map() });
  return read("app.pathshala_terms (0590 rules)", () => registrationDb(db).from("pathshala_terms").select(TERM_RULE_COLUMNS).in("id", termIds), parseTermRulesList);
}

/** The community's levels with the 0590 `active` flag, in order. */
export function loadLevelRows(db: object, centerId: string): Promise<Loaded<LevelRow[]>> {
  return read("app.pathshala_levels (0590 active)", () => registrationDb(db).from("pathshala_levels").select(LEVEL_COLUMNS).eq("center_id", centerId).order("sort_order"), parseLevelRows);
}

/** Every term's level fees in the community (this term's, and earlier terms' to suggest from). */
export function loadLevelFees(db: object, centerId: string): Promise<Loaded<LevelFee[]>> {
  return read("app.pathshala_level_fees", () => registrationDb(db).from("pathshala_level_fees").select(LEVEL_FEE_COLUMNS).eq("center_id", centerId), parseLevelFees);
}

/** app.pathshala_seats(p_term): per level, seats, taken, held, free, the waitlist's length and whether it is on. */
export function loadSeats(db: object, termId: string): Promise<Loaded<LevelSeats[]>> {
  return read("app.pathshala_seats", () => registrationDb(db).rpc("pathshala_seats", { p_term: termId }), parseSeats);
}

/** app.pathshala_pay_now_ready(p_center): null when pay now may be chosen, else the sentence saying why not (P20). */
export function loadPayNowReady(db: object, centerId: string): Promise<Loaded<string | null>> {
  return read("app.pathshala_pay_now_ready", () => registrationDb(db).rpc("pathshala_pay_now_ready", { p_center: centerId }), parsePayNowReady);
}

// ---------------------------------------------------------------------------
// Writes (each function re-checks who may, and every value). The reason is the person's own words, or null: each
// 0590 function then records its own plain one ("Set Pathshala fees for 2026-27: Toddler $45.00, …").
// ---------------------------------------------------------------------------

/**
 * app.save_pathshala_level(p_center, p_level, p_reason): create (no id) or edit; a used level is retired, never deleted.
 * An edit may send only the keys it changes (0590: a key left out keeps its value), as retiring does: {id, active}.
 */
export function saveLevel(db: object, centerId: string, level: LevelInput | LevelPatch, reason: string | null): Promise<Written<LevelRow | null>> {
  return write("app.save_pathshala_level", () => registrationDb(db).rpc("save_pathshala_level", { p_center: centerId, p_level: level, p_reason: reason }), (data) => {
    const parsed = parseLevelRow(data);
    if (parsed.ok) return parsed.value;
    // The level was saved; only its answer cannot be read. The screen reads the levels again, so this is logged, not shown.
    console.error(`[pathshala-registration] app.save_pathshala_level saved the level but sent an unexpected answer (${parsed.error}):`, data);
    return null;
  });
}

/** app.set_pathshala_level_fees(p_term, p_fees, p_reason): before the lock pathshala.manage (or giving.manage); after it giving.manage with a reason. */
export function setLevelFees(db: object, termId: string, fees: readonly LevelFeeInput[], reason: string | null): Promise<Written<null>> {
  return write("app.set_pathshala_level_fees", () => registrationDb(db).rpc("set_pathshala_level_fees", { p_term: termId, p_fees: fees, p_reason: reason }), () => null);
}

/** app.set_pathshala_term_rules(p_term, p_rules, p_reason): refuses pay now with the readiness sentence. */
export function setTermRules(db: object, termId: string, rules: TermRulesInput, reason: string | null): Promise<Written<null>> {
  return write("app.set_pathshala_term_rules", () => registrationDb(db).rpc("set_pathshala_term_rules", { p_term: termId, p_rules: rules, p_reason: reason }), () => null);
}

/**
 * app.open_pathshala_registration(p_term, p_reason): checks every offered level's fee (and pay-now readiness), links the
 * fees to the Pathshala fund and campaign, locks fees and rules, opens a draft. Idempotent (already_open).
 */
export function openRegistration(db: object, termId: string, reason: string | null): Promise<Written<OpenResult>> {
  return write("app.open_pathshala_registration", () => registrationDb(db).rpc("open_pathshala_registration", { p_term: termId, p_reason: reason }), parseOpenResult);
}

/**
 * app.pathshala_fee_example(p_term, p_lines): "Try a family" — the quote for made-up learners; writes nothing. p_lines
 * is always {lines, late} (0590), so the screen's tick decides the late window, never today's date. A line the
 * database cannot price comes back with its `refusal` and is not in the totals.
 */
export async function feeExample(db: object, termId: string, lines: readonly ExampleLineInput[], late = false): Promise<Written<Quote>> {
  const pLines = { lines, late };
  const res = await write("app.pathshala_fee_example", () => registrationDb(db).rpc("pathshala_fee_example", { p_term: termId, p_lines: pLines }), (data) => ({ data, parsed: parseQuote(data) }));
  if (!res.ok) return res;
  if (!res.value.parsed.ok) {
    console.error(`[pathshala-registration] app.pathshala_fee_example sent an unexpected shape (${res.value.parsed.error}):`, res.value.data);
    return {
      ok: false,
      missing: false,
      error: { message: `the database answered with something this screen cannot read (${res.value.parsed.error}). Has the latest migration been applied?` },
    };
  }
  return { ok: true, value: res.value.parsed.value };
}
