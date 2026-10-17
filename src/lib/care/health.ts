// DonorDelight slice 4 (connect-crm 0884-0885): a household's health and the organization's own numbers, in words. Pure: no server imports.
// No AI and no score: arithmetic on the plain facts the database returns (counts and dates, never an amount), and a sentence for every reason,
// so a person can see WHY a household is Cooling. The database decides who may read the facts; this file only reads what it was given.
//
//   Lapsed     nothing on record in the last 18 months (no gift, no event, no shift)
//   At risk    gave the year before, nothing in the last 12 months
//   Cooling    gave fewer times than the year before, or no gift for six months
//   Thriving   steady giving (as many gifts as the year before), took part, and 3 or more no-ask touches for every ask
//   Steady     everything else
//   No activity yet    nothing on record at all
//   Not enough history yet    the community has under about a year of records: a level would only be a guess
//
// Without Giving (a community that runs member care only) the gift rules are left out: Thriving needs only taking part and the touch balance.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type HealthFacts = {
  householdId: string;
  gifts12: number;
  giftsPrev12: number;
  firstGiftOn: string | null;
  lastGiftOn: string | null;
  part12: number;
  lastPartOn: string | null;
  opened12: number;
  touches12: number;
  asks12: number;
  noAsk12: number;
  lastTouchAt: string | null;
  /** Open thank-you steps; null before the community's thank-you rules are saved. */
  unthanked: number | null;
};

export type HealthAnswer = { today: string; historyMonths: number; giving: boolean; rows: HealthFacts[] };

export function parseHealthFacts(v: unknown): HealthAnswer {
  const o = obj(v);
  return {
    today: str(o.today) ?? "",
    historyMonths: num(o.history_months),
    giving: o.giving !== false,
    rows: arr(o.rows).map((x) => {
      const r = obj(x);
      return {
        householdId: str(r.household_id) ?? "",
        gifts12: num(r.gifts_12),
        giftsPrev12: num(r.gifts_prev_12),
        firstGiftOn: str(r.first_gift_on),
        lastGiftOn: str(r.last_gift_on),
        part12: num(r.part_12),
        lastPartOn: str(r.last_part_on),
        opened12: num(r.opened_12),
        touches12: num(r.touches_12),
        asks12: num(r.asks_12),
        noAsk12: num(r.no_ask_12),
        lastTouchAt: str(r.last_touch_at),
        unthanked: numOrNull(r.unthanked),
      };
    }).filter((r) => r.householdId !== ""),
  };
}

export const HEALTH_LEVELS = ["thriving", "steady", "cooling", "at_risk", "lapsed", "none", "not_enough_history"] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];
export const HEALTH_LABEL: Record<HealthLevel, string> = {
  thriving: "Thriving",
  steady: "Steady",
  cooling: "Cooling",
  at_risk: "At risk",
  lapsed: "Lapsed",
  none: "No activity yet",
  not_enough_history: "Not enough history yet",
};
/** The tone a chip takes (the portal's own status tones). */
export const HEALTH_TONE: Record<HealthLevel, "ok" | "warn" | "bad" | "muted"> = {
  thriving: "ok",
  steady: "muted",
  cooling: "warn",
  at_risk: "bad",
  lapsed: "bad",
  none: "muted",
  not_enough_history: "muted",
};

export type Health = { level: HealthLevel; label: string; reasons: string[] };

/** Whole days from one ISO day to another (b minus a). */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const y = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  return Math.round((y - x) / 86_400_000);
}

/** "3 days ago", "5 weeks ago", "7 months ago" (a day in the future reads as today). */
export function agoLine(iso: string, today: string): string {
  const d = Math.max(0, daysBetween(iso, today));
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  const m = Math.round(d / 30.4);
  return m < 24 ? `${m} months ago` : `${Math.round(d / 365)} years ago`;
}

const times = (n: number) => (n === 1 ? "1 time" : `${n} times`);

/** The facts as plain sentences, whatever the level. */
export function factLines(f: HealthFacts, ctx: { today: string; giving: boolean }): string[] {
  const out: string[] = [];
  if (ctx.giving) {
    if (f.gifts12 > 0) out.push(`Gave ${times(f.gifts12)} in the last 12 months${f.giftsPrev12 > 0 ? ` (${f.giftsPrev12} the year before)` : ""}`);
    else if (f.lastGiftOn) out.push(`No gift in the last 12 months; the last was ${agoLine(f.lastGiftOn, ctx.today)}`);
    else out.push("No gift on record");
  }
  if (f.part12 > 0) out.push(`Took part ${times(f.part12)} in the last 12 months (events or volunteering)`);
  else if (f.lastPartOn) out.push(`Took part last ${agoLine(f.lastPartOn, ctx.today)}`);
  if (f.touches12 > 0) out.push(`${f.noAsk12} no-ask ${f.noAsk12 === 1 ? "touch" : "touches"} and ${f.asks12} ${f.asks12 === 1 ? "ask" : "asks"} in the last 12 months`);
  else out.push("No personal touch in the last 12 months");
  if (f.lastTouchAt) out.push(`Last personal touch ${agoLine(f.lastTouchAt, ctx.today)}`);
  if (f.unthanked !== null && f.unthanked > 0) out.push(`${f.unthanked} ${f.unthanked === 1 ? "gift" : "gifts"} not thanked yet`);
  if (f.opened12 > 0) out.push(`Opened ${f.opened12} community ${f.opened12 === 1 ? "message" : "messages"}`);
  return out;
}

/** Three or more no-ask touches for every ask; with no ask at all there is nothing out of balance. */
export function balanceOk(f: Pick<HealthFacts, "asks12" | "noAsk12">): boolean {
  return f.asks12 === 0 || f.noAsk12 >= 3 * f.asks12;
}

const LAPSED_DAYS = 548;
const COOLING_GIFT_DAYS = 183;
const MIN_HISTORY_MONTHS = 11;

export function classifyHealth(f: HealthFacts, ctx: { today: string; historyMonths: number; giving: boolean }): Health {
  const lines = factLines(f, ctx);
  const done = (level: HealthLevel, why: string[]): Health => ({ level, label: HEALTH_LABEL[level], reasons: [...why, ...lines.filter((l) => !why.includes(l))] });
  if (ctx.historyMonths < MIN_HISTORY_MONTHS) {
    const m = ctx.historyMonths;
    return done("not_enough_history", [`The community has ${m === 0 ? "no" : `about ${m} ${m === 1 ? "month" : "months"} of`} records in Weaver; a sign needs about a year`]);
  }
  const last = [f.lastGiftOn && ctx.giving ? f.lastGiftOn : null, f.lastPartOn].filter((x): x is string => x !== null).sort().pop() ?? null;
  if (last === null) return done("none", ["Nothing on record yet: no gift, no event, no volunteering"]);
  const idle = daysBetween(last, ctx.today);
  if (idle > LAPSED_DAYS) return done("lapsed", [`Nothing on record for ${Math.floor(idle / 30.4)} months`]);
  if (ctx.giving && f.giftsPrev12 > 0 && f.gifts12 === 0) return done("at_risk", [`Gave ${times(f.giftsPrev12)} the year before, and not in the last 12 months`]);
  if (ctx.giving && f.gifts12 > 0 && f.gifts12 < f.giftsPrev12) return done("cooling", [`Gave fewer times (${f.gifts12}) than the year before (${f.giftsPrev12})`]);
  if (ctx.giving && f.lastGiftOn && f.gifts12 > 0 && daysBetween(f.lastGiftOn, ctx.today) > COOLING_GIFT_DAYS) {
    return done("cooling", [`No gift for ${Math.floor(daysBetween(f.lastGiftOn, ctx.today) / 30.4)} months`]);
  }
  const steadyGiving = !ctx.giving || (f.gifts12 > 0 && f.gifts12 >= f.giftsPrev12);
  if (steadyGiving && f.part12 > 0 && balanceOk(f)) {
    return done("thriving", [ctx.giving ? "Steady giving, taking part, and the touches are in balance" : "Taking part, and the touches are in balance"]);
  }
  return done("steady", []);
}

// ── The organization's numbers ──────────────────────────────────────────────

export type CareDashboard = {
  state: "ok";
  today: string;
  historyMonths: number;
  giving: {
    donorsLast: number;
    donorsPrev: number;
    kept: number;
    lybunt: number;
    sybunt: number;
    retention: number | null;
    firstYear: { cohort: number; kept: number; rate: number | null };
  } | null;
  thanks: { gifts: number; thanked: number; open: number; overdue: number; medianHours: number | null; onTimeShare: number | null } | null;
  touches: { asks: number; noAsk: number; perAsk: number | null };
  key: { households: number; withOwner: number; share: number | null };
};

export function parseCareDashboard(v: unknown): CareDashboard {
  const o = obj(v);
  const g = o.giving && typeof o.giving === "object" ? obj(o.giving) : null;
  const fy = obj(g?.first_year);
  const t = o.thanks && typeof o.thanks === "object" ? obj(o.thanks) : null;
  const tc = obj(o.touches);
  const k = obj(o.key);
  return {
    state: "ok",
    today: str(o.today) ?? "",
    historyMonths: num(o.history_months),
    giving: g
      ? {
          donorsLast: num(g.donors_last),
          donorsPrev: num(g.donors_prev),
          kept: num(g.kept),
          lybunt: num(g.lybunt),
          sybunt: num(g.sybunt),
          retention: numOrNull(g.retention),
          firstYear: { cohort: num(fy.cohort), kept: num(fy.kept), rate: numOrNull(fy.rate) },
        }
      : null,
    thanks: t
      ? { gifts: num(t.gifts), thanked: num(t.thanked), open: num(t.open), overdue: num(t.overdue), medianHours: numOrNull(t.median_hours), onTimeShare: numOrNull(t.on_time_share) }
      : null,
    touches: { asks: num(tc.asks), noAsk: num(tc.no_ask), perAsk: numOrNull(tc.per_ask) },
    key: { households: num(k.households), withOwner: num(k.with_owner), share: numOrNull(k.share) },
  };
}

/** A share as a percent ("67%"); null stays null. */
export function percent(share: number | null): string | null {
  return share === null ? null : `${Math.round(share * 100)}%`;
}

/** Comparing two years needs about two years of records; below that the number would mislead. */
export const MIN_COMPARE_MONTHS = 23;
export const NOT_ENOUGH = "Not enough yet";

/** True once Weaver holds about two years of records, so that a year-on-year number means something. */
export function canCompareYears(historyMonths: number): boolean {
  return historyMonths >= MIN_COMPARE_MONTHS;
}

/** Why a year-on-year number is not shown yet. */
export function compareNote(historyMonths: number): string {
  const m = historyMonths;
  return `Weaver has ${m === 0 ? "no" : `about ${m} ${m === 1 ? "month" : "months"} of`} records; this compares two years`;
}

/** Retention, or why there is none yet. */
export function retentionLine(rate: number | null, historyMonths: number): string {
  if (!canCompareYears(historyMonths)) return NOT_ENOUGH;
  return percent(rate) ?? "No one gave the year before";
}

/** No-ask touches for each ask ("3.0 for each ask"), or why there is none. */
export function perAskLine(perAsk: number | null, goal = 3): string {
  if (perAsk === null) return "No ask recorded in the last 12 months";
  const n = perAsk.toFixed(1);
  return perAsk >= goal ? `${n} for each ask` : `${n} for each ask (aim for ${goal} or more)`;
}
