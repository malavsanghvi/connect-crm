// DonorDelight slice 3 (connect-crm 0881-0883): the thank-you tracker's words and shapes. Pure: no server imports, so the screens and the
// tests read the same thing. The database answers (app.care_thanks_queue, care_thanks_summary, care_household_thanks, care_settings_get);
// nothing here decides who may see what, and an amount is shown only when the database sent one (a role that also holds giving.view).
// Without an amount the screens say "Thank them warmly", never a blank.

import { formatDay, parseHousehold, type CareHousehold } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const THANKS_FILTERS = ["open", "overdue", "done", "set_aside"] as const;
export type ThanksFilter = (typeof THANKS_FILTERS)[number];
export const THANKS_FILTER_LABEL: Record<ThanksFilter, string> = {
  open: "To thank",
  overdue: "Overdue",
  done: "Thanked",
  set_aside: "No thanks needed",
};

export type ThanksCounts = { open: number; overdue: number; personalOpen: number; done: number; setAside: number };
export type ThanksRow = {
  id: string;
  household: CareHousehold;
  giftOn: string;
  dueOn: string;
  overdue: boolean;
  daysOverdue: number | null;
  needsPersonal: boolean;
  /** The gift's amount in cents, only when the database sent it (a care key AND giving.view). */
  amountCents: number | null;
  thankedAt: string | null;
  how: "receipt" | "touch" | null;
  setAsideAt: string | null;
  setAsideReason: string | null;
};

export type ThanksQueue =
  | { state: "ok"; filter: ThanksFilter; rows: ThanksRow[]; total: number; counts: ThanksCounts; windowDays: number; amounts: boolean; today: string; canManage: boolean }
  | { state: "not_set_up"; canManage: boolean }
  | { state: "giving_off" };

export type ThanksSummary =
  | { state: "ok"; days: number; windowDays: number; gifts: number; thanked: number; open: number; overdue: number; medianHours: number | null; onTimeShare: number | null }
  | { state: "not_set_up"; canManage: boolean }
  | { state: "giving_off" };

export type OpenThank = { id: string; giftOn: string; dueOn: string; overdue: boolean; needsPersonal: boolean; amountCents: number | null };
export type HouseholdThanks =
  | { state: "ok"; open: OpenThank[]; amounts: boolean; windowDays: number }
  | { state: "not_set_up"; canManage: boolean }
  | { state: "giving_off" };

export type ThanksSettings = {
  saved: boolean;
  thankWindowDays: number;
  firstGiftPersonal: boolean;
  personalFromCents: number | null;
  countFees: boolean;
  thanksFrom: string | null;
  today: string | null;
  canManage: boolean;
};

function parseCounts(v: unknown): ThanksCounts {
  const o = obj(v);
  return { open: num(o.open), overdue: num(o.overdue), personalOpen: num(o.personal_open), done: num(o.done), setAside: num(o.set_aside) };
}

function parseRow(v: unknown): ThanksRow {
  const o = obj(v);
  return {
    id: str(o.id) ?? "",
    household: parseHousehold(o.household),
    giftOn: str(o.gift_on) ?? "",
    dueOn: str(o.due_on) ?? "",
    overdue: bool(o.overdue),
    daysOverdue: numOrNull(o.days_overdue),
    needsPersonal: bool(o.needs_personal),
    amountCents: numOrNull(o.amount_cents),
    thankedAt: str(o.thanked_at),
    how: o.how === "receipt" || o.how === "touch" ? o.how : null,
    setAsideAt: str(o.set_aside_at),
    setAsideReason: str(o.set_aside_reason),
  };
}

export function parseThanksQueue(v: unknown): ThanksQueue {
  const o = obj(v);
  if (o.state === "not_set_up") return { state: "not_set_up", canManage: bool(o.can_manage) };
  if (o.state === "giving_off") return { state: "giving_off" };
  const filter = THANKS_FILTERS.find((f) => f === o.filter) ?? "open";
  return {
    state: "ok",
    filter,
    rows: arr(o.rows).map(parseRow).filter((r) => r.id !== ""),
    total: num(o.total),
    counts: parseCounts(o.counts),
    windowDays: num(o.window_days) || 2,
    amounts: bool(o.amounts),
    today: str(o.today) ?? "",
    canManage: bool(o.can_manage),
  };
}

export function parseThanksSummary(v: unknown): ThanksSummary {
  const o = obj(v);
  if (o.state === "not_set_up") return { state: "not_set_up", canManage: bool(o.can_manage) };
  if (o.state === "giving_off") return { state: "giving_off" };
  return {
    state: "ok",
    days: num(o.days),
    windowDays: num(o.window_days) || 2,
    gifts: num(o.gifts),
    thanked: num(o.thanked),
    open: num(o.open),
    overdue: num(o.overdue),
    medianHours: numOrNull(o.median_hours),
    onTimeShare: numOrNull(o.on_time_share),
  };
}

export function parseHouseholdThanks(v: unknown): HouseholdThanks {
  const o = obj(v);
  if (o.state === "not_set_up") return { state: "not_set_up", canManage: bool(o.can_manage) };
  if (o.state === "giving_off") return { state: "giving_off" };
  return {
    state: "ok",
    amounts: bool(o.amounts),
    windowDays: num(o.window_days) || 2,
    open: arr(o.open).map((x) => {
      const r = obj(x);
      return { id: str(r.id) ?? "", giftOn: str(r.gift_on) ?? "", dueOn: str(r.due_on) ?? "", overdue: bool(r.overdue), needsPersonal: bool(r.needs_personal), amountCents: numOrNull(r.amount_cents) };
    }).filter((r) => r.id !== ""),
  };
}

export function parseThanksSettings(v: unknown): ThanksSettings {
  const o = obj(v);
  return {
    saved: bool(o.saved),
    thankWindowDays: num(o.thank_window_days) || 2,
    firstGiftPersonal: o.first_gift_personal !== false,
    personalFromCents: numOrNull(o.personal_from_cents),
    countFees: bool(o.count_fees),
    thanksFrom: str(o.thanks_from),
    today: str(o.today),
    canManage: bool(o.can_manage),
  };
}

// ── Sentences ───────────────────────────────────────────────────────────────

/** "$120.00 gift on Oct 11, 2026", or without an amount: "A gift on Oct 11, 2026. Thank them warmly." */
export function giftLine(g: { giftOn: string; amountCents: number | null }, money: (cents: number) => string): string {
  const day = formatDay(g.giftOn);
  return g.amountCents === null ? `A gift on ${day}. Thank them warmly.` : `${money(g.amountCents)} gift on ${day}`;
}

/** What is due, in words. */
export function dueLine(r: { overdue: boolean; daysOverdue: number | null; dueOn: string }): string {
  if (r.overdue) {
    const d = r.daysOverdue ?? 0;
    return d <= 1 ? "Overdue by a day" : `Overdue by ${d} days`;
  }
  return `Due ${formatDay(r.dueOn)}`;
}

/** What it takes to close the step. */
export function personalLine(needsPersonal: boolean): string {
  return needsPersonal ? "Needs a call, a visit, a card or a video" : "The receipt or any thank-you will do";
}

/** How a thanked step was closed. */
export function howLine(how: "receipt" | "touch" | null, thankedAt: string | null): string {
  const day = thankedAt ? formatDay(thankedAt.slice(0, 10)) : "";
  const what = how === "receipt" ? "Receipt sent" : how === "touch" ? "Thanked" : "Thanked";
  return day ? `${what} ${day}` : what;
}

/** The median time to a thank-you, in words ("about 5 hours", "about 3 days"); null when nothing was thanked yet. */
export function medianLine(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return "under an hour";
  if (hours < 48) return `about ${Math.round(hours)} ${Math.round(hours) === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `about ${days} days`;
}

/** "60% on time" from a 0 to 1 share; null when nothing is due yet. */
export function onTimeLine(share: number | null): string | null {
  return share === null ? null : `${Math.round(share * 100)}% on time`;
}

/** The headline for the open count ("3 gifts to thank, 1 overdue"). */
export function openLine(c: Pick<ThanksCounts, "open" | "overdue">): string {
  if (c.open === 0) return "Every gift is thanked.";
  const gifts = `${c.open} ${c.open === 1 ? "gift" : "gifts"} to thank`;
  return c.overdue > 0 ? `${gifts}, ${c.overdue} overdue` : gifts;
}

/** What Home knows of the thank-yous: three numbers, no names (app.care_thanks_counts). */
export type ThanksCounts3 = { open: number; overdue: number; personalOpen: number };
export function parseThanksCounts(v: unknown): ThanksCounts3 | null {
  const o = obj(v);
  if (o.state !== "ok") return null;
  return { open: num(o.open), overdue: num(o.overdue), personalOpen: num(o.personal_open) };
}

/** Home's task row: null when nothing is waiting, or before the rules are saved. */
export function thanksTaskCopy(c: ThanksCounts3 | null): { title: string; meta: string } | null {
  if (!c || c.open === 0) return null;
  const title = `${c.open} ${c.open === 1 ? "gift" : "gifts"} to thank`;
  const bits = [c.overdue > 0 ? `${c.overdue} overdue` : null, c.personalOpen > 0 ? `${c.personalOpen} need a personal thank-you` : null].filter((x): x is string => x !== null);
  return { title, meta: bits.length > 0 ? bits.join(" · ") : "Within the window" };
}

/** The one-tap ways to say thank you: what the person did, and the channel recorded. Only these close a personal step (0882). */
export const THANK_WAYS: readonly { key: string; label: string; channel: "phone" | "post" | "in_person" | "email" | "text"; personal: boolean }[] = [
  { key: "called", label: "Called", channel: "phone", personal: true },
  { key: "card", label: "Card sent", channel: "post", personal: true },
  { key: "visited", label: "Visited", channel: "in_person", personal: true },
  { key: "emailed", label: "Emailed", channel: "email", personal: false },
  { key: "texted", label: "Texted", channel: "text", personal: false },
];

/** The ways that close this step: a personal step takes only the personal ones. */
export function waysFor(needsPersonal: boolean): typeof THANK_WAYS {
  return needsPersonal ? THANK_WAYS.filter((w) => w.personal) : THANK_WAYS;
}
