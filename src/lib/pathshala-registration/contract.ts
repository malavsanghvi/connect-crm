// Pathshala registration, wave 1 (docs/PATHSHALA_REGISTRATION_PLAN.md, version 2, accepted 2026-10-06): the database
// objects of migration 0590 as the portal sends and reads them — the term's rules (§2.10), the level fees, the level's
// `active` flag, app.save_pathshala_level, app.set_pathshala_level_fees, app.set_pathshala_term_rules,
// app.open_pathshala_registration, app.pathshala_fee_example, app.pathshala_seats and app.pathshala_pay_now_ready
// (§2.11), with the quote's line shape (§2.17, app.pathshala_quote). Names and shapes follow 0590 as written by the
// database pull request (feat/pathshala-db1); the plan's §2.17 is the contract where 0590 says nothing more. Pure (no
// server imports): the Levels and Fees screens, their actions and the tests share it. The database decides every rule;
// these readers only refuse to show what they cannot read.

type Obj = Record<string, unknown>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};
const first = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return null;
};

// ---------------------------------------------------------------------------
// Vocabulary (the 0590 check constraints, §2.10)
// ---------------------------------------------------------------------------
export const PAYMENT_MODES = ["pledge", "pay_now"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export const SEAT_RULES = ["automatic", "office"] as const;
export type SeatRule = (typeof SEAT_RULES)[number];
export type LearnerKind = "child" | "adult";

export function isPaymentMode(v: unknown): v is PaymentMode {
  return typeof v === "string" && (PAYMENT_MODES as readonly string[]).includes(v);
}
export function isSeatRule(v: unknown): v is SeatRule {
  return typeof v === "string" && (SEAT_RULES as readonly string[]).includes(v);
}

/** A seat held for payment: 48 hours by default, 1 to 168 (P17). */
export const HOLD_HOURS = { min: 1, max: 168, default: 48 } as const;
/** Paying at the office holds the seat 7 days by default, 1 to 21 (P18). */
export const OFFICE_HOLD_DAYS = { min: 1, max: 21, default: 7 } as const;
/** A level's age band, in whole years on the term's age cut-off date (§2.10: ages 0–120). */
export const AGE_LIMITS = { min: 0, max: 120 } as const;
/** An adult class has a minimum age of 18 or more; a children's level a maximum under 18 (§2.1). */
export const ADULT_AGE = 18;
/** The smallest online payment (app.create_checkout, 0211:758): a fee is $0 or at least this (§2.2). */
export const MIN_FEE_CENTS = 50;
/** The largest fee, family cap or late fee 0590 accepts ($1,000,000). */
export const MAX_FEE_CENTS = 100_000_000;
/** A level's order (0590: between -1000 and 1000). */
export const SORT_ORDER_LIMITS = { min: -1000, max: 1000 } as const;

// ---------------------------------------------------------------------------
// The term's rules: the 0590 columns of app.pathshala_terms (§2.10)
// ---------------------------------------------------------------------------
export type TermRules = {
  term_id: string;
  payment_mode: PaymentMode;
  hold_hours: number;
  office_payment_allowed: boolean;
  office_hold_days: number;
  seat_rule: SeatRule;
  campaign_id: string | null;
  fund_id: string | null;
  /** The late window runs from registration_closes_at to this instant (P4); null = no late window. */
  late_registration_closes_at: string | null;
  late_fee_cents: number;
  /** Withdraw by this date and the fee pledge is cancelled (P5); null = the first class day + 14 days, fixed when registration opens. */
  withdrawal_credit_until: string | null;
  /** Ages are measured on this date (P11); null = the first day of term, fixed when registration opens. */
  age_cutoff_on: string | null;
  /** Set by app.open_pathshala_registration (P9, P16): fees and rules are locked from then on. */
  fees_locked_at: string | null;
  fees_locked_by: string | null;
};

export const TERM_RULE_COLUMNS =
  "id, payment_mode, hold_hours, office_payment_allowed, office_hold_days, seat_rule, campaign_id, fund_id, late_registration_closes_at, late_fee_cents, withdrawal_credit_until, age_cutoff_on, fees_locked_at, fees_locked_by";

/**
 * What app.set_pathshala_term_rules(p_term, p_rules, p_reason) takes (0590: these keys only; a key left out keeps its
 * value). The sibling discount and the family cap are the term's existing columns (0006), now set here instead of on
 * the term's form. `fund_id` needs giving.manage: it is sent only when the treasurer picks another fund.
 */
export type TermRulesInput = {
  payment_mode: PaymentMode;
  hold_hours: number;
  office_payment_allowed: boolean;
  office_hold_days: number;
  seat_rule: SeatRule;
  sibling_discount_pct: number;
  /** null: no cap; else at least $0.50. */
  fee_per_family_cap_cents: number | null;
  late_registration_closes_at: string | null;
  /** $0, or at least $0.50. */
  late_fee_cents: number;
  withdrawal_credit_until: string | null;
  age_cutoff_on: string | null;
  fund_id?: string | null;
};

export function parseTermRules(row: unknown): Parsed<TermRules> {
  if (!isObj(row)) return { ok: false, error: "a term's rules are not an object" };
  const id = str(row.id) ?? str(row.term_id);
  if (!id) return { ok: false, error: "a term's rules have no id" };
  const mode = row.payment_mode ?? "pledge";
  if (!isPaymentMode(mode)) return { ok: false, error: `unknown payment mode "${String(mode)}"` };
  const seat = row.seat_rule ?? "automatic";
  if (!isSeatRule(seat)) return { ok: false, error: `unknown seat rule "${String(seat)}"` };
  return {
    ok: true,
    value: {
      term_id: id,
      payment_mode: mode,
      hold_hours: int(row.hold_hours) ?? HOLD_HOURS.default,
      office_payment_allowed: row.office_payment_allowed === true,
      office_hold_days: int(row.office_hold_days) ?? OFFICE_HOLD_DAYS.default,
      seat_rule: seat,
      campaign_id: str(row.campaign_id),
      fund_id: str(row.fund_id),
      late_registration_closes_at: str(row.late_registration_closes_at),
      late_fee_cents: int(row.late_fee_cents) ?? 0,
      withdrawal_credit_until: str(row.withdrawal_credit_until),
      age_cutoff_on: str(row.age_cutoff_on),
      fees_locked_at: str(row.fees_locked_at),
      fees_locked_by: str(row.fees_locked_by),
    },
  };
}

export function parseTermRulesList(data: unknown): Parsed<Map<string, TermRules>> {
  if (!Array.isArray(data)) return { ok: false, error: "the terms' rules are not a list" };
  const out = new Map<string, TermRules>();
  for (const row of data) {
    const r = parseTermRules(row);
    if (!r.ok) return r;
    out.set(r.value.term_id, r.value);
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Levels (app.pathshala_levels with the 0590 `active` flag; app.save_pathshala_level)
// ---------------------------------------------------------------------------
export type LevelRow = {
  id: string;
  track_id: string;
  key: string;
  name: string;
  sort_order: number;
  min_age: number | null;
  max_age: number | null;
  /** False once retired: not offered, history kept (§2.1). */
  active: boolean;
};

export const LEVEL_COLUMNS = "id, track_id, key, name, sort_order, min_age, max_age, active";

/**
 * What app.save_pathshala_level(p_center, p_level, p_reason) takes (0590: id, track_id, key, name, sort_order, min_age,
 * max_age, active — no other key): no id = a new level. It answers with the level plus its track's name, its band
 * (adult, children, any) and whether it is used. The level drawer leaves `active` out (0590 keeps a key left out, and
 * a new level is offered), so an edit made on a stale page never retires or offers a level again: only the Retire and
 * Offer again buttons change it (LevelPatch).
 */
export type LevelInput = {
  id?: string;
  track_id: string;
  key: string;
  name: string;
  sort_order: number;
  min_age: number | null;
  max_age: number | null;
  active?: boolean;
};

/** Retiring or offering a level again: only the id and the flag (0590 keeps every key left out). */
export type LevelPatch = { id: string; active: boolean };

export function parseLevelRow(row: unknown): Parsed<LevelRow> {
  if (!isObj(row)) return { ok: false, error: "a level is not an object" };
  const id = str(row.id);
  const track = str(row.track_id);
  const name = str(row.name);
  if (!id || !track || !name) return { ok: false, error: "a level has no id, track or name" };
  return {
    ok: true,
    value: {
      id,
      track_id: track,
      key: typeof row.key === "string" ? row.key : "",
      name,
      sort_order: int(row.sort_order) ?? 0,
      min_age: int(row.min_age),
      max_age: int(row.max_age),
      active: row.active !== false,
    },
  };
}

export function parseLevelRows(data: unknown): Parsed<LevelRow[]> {
  if (!Array.isArray(data)) return { ok: false, error: "the levels are not a list" };
  const out: LevelRow[] = [];
  for (const row of data) {
    const r = parseLevelRow(row);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Level fees (app.pathshala_level_fees; app.set_pathshala_level_fees)
// ---------------------------------------------------------------------------
export type LevelFee = { term_id: string; level_id: string; fee_cents: number; set_by: string | null; set_at: string | null };

export const LEVEL_FEE_COLUMNS = "term_id, level_id, fee_cents, set_by, set_at";

/**
 * One entry of p_fees in app.set_pathshala_level_fees(p_term, p_fees, p_reason): $0 ("Free") or at least $0.50, at most
 * $1,000,000. (0590 also reads fee_cents null as "remove the fee"; this screen never removes one.)
 */
export type LevelFeeInput = { level_id: string; fee_cents: number };

export function parseLevelFees(data: unknown): Parsed<LevelFee[]> {
  if (!Array.isArray(data)) return { ok: false, error: "the level fees are not a list" };
  const out: LevelFee[] = [];
  for (const row of data) {
    if (!isObj(row)) return { ok: false, error: "a level fee is not an object" };
    const term = str(row.term_id);
    const level = str(row.level_id);
    const fee = int(row.fee_cents);
    if (!term || !level || fee === null) return { ok: false, error: "a level fee has no term, level or whole-cent amount" };
    out.push({ term_id: term, level_id: level, fee_cents: fee, set_by: str(row.set_by), set_at: str(row.set_at) });
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Seats (app.pathshala_seats(p_term), 0590: per offered level — active, with a class this term — {level_id, level,
// track_id, track, fee_cents, classes, seats, taken, held, free, waitlist, waitlist_on, state})
// ---------------------------------------------------------------------------
export type LevelSeats = {
  level_id: string;
  /** The sum of the capacities of the level's classes; null when a class has no limit (0006:53). */
  seats: number | null;
  taken: number;
  held: number;
  /** Null when there is no limit. */
  free: number | null;
  waitlist: number;
  waitlist_on: boolean;
};

export function parseSeats(data: unknown): Parsed<LevelSeats[]> {
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.levels) ? data.levels : null;
  if (!list) return { ok: false, error: "the seats are not a list" };
  const out: LevelSeats[] = [];
  for (const row of list) {
    if (!isObj(row)) return { ok: false, error: "a level's seats are not an object" };
    const level = str(row.level_id);
    if (!level) return { ok: false, error: "a level's seats have no level id" };
    out.push({
      level_id: level,
      seats: int(first(row, "seats", "capacity")),
      taken: int(row.taken) ?? 0,
      held: int(row.held) ?? 0,
      free: int(row.free),
      waitlist: int(first(row, "waitlist", "waitlist_length", "waitlisted")) ?? 0,
      waitlist_on: first(row, "waitlist_on", "waitlist_enabled") === true,
    });
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Pay-now readiness (app.pathshala_pay_now_ready(p_center): null when pay now may be chosen, else the sentence — §2.11)
// ---------------------------------------------------------------------------
export function parsePayNowReady(data: unknown): Parsed<string | null> {
  if (data === null || data === undefined) return { ok: true, value: null };
  if (typeof data === "string") return { ok: true, value: data.trim() === "" ? null : data.trim() };
  if (isObj(data)) {
    const sentence = str(data.reason) ?? str(data.sentence);
    if (data.ready === true) return { ok: true, value: null };
    if (sentence) return { ok: true, value: sentence };
  }
  return { ok: false, error: "the pay-now answer is neither empty nor a sentence" };
}

// ---------------------------------------------------------------------------
// The quote (§2.4) as "Try a family" shows it: app.pathshala_fee_example(p_term, p_lines) prices made-up learners
// with the one pricing rule and answers in app.pathshala_quote's shape (it writes nothing).
// ---------------------------------------------------------------------------
/**
 * One made-up learner of p_lines (0590: [{name, learner, age | date_of_birth, learner_kind, track_id, level_id}]): a
 * name for the screen, their age in whole years on the term's age cut-off date (under 18 is a child) and the level.
 * Lines with the same `learner` (trimmed, case-insensitive) are ONE learner — one child for the sibling order and the
 * family cap, one late fee — so a learner in two classes (two tracks, P10) is priced as a registration would price
 * them. The screen sends `learner` = the row's name whenever a name is typed. p_lines is sent as
 * {"lines": [...], "late": <the screen's tick>}.
 */
export type ExampleLineInput = { name: string; learner?: string; age: number; level_id: string };

export type QuoteLine = {
  /** The line's position in p_lines, from 1 (0590); null when the database did not say. */
  index: number | null;
  /** A name, when the database echoes one (0590's example does not: the screen keeps its own by `index`). */
  first_name: string | null;
  /** The example's row the line came from (set by the Fees screen's action, never by the database). */
  row_key: string | null;
  person_id: string | null;
  track_id: string | null;
  level_id: string | null;
  /** Null only on a refused line that does not say. */
  learner_kind: LearnerKind | null;
  /** Children only: 1 pays the full fee (P2). */
  family_rank: number | null;
  age_on_cutoff: number | null;
  outcome: string | null;
  base_fee_cents: number;
  sibling_discount_cents: number;
  cap_reduction_cents: number;
  late_fee_cents: number;
  assistance_cents: number;
  total_cents: number;
  /** False: a "not sure of the level" line the office still prices (P25), or a refused line. */
  priced: boolean;
  /**
   * Why the database could not price this line, as a plain sentence ("Jainism 2 is a children's class, and Mira is an
   * adult."), else null. A refused line has priced false and zero amounts and is left out of the totals.
   */
  refusal: string | null;
};

export type Quote = { lines: QuoteLine[]; children_total_cents: number; adults_total_cents: number; total_cents: number; late: boolean };

/** The lines the database refused to price (each carries its sentence). */
export function refusedLines(q: Pick<Quote, "lines">): QuoteLine[] {
  return q.lines.filter((l) => l.refusal !== null);
}

/**
 * The quote as the database priced it. The totals are the database's (a refused line is not in them): an answer
 * without them is a shape problem, never added up here, so no pricing happens outside the one function (§2.4).
 */
export function parseQuote(data: unknown): Parsed<Quote> {
  if (!isObj(data)) return { ok: false, error: "the quote is not an object" };
  if (!Array.isArray(data.lines)) return { ok: false, error: "the quote has no lines" };
  const lines: QuoteLine[] = [];
  for (const row of data.lines) {
    if (!isObj(row)) return { ok: false, error: "a quote line is not an object" };
    const refusal = str(row.refusal);
    const base = int(row.base_fee_cents) ?? (refusal ? 0 : null);
    const total = int(row.total_cents) ?? (refusal ? 0 : null);
    if (base === null || total === null) return { ok: false, error: "a quote line has no level fee or total in whole cents" };
    const kind = row.learner_kind === "adult" ? "adult" : row.learner_kind === "child" ? "child" : null;
    if (!kind && !refusal) return { ok: false, error: `a quote line has an unknown learner kind "${String(row.learner_kind)}"` };
    lines.push({
      index: int(row.index),
      first_name: str(row.first_name) ?? str(row.name) ?? str(row.learner),
      row_key: null,
      person_id: str(row.person_id),
      track_id: str(row.track_id),
      level_id: str(row.level_id),
      learner_kind: kind,
      family_rank: int(row.family_rank),
      age_on_cutoff: int(row.age_on_cutoff),
      outcome: str(row.outcome),
      base_fee_cents: base,
      sibling_discount_cents: int(row.sibling_discount_cents) ?? 0,
      cap_reduction_cents: int(row.cap_reduction_cents) ?? 0,
      late_fee_cents: int(row.late_fee_cents) ?? 0,
      assistance_cents: int(row.assistance_cents) ?? 0,
      total_cents: total,
      priced: refusal ? false : row.priced !== false,
      refusal,
    });
  }
  const children = int(data.children_total_cents);
  const adults = int(data.adults_total_cents);
  const total = int(data.total_cents);
  if (children === null || adults === null || total === null) return { ok: false, error: "the quote has no totals in whole cents" };
  return { ok: true, value: { lines, children_total_cents: children, adults_total_cents: adults, total_cents: total, late: data.late === true } };
}

// ---------------------------------------------------------------------------
// Opening registration (app.open_pathshala_registration(p_term, p_reason))
// ---------------------------------------------------------------------------
/**
 * 0590 answers {term_id, status, already_open, fees_locked_at, campaign_id, fund_id, payment_mode, warnings[{level_id,
 * level, sentence}]} (the warnings: offered levels with no age band; it opens anyway).
 */
export type OpenResult = {
  status: string | null;
  already_open: boolean;
  fees_locked_at: string | null;
  campaign_id: string | null;
  fund_id: string | null;
  warnings: string[];
};

/** Whatever the function answers, the screen re-reads the term; this only keeps what it can use. */
export function parseOpenResult(data: unknown): OpenResult {
  const o = isObj(data) ? data : {};
  const warnings = Array.isArray(o.warnings) ? o.warnings.map((w) => (isObj(w) ? str(w.sentence) : str(w))).filter((w): w is string => w !== null) : [];
  return {
    status: str(o.status),
    already_open: o.already_open === true,
    fees_locked_at: str(o.fees_locked_at),
    campaign_id: str(o.campaign_id),
    fund_id: str(o.fund_id),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The database's refusals
// ---------------------------------------------------------------------------
/**
 * app.open_pathshala_registration's refusal when Pledges & donations is on and the term has no fund for its fee
 * pledges (0590). The treasurer may not be able to open a draft term (drafts are Pathshala staff's, 0010), so the
 * sentence starts with what they can do in Setup › Lists. The Open registration checklist says the same, first.
 */
export const NO_FUND_SENTENCE =
  "There is no fund for the Pathshala fees yet. Ask the treasurer to add a fund called Pathshala in Setup › Lists, or choose a fund on this Fees screen if you also manage Giving; then open registration.";

/** app.set_pathshala_term_rules' refusal of fund_id null once the fees are locked (0590): the fee pledges need a fund. */
export const FUND_CLEARED_SENTENCE = "The fund for the Pathshala fees cannot be cleared once registration has opened. Choose another fund instead.";

type ErrLike = { code?: string | null; message?: string | null };

/**
 * The 0590 functions refuse with a plain sentence the screens show as it is (§2.11: 22023 a rule, 42501 not allowed,
 * P0002 not found). Postgres' own wording (a policy, a constraint, a type) is not a sentence for a person: null then,
 * and the caller explains the error the usual way.
 */
export function databaseSentence(error: unknown): string | null {
  if (!isObj(error)) return null;
  const e = error as ErrLike;
  const msg = (e.message ?? "").trim();
  if (!msg) return null;
  if (!["22023", "42501", "P0002", "P0001", "23514", "23505"].includes(e.code ?? "")) return null;
  if (/^(permission denied|new row|duplicate key|violates|null value|insert or update|update or delete|value too long|invalid input)/i.test(msg)) return null;
  if (/row-level security|violates (check|foreign key|unique|not-null) constraint/i.test(msg)) return null;
  return msg;
}
