// DonorDelight slice 8 (connect-crm 0896): the care plan from the mission, in words. Pure: no React and no server imports.
//
// A care plan is a yearly calendar of relationship moments: on this day, this group of households gets this kind of touch. It is drafted from the organization's
// own mission, calendar, fiscal year and quiet periods, EDITED and APPROVED by a care manager, and nothing in it runs by itself: it is a calendar for the team to
// follow. A moment is a touch to make, never an ask (the same words check as a gesture); an ask is its own step, later, after the touch balance.
// The draft is plain arithmetic and wording (no model): Niva can talk it through, and a person decides.

import { wordsAsk } from "@/lib/care/gestures";
import { STEP_KINDS, STEP_KIND_LABEL, TRIGGERS, TRIGGER_LABEL, type StepKind, type TriggerKey } from "@/lib/care/playbooks";
import { formatDay } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const PLAN_GROUPS = ["all", ...TRIGGERS] as const;
export type PlanGroup = (typeof PLAN_GROUPS)[number];
export const PLAN_GROUP_LABEL: Record<PlanGroup, string> = { all: "Every household", ...TRIGGER_LABEL };
export const MAX_MOMENTS = 60;
export const NEVER_ASK_PLAN = "A care plan is never paired with an ask. Take out the words that ask for a gift, a donation or a pledge; an ask is its own step, later.";

// ── Shapes ──────────────────────────────────────────────────────────────────
export type PlanItem = { id: string; on: string; title: string; group: PlanGroup; kind: StepKind; note: string | null };
export type CarePlan = {
  year: number;
  exists: boolean;
  status: "none" | "draft" | "approved";
  summary: string | null;
  items: PlanItem[];
  approvedAt: string | null;
  updatedAt: string | null;
  years: number[];
  canManage: boolean;
  label: string;
  today: string;
};
export type QuietIn = { name: string; startsOn: string; endsOn: string; yearly: boolean };
export type PlanContext = {
  year: number;
  audience: "faith" | "civic";
  mission: string | null;
  fiscalYearStartMonth: number;
  /** How many households are in each group (a count, never a household). */
  groups: Partial<Record<TriggerKey, number>>;
  calendar: { title: string; on: string }[];
  quietPeriods: QuietIn[];
  playbooks: string[];
  gestures: number;
  label: string;
};

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

export function parsePlan(v: unknown): CarePlan {
  const o = obj(v);
  const status = o.status === "approved" ? "approved" : o.status === "draft" ? "draft" : "none";
  return {
    year: num(o.year),
    exists: bool(o.exists),
    status,
    summary: str(o.summary),
    items: arr(o.items)
      .map((i): PlanItem | null => {
        const x = obj(i);
        const id = str(x.id);
        const on = str(x.on);
        if (!id || !on) return null;
        return { id, on, title: str(x.title) ?? "", group: oneOf(PLAN_GROUPS, x.group) ?? "all", kind: oneOf(STEP_KINDS, x.kind) ?? "other", note: str(x.note) };
      })
      .filter((i): i is PlanItem => i !== null),
    approvedAt: str(o.approved_at),
    updatedAt: str(o.updated_at),
    years: arr(o.years).filter((y): y is number => typeof y === "number"),
    canManage: bool(o.can_manage),
    label: str(o.label) ?? "DonorDelight",
    today: str(o.today) ?? "",
  };
}

export function parsePlanContext(v: unknown): PlanContext {
  const o = obj(v);
  const groups: Partial<Record<TriggerKey, number>> = {};
  for (const [k, n] of Object.entries(obj(o.groups))) if (oneOf(TRIGGERS, k) && typeof n === "number") groups[k as TriggerKey] = n;
  return {
    year: num(o.year),
    audience: o.audience === "faith" ? "faith" : "civic",
    mission: str(o.mission),
    fiscalYearStartMonth: Math.min(12, Math.max(1, num(o.fiscal_year_start_month) || 1)),
    groups,
    calendar: arr(o.calendar).map((c) => ({ title: str(obj(c).title) ?? "", on: str(obj(c).on) ?? "" })).filter((c) => c.title !== "" && c.on !== ""),
    quietPeriods: arr(o.quiet_periods).map((q) => {
      const x = obj(q);
      return { name: str(x.name) ?? "", startsOn: str(x.starts_on) ?? "", endsOn: str(x.ends_on) ?? "", yearly: bool(x.yearly) };
    }).filter((q) => q.name !== "" && q.startsOn !== "" && q.endsOn !== ""),
    playbooks: arr(o.playbooks).filter((p): p is string => typeof p === "string"),
    gestures: num(o.gestures),
    label: str(o.label) ?? "DonorDelight",
  };
}

// ── What is typed, checked the way the database will ─────────────────────────
export type PlanItemInput = { id?: string | null; on: string; title: string; group: PlanGroup; kind: StepKind; note: string };
export type PlanInput = { summary: string; items: PlanItemInput[] };
export type Checked = { ok: true } | { ok: false; error: string };

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The same rules as app.save_care_plan, in the same words: the first problem found, or ok. */
export function checkPlan(year: number, p: PlanInput): Checked {
  const bad = (error: string): Checked => ({ ok: false, error });
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return bad("Choose a year between 2000 and 2100.");
  if (p.summary.trim().length > 1000) return bad("The summary is at most 1,000 characters.");
  if (p.items.length > MAX_MOMENTS) return bad(`A care plan has at most ${MAX_MOMENTS} moments.`);
  if (wordsAsk(p.summary)) return bad(NEVER_ASK_PLAN);
  for (const [i, it] of p.items.entries()) {
    const n = i + 1;
    if (!isDay(it.on) || Number(it.on.slice(0, 4)) !== year) return bad(`Moment ${n}: choose a day in ${year}.`);
    if (it.title.trim().length < 1 || it.title.trim().length > 120) return bad(`Moment ${n}: give it a title of up to 120 characters.`);
    if (!(PLAN_GROUPS as readonly string[]).includes(it.group)) return bad(`Moment ${n}: say which households it is for: everyone, or one of the groups.`);
    if (!(STEP_KINDS as readonly string[]).includes(it.kind)) return bad(`Moment ${n}: say what the touch is.`);
    if (it.note.trim().length > 400) return bad(`Moment ${n}: the note is at most 400 characters.`);
    if (wordsAsk(it.title) || wordsAsk(it.note)) return bad(`Moment ${n}: ${NEVER_ASK_PLAN.charAt(0).toLowerCase()}${NEVER_ASK_PLAN.slice(1)}`);
  }
  return { ok: true };
}

/** The object app.save_care_plan takes. */
export function toPayload(p: PlanInput): Record<string, unknown> {
  return {
    summary: p.summary.trim() === "" ? null : p.summary.trim(),
    items: p.items.map((i) => ({
      ...(i.id ? { id: i.id } : {}),
      on: i.on,
      title: i.title.trim(),
      group: i.group,
      kind: i.kind,
      note: i.note.trim() === "" ? null : i.note.trim(),
    })),
  };
}
export function planInput(p: CarePlan): PlanInput {
  return { summary: p.summary ?? "", items: p.items.map((i) => ({ id: i.id, on: i.on, title: i.title, group: i.group, kind: i.kind, note: i.note ?? "" })) };
}

// ── Words ───────────────────────────────────────────────────────────────────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const monthName = (m: number): string => MONTHS[Math.min(11, Math.max(0, m - 1))];

export function itemLine(i: Pick<PlanItem, "group" | "kind">): string {
  return `${PLAN_GROUP_LABEL[i.group]} · ${STEP_KIND_LABEL[i.kind]}`;
}

/** The moments grouped by month, in date order: [["March", [...]], ...]. */
export function byMonth(items: readonly PlanItem[]): [string, PlanItem[]][] {
  const out: [string, PlanItem[]][] = [];
  for (const i of [...items].sort((a, b) => a.on.localeCompare(b.on) || a.title.localeCompare(b.title))) {
    const m = monthName(Number(i.on.slice(5, 7)));
    const last = out.at(-1);
    if (last && last[0] === m) last[1].push(i);
    else out.push([m, [i]]);
  }
  return out;
}

/** The moments from `today` on, within `days`. */
export function comingUp(items: readonly PlanItem[], today: string, days = 30): PlanItem[] {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return [...items].filter((i) => i.on >= today && i.on <= end).sort((a, b) => a.on.localeCompare(b.on));
}

export const dayLine = (iso: string): string => formatDay(iso);

// ── The draft ───────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(Math.min(d, lastDay(y, m)))}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Is this day inside one of the quiet periods (a yearly one repeats every year and may cross the new year)? */
export function quietOn(day: string, periods: readonly QuietIn[]): QuietIn | null {
  const md = (d: string) => Number(d.slice(5, 7)) * 100 + Number(d.slice(8, 10));
  for (const q of periods) {
    if (!q.yearly) {
      if (day >= q.startsOn && day <= q.endsOn) return q;
      continue;
    }
    const s = md(q.startsOn);
    const e = md(q.endsOn);
    const d = md(day);
    if (s <= e ? d >= s && d <= e : d >= s || d <= e) return q;
  }
  return null;
}

/** The Tuesday after the fourth Thursday of November: a day many organizations ask on, which a civic plan uses to thank first. */
function thanksgivingTuesday(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const fourthThursday = 1 + ((4 - first + 7) % 7) + 21;
  return iso(year, 11, fourthThursday + 5);
}

/**
 * A first draft of the year, from what the organization already has: its mission, its own calendar, its fiscal year, its quiet periods and the groups
 * of households it has. Plain wording, no model, never an ask. A care manager edits it and approves it.
 */
export function skeletonPlan(ctx: PlanContext, year: number): PlanInput {
  const F = ctx.fiscalYearStartMonth;
  const monthAt = (k: number) => ((F - 1 + k) % 12) + 1;
  const items: PlanItemInput[] = [];
  const add = (on: string, title: string, group: PlanGroup, kind: StepKind, note = "") => {
    if (Number(on.slice(0, 4)) !== year) return;
    const q = quietOn(on, ctx.quietPeriods);
    items.push({ on, title, group, kind, note: q ? `${note ? `${note} ` : ""}A quiet period applies (${q.name}): care and greetings only.` : note });
  };
  const has = (g: TriggerKey) => ctx.groups[g] === undefined || (ctx.groups[g] ?? 0) > 0;

  // Each fiscal quarter: a call with no ask for the steady givers, a hello for those who are cooling, a welcome check-in for the new.
  for (const k of [1, 4, 7, 10]) {
    const m = monthAt(k);
    if (has("steady")) add(iso(year, m, 10), "Call a few steady givers, only to say thank you", "steady", "thank_you", "No ask on this call.");
    if (has("cooling")) add(iso(year, m, 20), "Reach out to households that are cooling", "cooling", "check_in", "Listen first.");
    if (has("new_household")) add(iso(year, m, 5), "Check in with households that joined lately", "new_household", "welcome");
  }
  // Twice a year: a kind word to households at risk or long quiet.
  for (const k of [2, 8]) {
    const m = monthAt(k);
    if (has("at_risk")) add(iso(year, m, 14), "Write to households at risk", "at_risk", "greeting", "A handwritten card is enough.");
    if (has("lapsed")) add(iso(year, m, 22), "Say hello to households that have gone quiet", "lapsed", "greeting");
  }
  // Once a year each: volunteers, those who give from a distance, monthly givers.
  if (has("volunteer_no_gift")) add(iso(year, monthAt(5), 12), "Thank volunteers for their time", "volunteer_no_gift", "thank_you", "Thank them for the time; nothing else.");
  if (has("giver_no_part")) add(iso(year, monthAt(3), 12), "Ask how givers would like to take part", "giver_no_part", "check_in");
  if (has("monthly_giver")) add(iso(year, monthAt(6), 8), "Thank monthly givers for their steady gift", "monthly_giver", "thank_you");

  // The organization's own calendar: a greeting a few days before each (at most eight, spread across the year).
  const cal = ctx.calendar.filter((c) => c.on.startsWith(String(year)));
  const step = Math.max(1, Math.ceil(cal.length / 8));
  for (const [idx, c] of cal.entries()) {
    if (idx % step !== 0) continue;
    const on = addDays(c.on, -3);
    add(Number(on.slice(0, 4)) === year ? on : c.on, `Greet households around ${c.title}`, "all", "greeting", "A short call or card.");
  }

  // The end of the fiscal year: thank before it closes, and show what the year made possible.
  const endMonth = F === 1 ? 12 : F - 1;
  const endDay = iso(year, endMonth, 31);
  add(addDays(endDay, -21), "Thank every household before the year closes", "all", "thank_you");
  add(addDays(endDay, 7), "Share what the year made possible", "all", "update", "Show the results; do not ask.");

  // A day many organizations ask on: a plan for a civic organization thanks first.
  if (ctx.audience === "civic") {
    const t = thanksgivingTuesday(year);
    add(addDays(t, -14), "Thank before the day of giving: warm touches first", "steady", "thank_you", "A busy day for asking; this plan thanks first.");
    add(addDays(t, 3), "Thank everyone who gave on the day of giving", "all", "thank_you");
  }

  // The quiet periods themselves.
  for (const q of ctx.quietPeriods) {
    const start = q.yearly ? iso(year, Number(q.startsOn.slice(5, 7)), Number(q.startsOn.slice(8, 10))) : q.startsOn;
    if (Number(start.slice(0, 4)) !== year) continue;
    items.push({ on: start, title: `Quiet period: ${q.name}`, group: "all", kind: "greeting", note: `No asks until it ends (${formatDay(q.endsOn)}). Calls and greetings only.` });
  }

  const sorted = items.sort((a, b) => a.on.localeCompare(b.on) || a.title.localeCompare(b.title)).slice(0, MAX_MOMENTS);
  const mission = ctx.mission ? ctx.mission.replace(/\s+/g, " ").trim().slice(0, 600) : null;
  return {
    summary: `${mission ? `Our mission: ${mission} ` : ""}This plan says who we thank, and when, before anyone is asked.`,
    items: sorted,
  };
}
