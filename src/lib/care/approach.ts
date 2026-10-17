// DonorDelight slice 7 (connect-crm 0895): who to approach, HELD behind the touch balance, in words. Pure: no React and no server imports.
//
// The database decides who may see the list (app.care_approach: care.view and care.manage every household, care.own only the households they own,
// nobody else, platform admins included), works out each household's state and the score together with its signals (so the explanation cannot disagree
// with the number), and logs every read. This file words what came back: why a household is READY, why it is HELD ("Not yet: 2 of 3 touches with no ask
// since the last ask"), and a range from the household's own gifts. Nothing is sent or asked automatically. No outside wealth screening; the score never
// uses religion, caste, ethnicity, language, gender, age, health, income, property, occupation, photos, anything about a child, or anything from outside
// the organization's own records.

import { parseHousehold, formatDay, type CareHousehold } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ── Shapes ──────────────────────────────────────────────────────────────────
export type Hold =
  | { code: "pledge"; days: number }
  | { code: "thank"; n: number }
  | { code: "rest"; lastAskOn: string; until: string }
  | { code: "balance"; have: number; need: number }
  | { code: "quiet"; name: string; until: string | null };
export type Signal = { key: "years" | "recent" | "took_part" | "well_thanked"; points: number; n: number; days: number };
export type Range = { low: number; high: number; n: number };
export type ApproachState = "ready" | "held" | "excluded";
export type ApproachRow = {
  household: CareHousehold;
  owner: string | null;
  state: ApproachState;
  holds: Hold[];
  score: number;
  signals: Signal[];
  lastGiftOn: string | null;
  lastAskOn: string | null;
  noAskSince: number;
  gifts: number;
  range: Range | null;
};
export type ApproachList = {
  state: "ok" | "off" | "giving_off";
  ready: ApproachRow[];
  held: ApproachRow[];
  readyTotal: number;
  heldTotal: number;
  notShown: number;
  fund: string | null;
  funds: { id: string; name: string }[];
  amounts: boolean;
  /** care.view or care.manage: every household; otherwise only the person's own. */
  all: boolean;
  touchBalance: number;
  restDays: number;
  canManage: boolean;
  label: string;
  today: string;
};

function parseHold(v: unknown): Hold | null {
  const o = obj(v);
  switch (o.code) {
    case "pledge":
      return { code: "pledge", days: num(o.days) };
    case "thank":
      return { code: "thank", n: num(o.n) };
    case "rest":
      return { code: "rest", lastAskOn: str(o.last_ask_on) ?? "", until: str(o.until) ?? "" };
    case "balance":
      return { code: "balance", have: num(o.have), need: num(o.need) };
    case "quiet":
      return { code: "quiet", name: str(o.name) ?? "A quiet period", until: str(o.until) };
    default:
      return null;
  }
}
const SIGNAL_KEYS = ["years", "recent", "took_part", "well_thanked"] as const;
function parseSignal(v: unknown): Signal | null {
  const o = obj(v);
  const key = SIGNAL_KEYS.find((k) => k === o.key);
  return key ? { key, points: num(o.points), n: num(o.n), days: num(o.days) } : null;
}
function parseRange(v: unknown): Range | null {
  const o = obj(v);
  const low = numOrNull(o.low);
  const high = numOrNull(o.high);
  return low !== null && high !== null ? { low, high, n: num(o.n) } : null;
}
function parseRow(v: unknown): ApproachRow | null {
  const o = obj(v);
  const household = parseHousehold(o.household);
  if (household.id === "") return null;
  const state: ApproachState = o.state === "ready" ? "ready" : o.state === "excluded" ? "excluded" : "held";
  return {
    household,
    owner: str(o.owner),
    state,
    holds: arr(o.holds).map(parseHold).filter((h): h is Hold => h !== null),
    score: num(o.score),
    signals: arr(o.signals).map(parseSignal).filter((s): s is Signal => s !== null),
    lastGiftOn: str(o.last_gift_on),
    lastAskOn: str(o.last_ask_on),
    noAskSince: num(o.no_ask_since),
    gifts: num(o.gifts),
    range: parseRange(o.range),
  };
}

export function parseApproach(v: unknown): ApproachList {
  const o = obj(v);
  return {
    state: o.state === "off" ? "off" : o.state === "giving_off" ? "giving_off" : "ok",
    ready: arr(o.ready).map(parseRow).filter((r): r is ApproachRow => r !== null),
    held: arr(o.held).map(parseRow).filter((r): r is ApproachRow => r !== null),
    readyTotal: num(o.ready_total),
    heldTotal: num(o.held_total),
    notShown: num(o.not_shown),
    fund: str(o.fund),
    funds: arr(o.funds)
      .map((f) => ({ id: str(obj(f).id) ?? "", name: str(obj(f).name) ?? "" }))
      .filter((f) => f.id !== ""),
    amounts: bool(o.amounts),
    all: bool(o.all),
    touchBalance: num(o.touch_balance) || 3,
    restDays: numOrNull(o.rest_days) ?? 60,
    canManage: bool(o.can_manage),
    label: str(o.label) ?? "DonorDelight",
    today: str(o.today) ?? "",
  };
}

/** One household's answer for the Care card. */
export type ApproachHousehold =
  | { state: "off" | "giving_off" | "no_history" }
  | { state: ApproachState; holds: Hold[]; score: number; signals: Signal[]; lastGiftOn: string | null; lastAskOn: string | null; noAskSince: number; gifts: number; touchBalance: number; restDays: number; range: Range | null };
export function parseApproachHousehold(v: unknown): ApproachHousehold {
  const o = obj(v);
  if (o.state === "off" || o.state === "giving_off" || o.state === "no_history") return { state: o.state };
  const state: ApproachState = o.state === "ready" ? "ready" : o.state === "excluded" ? "excluded" : "held";
  return {
    state,
    holds: arr(o.holds).map(parseHold).filter((h): h is Hold => h !== null),
    score: num(o.score),
    signals: arr(o.signals).map(parseSignal).filter((s): s is Signal => s !== null),
    lastGiftOn: str(o.last_gift_on),
    lastAskOn: str(o.last_ask_on),
    noAskSince: num(o.no_ask_since),
    gifts: num(o.gifts),
    touchBalance: num(o.touch_balance) || 3,
    restDays: numOrNull(o.rest_days) ?? 60,
    range: parseRange(o.range),
  };
}

// ── Words ───────────────────────────────────────────────────────────────────
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Why a household is held, in a sentence. */
export function holdLine(h: Hold): string {
  switch (h.code) {
    case "pledge":
      return `Behind on a pledge by ${plural(h.days, "day")}: remind them, do not ask`;
    case "thank":
      return h.n === 1 ? "A gift has not been thanked yet: thank them first" : `${h.n} gifts have not been thanked yet: thank them first`;
    case "rest":
      return `Asked on ${formatDay(h.lastAskOn)}: they rest until ${formatDay(h.until)}`;
    case "balance": {
      const left = Math.max(0, h.need - h.have);
      return `Not yet: ${h.have} of ${h.need} touches with no ask since the last ask. ${left === 1 ? "One more" : `${left} more`} first`;
    }
    case "quiet":
      return `Quiet period: ${h.name}${h.until ? ` until ${formatDay(h.until)}` : ""}. Asks wait`;
  }
}

/** Why a household is ranked where it is, one sentence per signal that counted. */
export function signalLine(s: Signal): string | null {
  if (s.points <= 0) return null;
  switch (s.key) {
    case "years":
      return `Gave in ${s.n} of the last 5 years (+${s.points})`;
    case "recent": {
      const m = Math.max(0, Math.round(s.days / 30.4));
      return `Last gift ${m === 0 ? "this month" : m === 1 ? "1 month ago" : `${m} months ago`} (+${s.points})`;
    }
    case "took_part":
      return `Took part in the last 12 months: ${plural(s.n, "event or shift", "events or shifts")} (+${s.points})`;
    case "well_thanked":
      return `Every gift thanked (+${s.points})`;
  }
}

export function signalLines(signals: readonly Signal[]): string[] {
  return signals.map(signalLine).filter((l): l is string => l !== null);
}

/** A round step for showing a range: $10 under $1,000, $50 above (in cents). */
function step(cents: number): number {
  return cents >= 100000 ? 5000 : 1000;
}
/** The range from the household's own gifts, rounded outwards, never one number: "$130 to $200 from 4 gifts" or "about $100". */
export function rangeLine(r: Range | null, money: (cents: number) => string): string | null {
  if (!r) return null;
  const s = step(r.high);
  const low = Math.max(s, Math.floor(r.low / s) * s);
  const high = Math.max(low, Math.ceil(r.high / s) * s);
  return low === high ? `About ${money(low)}, from ${plural(r.n, "gift")} of their own` : `${money(low)} to ${money(high)}, from ${plural(r.n, "gift")} of their own`;
}

/** The sentence at the top of a ready or held list. */
export function listLine(l: Pick<ApproachList, "readyTotal" | "heldTotal" | "notShown">): string {
  const bits = [`${plural(l.readyTotal, "household")} ready`, `${l.heldTotal} held`];
  if (l.notShown > 0) bits.push(`${l.notShown} not shown`);
  return bits.join(" · ");
}

/** The Care card's line. */
export function stateLine(a: ApproachHousehold): string | null {
  switch (a.state) {
    case "ready":
      return "Ready for an ask, when you choose to ask";
    case "held":
      return "Not yet";
    case "excluded":
      return "Do not ask";
    default:
      return null;
  }
}

// ── The settings ────────────────────────────────────────────────────────────
export const WEIGHT_KEYS = ["years_per", "years_max", "recent_12", "recent_24", "recent_36", "took_part", "well_thanked"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export const WEIGHT_LABEL: Record<WeightKey, string> = {
  years_per: "Each year of the last five with a gift",
  years_max: "The most the years can add",
  recent_12: "Last gift within 12 months",
  recent_24: "Last gift 13 to 24 months ago",
  recent_36: "Last gift 25 to 36 months ago",
  took_part: "Took part in an event or shift in the last 12 months",
  well_thanked: "Every gift has been thanked",
};
export type QuietPeriod = { id: string; name: string; startsOn: string; endsOn: string; yearly: boolean };
export type ApproachSettings = {
  enabled: boolean;
  touchBalance: number;
  restDays: number;
  weights: Record<WeightKey, number>;
  defaults: Record<WeightKey, number>;
  enabledAt: string | null;
  canManage: boolean;
  label: string;
  quietPeriods: QuietPeriod[];
};
function weights(v: unknown): Record<WeightKey, number> {
  const o = obj(v);
  return Object.fromEntries(WEIGHT_KEYS.map((k) => [k, num(o[k])])) as Record<WeightKey, number>;
}
export function parseApproachSettings(v: unknown): ApproachSettings {
  const o = obj(v);
  return {
    enabled: bool(o.enabled),
    touchBalance: num(o.touch_balance) || 3,
    restDays: numOrNull(o.rest_days) ?? 60,
    weights: weights(o.weights),
    defaults: weights(o.defaults),
    enabledAt: str(o.enabled_at),
    canManage: bool(o.can_manage),
    label: str(o.label) ?? "DonorDelight",
    quietPeriods: arr(o.quiet_periods).map((q) => {
      const x = obj(q);
      return { id: str(x.id) ?? "", name: str(x.name) ?? "", startsOn: str(x.starts_on) ?? "", endsOn: str(x.ends_on) ?? "", yearly: bool(x.yearly) };
    }).filter((q) => q.id !== ""),
  };
}

export type SettingsInput = { touchBalance: number; restDays: number; weights: Record<WeightKey, number> };
export type Checked = { ok: true } | { ok: false; error: string };
/** The same rules as app.save_care_approach_settings, in the same words. */
export function checkSettings(s: SettingsInput): Checked {
  if (!Number.isInteger(s.touchBalance) || s.touchBalance < 1 || s.touchBalance > 10) return { ok: false, error: "The touch balance is 1 to 10 touches with no ask for every ask." };
  if (!Number.isInteger(s.restDays) || s.restDays < 0 || s.restDays > 365) return { ok: false, error: "The rest after an ask is 0 to 365 days." };
  for (const k of WEIGHT_KEYS) {
    const v = s.weights[k];
    const max = k === "years_max" ? 100 : 50;
    if (!Number.isInteger(v) || v < 0 || v > max) return { ok: false, error: "A weight is 0 to 50 points (the most for years is 100)." };
  }
  return { ok: true };
}

export type QuietInput = { id?: string | null; name: string; startsOn: string; endsOn: string; yearly: boolean };
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export function checkQuiet(q: QuietInput): Checked {
  if (q.name.trim().length < 1 || q.name.trim().length > 80) return { ok: false, error: "Give the quiet period a name of up to 80 characters." };
  if (!isDay(q.startsOn) || !isDay(q.endsOn)) return { ok: false, error: "Say when the quiet period starts and ends." };
  if (q.endsOn < q.startsOn) return { ok: false, error: "A quiet period cannot end before it starts." };
  if ((Date.parse(`${q.endsOn}T00:00:00Z`) - Date.parse(`${q.startsOn}T00:00:00Z`)) / 86_400_000 >= 366) return { ok: false, error: "A quiet period is at most a year long." };
  return { ok: true };
}

/** What the list uses and does not use: shown before it is turned on, and kept on the page. */
export const USES = [
  "Gifts the organization has recorded in the last five years (donations that went through, less refunds)",
  "Taking part: events checked in at and shifts worked, by adults only",
  "Whether gifts were thanked, and the personal touches people recorded, with and without an ask",
  "The care profile: do not ask, and any rest-until date",
  "Pledges that are far behind, and the quiet periods the organization sets",
] as const;
export const DOES_NOT_USE = [
  "Religion, tradition, caste, ethnicity, nationality or language",
  "Gender, age, birth date, marital or family status, health",
  "Income, property, occupation or any wealth screening from outside the organization",
  "Photos, or anything about a child or anyone under 18",
  "How other households gave, or how a name is spelled",
] as const;
