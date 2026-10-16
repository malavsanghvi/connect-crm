// The platform team's Chip In and card-fee screens (docs/PAYMENT_ADDONS.md §11.2): Platform › Centers › one organization and
// Platform › Payments. What the person types (dollars, a percentage) becomes integer cents and basis points here, with the same
// limits and the same plain sentences as the database (migrations 0861 and 0862: app.platform_set_chip_in, app.platform_set_fee_rate),
// so a typo is explained before anything is sent; the database is still the rule and checks again. The answers of
// app.chip_in_overview, app.payment_fee_rates_for and app.chip_in_summary are jsonb, read defensively: a shape this code does not
// understand is a plain error, never a guess. Pure; tested in tests/chip-in-platform.test.ts.

import { centsAsDecimal, formatCents, parseAmountToCents } from "@/lib/money";

import { UNEXPECTED_SHAPE, type Parsed } from "./plugins/view";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const numOrNull = (v: unknown): v is number | null => v === null || isNum(v);

/** The yearly limit per account is between $1.00 and $1,000.00 (a typo cannot ask for $10,000). */
export const CHIP_IN_MIN_CENTS = 100;
export const CHIP_IN_MAX_LIMIT_CENTS = 100_000;
/** One to four suggested amounts. */
export const CHIP_IN_MAX_SUGGESTIONS = 4;
const usd = (cents: number) => formatCents(cents, "USD");

// ── What the person types ────────────────────────────────────────────────────

/** The saved setting, as the platform team reads it from app.chip_in_settings (no row at all means "not set"). */
export type ChipInSettings = {
  asking: boolean;
  yearlyLimitCents: number | null;
  suggestedCents: number[];
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

/** Whether the switch may be turned on: a limit and at least one suggestion must already be saved. */
export function canTurnOn(saved: Pick<ChipInSettings, "yearlyLimitCents" | "suggestedCents"> | null | undefined): boolean {
  return !!saved && saved.yearlyLimitCents !== null && saved.yearlyLimitCents !== undefined && saved.suggestedCents.length >= 1;
}

/** Said next to the switch while it cannot be turned on, and by the action if the form is sent anyway. */
export const TURN_ON_BLOCKED =
  "A Chip In cannot be turned on until a yearly limit and at least one suggested amount are saved. Save them first, then switch it on.";

/** Not set: no row, or a row that holds nothing yet. */
export function isNotSet(saved: Pick<ChipInSettings, "yearlyLimitCents" | "suggestedCents" | "asking"> | null | undefined): boolean {
  return !saved || (saved.yearlyLimitCents === null && saved.suggestedCents.length === 0 && !saved.asking);
}

export const NOT_SET = "Not set. No Chip In is asked of this organization's members.";

export type ChipInForm = { asking: boolean; limitCents: number | null; suggestedCents: number[] };
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The Chip In form: a yearly limit in dollars (blank = none yet), up to four suggested amounts in dollars (blank ones are left
 * out) and whether members are asked. Dollars become integer cents. Mirrors app._chip_in_write, in the same order.
 */
export function parseChipInForm(input: { limit: string; suggestions: readonly string[]; asking: boolean }): Checked<ChipInForm> {
  const limitText = (input.limit ?? "").trim();
  let limitCents: number | null = null;
  if (limitText) {
    const parsed = parseAmountToCents(limitText);
    if (parsed === null || parsed < 0) return { ok: false, error: "Enter the yearly limit as dollars, for example 50 or 50.00." };
    if (parsed < CHIP_IN_MIN_CENTS || parsed > CHIP_IN_MAX_LIMIT_CENTS) {
      return { ok: false, error: `The yearly limit per account is between ${usd(CHIP_IN_MIN_CENTS)} and ${usd(CHIP_IN_MAX_LIMIT_CENTS)}.` };
    }
    limitCents = parsed;
  }

  const filled = (input.suggestions ?? []).map((s, i) => ({ text: String(s ?? "").trim(), n: i + 1 })).filter((s) => s.text !== "");
  if (filled.length > CHIP_IN_MAX_SUGGESTIONS) return { ok: false, error: "Suggest at most four amounts." };
  const suggestedCents: number[] = [];
  for (const s of filled) {
    const cents = parseAmountToCents(s.text);
    if (cents === null || cents < 0) return { ok: false, error: `Suggested amount ${s.n} is not an amount in dollars, for example 5 or 5.00.` };
    suggestedCents.push(cents);
  }
  if (suggestedCents.some((c) => c < CHIP_IN_MIN_CENTS)) return { ok: false, error: `Each suggested amount is at least ${usd(CHIP_IN_MIN_CENTS)}.` };
  if (limitCents !== null && suggestedCents.some((c) => c > limitCents)) return { ok: false, error: "A suggested amount cannot be more than the yearly limit." };
  if (limitCents === null && suggestedCents.some((c) => c > CHIP_IN_MAX_LIMIT_CENTS)) {
    return { ok: false, error: `A suggested amount cannot be more than ${usd(CHIP_IN_MAX_LIMIT_CENTS)}.` };
  }
  if (suggestedCents.some((c, i) => i > 0 && c <= suggestedCents[i - 1])) {
    return { ok: false, error: "List the suggested amounts from the smallest to the largest, each different." };
  }
  if (input.asking && limitCents === null) return { ok: false, error: "Set the yearly limit per account before asking members for a Chip In." };
  if (input.asking && suggestedCents.length === 0) return { ok: false, error: "Add at least one suggested amount before asking members for a Chip In." };
  return { ok: true, value: { asking: !!input.asking, limitCents, suggestedCents } };
}

/** Dollars for an input box: 5000 → "50.00". */
export const dollarsInput = (cents: number | null | undefined): string => (cents === null || cents === undefined ? "" : centsAsDecimal(cents));

/** "$2.00, $5.00 and $10.00". */
export function suggestionsText(cents: readonly number[]): string {
  const list = cents.map(usd);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// ── The result of a save, in words ───────────────────────────────────────────

/** What the platform admin is told after the database accepted a save (app.platform_set_chip_in). */
export function savedMessage(result: unknown): string {
  const r = isObj(result) ? result : {};
  if (r.changed === false) return "Nothing changed: these settings were already saved.";
  if (r.asking === true) {
    const limit = isNum(r.yearly_limit_cents) ? `, up to ${usd(r.yearly_limit_cents)} a year each` : "";
    return `Chip In is on for this organization: members are asked for an optional Chip In${limit} · audit logged`;
  }
  return "Chip In settings saved · nothing is asked of any member while the switch is off · audit logged";
}

// ── Fee rates ────────────────────────────────────────────────────────────────

export const FEE_CLASSES = ["card", "ach"] as const;
export type FeeClass = (typeof FEE_CLASSES)[number];
export const FEE_CLASS_LABEL: Record<FeeClass, string> = { card: "Card (includes Apple Pay and Google Pay)", ach: "Bank debit (ACH)" };
export const FEE_CLASS_SHORT: Record<FeeClass, string> = { card: "Card", ach: "Bank debit" };
export const isFeeClass = (v: unknown): v is FeeClass => v === "card" || v === "ach";

const MAX_BPS = 1000;
const MAX_FIXED_CENTS = 100;
const MAX_CAP_CENTS = 100_000;
export const SOURCE_NOTE_MAX = 500;

/** "2.9" or "2.90%" → 290 basis points; null for anything that is not a percentage with at most two decimals. */
export function parsePercentToBps(input: string | null | undefined): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(input ?? "").replace(/\s+/g, "").replace(/%$/, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

/** 290 → "2.9", 80 → "0.8", 295 → "2.95", 300 → "3". */
export function bpsToPercent(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = String(Math.abs(bps) % 100).padStart(2, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : String(whole);
}

export type FeeRateInput = { bps: number; fixedCents: number; capCents: number | null };

/** "2.9% + $0.30" or "0.8%, never more than $5.00". */
export function rateText(r: FeeRateInput): string {
  const pct = `${bpsToPercent(r.bps)}%`;
  const fixed = r.fixedCents > 0 ? ` + ${usd(r.fixedCents)}` : "";
  const cap = r.capCents !== null ? `, never more than ${usd(r.capCents)}` : "";
  return `${pct}${fixed}${cap}`;
}

export type FeeRateForm = { methodClass: FeeClass; bps: number; fixedCents: number; capCents: number | null; sourceNote: string };

/** The "add a rate" form. Mirrors app.platform_set_fee_rate, in the same order and with its sentences. */
export function parseFeeRateForm(input: { methodClass: string; percent: string; fixed: string; cap: string; note: string }): Checked<FeeRateForm> {
  if (!isFeeClass(input.methodClass)) return { ok: false, error: "Choose card or bank debit." };
  const percent = (input.percent ?? "").trim();
  if (!percent) return { ok: false, error: "Enter the percentage Stripe charges, for example 2.9." };
  const bps = parsePercentToBps(percent);
  if (bps === null) return { ok: false, error: "Enter the percentage as a number with at most two decimals, for example 2.9." };
  if (bps > MAX_BPS) return { ok: false, error: "The percentage is between 0% and 10%." };

  const fixedText = (input.fixed ?? "").trim();
  let fixedCents = 0;
  if (fixedText) {
    const parsed = parseAmountToCents(fixedText);
    if (parsed === null || parsed < 0) return { ok: false, error: "Enter the fixed part as dollars, for example 0.30." };
    fixedCents = parsed;
  }
  if (fixedCents > MAX_FIXED_CENTS) return { ok: false, error: `The fixed part is between ${usd(0)} and ${usd(MAX_FIXED_CENTS)}.` };

  const capText = (input.cap ?? "").trim();
  let capCents: number | null = null;
  if (capText) {
    const parsed = parseAmountToCents(capText);
    if (parsed === null || parsed < 0) return { ok: false, error: "Enter the cap as dollars, for example 5.00, or leave it empty for no cap." };
    if (parsed < 1 || parsed > MAX_CAP_CENTS) return { ok: false, error: `The cap is between ${usd(1)} and ${usd(MAX_CAP_CENTS)}.` };
    capCents = parsed;
  }

  const sourceNote = (input.note ?? "").trim();
  if (!sourceNote) return { ok: false, error: 'Say where this rate comes from (for example "approved nonprofit pricing, letter of 2026-11-02").' };
  if (sourceNote.length > SOURCE_NOTE_MAX) return { ok: false, error: `Keep the note under ${SOURCE_NOTE_MAX} characters.` };
  return { ok: true, value: { methodClass: input.methodClass, bps, fixedCents, capCents, sourceNote } };
}

// ── The answers of the database ──────────────────────────────────────────────

export type FeeRate = { bps: number; fixedCents: number; capCents: number | null; custom: boolean; effectiveFrom: string | null; sourceNote: string };
export type FeeRates = Partial<Record<FeeClass, FeeRate>>;

/** app.payment_fee_rates_for(center): { card: {...}, ach: {...} }, a class missing when no rate is set for it. */
export function parseFeeRates(json: unknown): Parsed<FeeRates> {
  if (!isObj(json)) return { ok: false, error: UNEXPECTED_SHAPE };
  const out: FeeRates = {};
  for (const cls of FEE_CLASSES) {
    const v = json[cls];
    if (v === undefined || v === null) continue;
    if (
      !isObj(v) || !isNum(v.bps) || !isNum(v.fixed_cents) || !numOrNull(v.cap_cents ?? null) || typeof v.custom !== "boolean"
      || !isStr(v.source_note) || !(v.effective_from === undefined || v.effective_from === null || isStr(v.effective_from))
    ) {
      return { ok: false, error: UNEXPECTED_SHAPE };
    }
    out[cls] = {
      bps: v.bps, fixedCents: v.fixed_cents, capCents: isNum(v.cap_cents) ? v.cap_cents : null, custom: v.custom,
      effectiveFrom: isStr(v.effective_from) ? v.effective_from : null, sourceNote: v.source_note,
    };
  }
  return { ok: true, value: out };
}

/** One row of app.payment_fee_rates, as the platform team reads the table. */
export type FeeRateRow = FeeRateInput & { id: string; methodClass: FeeClass; effectiveFrom: string; sourceNote: string; setBy: string | null };

/**
 * The platform default per way to pay, from its rows (newest first): the one in force is the first of its class that has started
 * (the same rule as app._fee_rate); every other row is an earlier rate that stays on record.
 */
export function splitPlatformRates<T extends FeeRateRow>(rows: readonly T[], now: Date = new Date()): { effective: FeeRates; earlier: T[] } {
  const effective: FeeRates = {};
  const earlier: T[] = [];
  for (const row of rows) {
    if (!effective[row.methodClass] && new Date(row.effectiveFrom).getTime() <= now.getTime()) {
      // A date is shown only for a rate a person set: the rows the migration seeded carry a nominal start (1 January 2020, midnight
      // UTC), which read in a US time zone would say 31 December 2019.
      effective[row.methodClass] = { bps: row.bps, fixedCents: row.fixedCents, capCents: row.capCents, custom: false, effectiveFrom: row.setBy ? row.effectiveFrom : null, sourceNote: row.sourceNote };
    } else {
      earlier.push(row);
    }
  }
  return { effective, earlier };
}

/** The platform default rows as the table returns them (any shape problem is reported, not skipped). */
export function parseFeeRateRows(rows: unknown): Parsed<FeeRateRow[]> {
  if (!Array.isArray(rows)) return { ok: false, error: UNEXPECTED_SHAPE };
  const out: FeeRateRow[] = [];
  for (const r of rows) {
    if (
      !isObj(r) || !isStr(r.id) || !isFeeClass(r.method_class) || !isNum(r.bps) || !isNum(r.fixed_cents) || !numOrNull(r.cap_cents ?? null)
      || !isStr(r.effective_from) || !isStr(r.source_note) || !(r.set_by === null || r.set_by === undefined || isStr(r.set_by))
    ) {
      return { ok: false, error: UNEXPECTED_SHAPE };
    }
    out.push({
      id: r.id, methodClass: r.method_class, bps: r.bps, fixedCents: r.fixed_cents, capCents: isNum(r.cap_cents) ? r.cap_cents : null,
      effectiveFrom: r.effective_from, sourceNote: r.source_note, setBy: isStr(r.set_by) ? r.set_by : null,
    });
  }
  return { ok: true, value: out };
}

export type ChipInModeFigures = { accounts: number; collectedCents: number; refundedCents: number; inFlightCents: number; accountsAtLimit: number };
export type ChipInOverview = { calendarYear: number; asking: boolean; yearlyLimitCents: number | null; live: ChipInModeFigures; test: ChipInModeFigures };

function parseMode(v: unknown): ChipInModeFigures | null {
  if (!isObj(v) || !isNum(v.accounts) || !isNum(v.collected_cents) || !isNum(v.refunded_cents) || !isNum(v.in_flight_cents) || !isNum(v.accounts_at_limit)) return null;
  return { accounts: v.accounts, collectedCents: v.collected_cents, refundedCents: v.refunded_cents, inFlightCents: v.in_flight_cents, accountsAtLimit: v.accounts_at_limit };
}

/** app.chip_in_overview(center, year): live and test apart, no names. */
export function parseChipInOverview(json: unknown): Parsed<ChipInOverview> {
  if (!isObj(json) || !isNum(json.calendar_year) || typeof json.asking !== "boolean" || !numOrNull(json.yearly_limit_cents ?? null)) return { ok: false, error: UNEXPECTED_SHAPE };
  const live = parseMode(json.live);
  const test = parseMode(json.test);
  if (!live || !test) return { ok: false, error: UNEXPECTED_SHAPE };
  return { ok: true, value: { calendarYear: json.calendar_year, asking: json.asking, yearlyLimitCents: isNum(json.yearly_limit_cents) ? json.yearly_limit_cents : null, live, test } };
}

/** A row of app.chip_in_settings (the platform team reads the table; the organization never does). */
export function parseChipInSettingsRow(row: unknown): Parsed<ChipInSettings | null> {
  if (row === null || row === undefined) return { ok: true, value: null };
  if (
    !isObj(row) || typeof row.asking !== "boolean" || !numOrNull(row.yearly_limit_cents ?? null) || !Array.isArray(row.suggested_cents)
    || !row.suggested_cents.every(isNum) || !(row.reason === null || row.reason === undefined || isStr(row.reason))
    || !(row.updated_by === null || row.updated_by === undefined || isStr(row.updated_by)) || !isStr(row.updated_at)
  ) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  return {
    ok: true,
    value: {
      asking: row.asking, yearlyLimitCents: isNum(row.yearly_limit_cents) ? row.yearly_limit_cents : null, suggestedCents: row.suggested_cents as number[],
      reason: isStr(row.reason) ? row.reason : null, updatedBy: isStr(row.updated_by) ? row.updated_by : null, updatedAt: row.updated_at,
    },
  };
}

/** What the organization is allowed to read of the setting (app.chip_in_summary): no reason, no names. */
export type ChipInSummary = { configured: boolean; asking: boolean; yearlyLimitCents: number | null; suggestedCents: number[]; updatedAt: string | null };

export function parseChipInSummary(json: unknown): Parsed<ChipInSummary> {
  if (
    !isObj(json) || typeof json.configured !== "boolean" || typeof json.asking !== "boolean" || !numOrNull(json.yearly_limit_cents ?? null)
    || !Array.isArray(json.suggested_cents) || !json.suggested_cents.every(isNum) || !(json.updated_at === null || json.updated_at === undefined || isStr(json.updated_at))
  ) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  return {
    ok: true,
    value: {
      configured: json.configured, asking: json.asking, yearlyLimitCents: isNum(json.yearly_limit_cents) ? json.yearly_limit_cents : null,
      suggestedCents: json.suggested_cents as number[], updatedAt: isStr(json.updated_at) ? json.updated_at : null,
    },
  };
}

// ── Who changed it ───────────────────────────────────────────────────────────

/**
 * "Weaver's team" for a change nobody signed in made (the migration that seeded JSH), "you" for the person looking, the name when it
 * can be read, else "a Weaver platform admin" (a platform admin's name is only readable where their sign-in is linked to a person).
 */
export function whoChanged(userId: string | null | undefined, me: string | null | undefined, name: string | null | undefined): string {
  if (!userId) return "Weaver's team";
  if (name) return name;
  if (me && userId === me) return "you";
  return "a Weaver platform admin";
}
