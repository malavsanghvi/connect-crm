// DonorDelight slice 5 (connect-crm 0892-0893): "Your 5 this week" in words. Pure: no React and no server imports. The database decides who has
// which task (only the households a person owns or backs up; no amount, nobody under 18); this file only reads what came back and says it plainly.

import { parseHousehold, type CareHousehold, type TouchChannel, type TouchKind, TOUCH_CHANNELS, TOUCH_KINDS } from "@/lib/care/model";
import { daysBetween } from "@/lib/care/health";
import { fillDraft } from "@/lib/care/playbooks";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** `step`: a playbook step (one tap records its touch); `thank`: an open thank-you of the tracker (slice 3), closed by the touch it takes. */
export type WeekTask = {
  kind: "step" | "thank";
  runId: string | null;
  stepId: string | null;
  thankId: string | null;
  household: CareHousehold;
  /** The first name of the adult to reach. */
  contact: string | null;
  dueOn: string;
  overdue: boolean;
  title: string;
  why: string;
  touchKind: TouchKind;
  channel: TouchChannel;
  draft: string | null;
  /** A thank-you that needs a personal way (a call, a visit, a card). */
  personal: boolean;
};
export type Week = {
  today: string;
  total: number;
  overdue: number;
  tasks: WeekTask[];
  /** For a manager: households with a task due and nobody to do it. */
  needsOwner: number;
  me: string | null;
  org: string | null;
  label: string;
  playbooks: number;
};

export function parseWeek(v: unknown): Week {
  const o = obj(v);
  return {
    today: str(o.today) ?? "",
    total: num(o.total),
    overdue: num(o.overdue),
    tasks: arr(o.tasks)
      .map((t): WeekTask | null => {
        const x = obj(t);
        const kind = x.kind === "thank" ? "thank" : x.kind === "step" ? "step" : null;
        const household = parseHousehold(x.household);
        if (!kind || household.id === "") return null;
        const touchKind = (TOUCH_KINDS as readonly string[]).includes(String(x.touch_kind)) ? (x.touch_kind as TouchKind) : "other";
        const channel = (TOUCH_CHANNELS as readonly string[]).includes(String(x.channel)) ? (x.channel as TouchChannel) : "phone";
        return {
          kind,
          runId: str(x.run_id),
          stepId: str(x.step_id),
          thankId: str(x.thank_id),
          household,
          contact: str(x.contact),
          dueOn: str(x.due_on) ?? "",
          overdue: bool(x.overdue),
          title: str(x.title) ?? "A task",
          why: str(x.why) ?? "",
          touchKind,
          channel,
          draft: str(x.draft),
          personal: bool(x.personal),
        };
      })
      .filter((t): t is WeekTask => t !== null),
    needsOwner: num(o.needs_owner),
    me: str(o.me),
    org: str(o.org),
    label: str(o.label) ?? "DonorDelight",
    playbooks: num(o.playbooks),
  };
}

/** What Today and Home know of the week: two numbers, no names. */
export type WeekCounts = { tasks: number; overdue: number };
export function parseWeekCounts(v: unknown): WeekCounts | null {
  const o = obj(v);
  return o.state === "ok" ? { tasks: num(o.tasks), overdue: num(o.overdue) } : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** The headline of the week ("5 tasks this week, 2 overdue"). */
export function weekLine(w: Pick<Week, "total" | "overdue">): string {
  if (w.total === 0) return "Nothing waits for you this week.";
  const head = `${plural(w.total, "task")} this week`;
  return w.overdue > 0 ? `${head}, ${w.overdue} overdue` : head;
}

/** Today's and Home's row: null when nothing waits. */
export function weekTaskCopy(c: WeekCounts | null): { title: string; meta: string } | null {
  if (!c || c.tasks === 0) return null;
  return { title: `Your week: ${plural(c.tasks, "care task")}`, meta: c.overdue > 0 ? `${c.overdue} overdue` : "Each with why and a ready draft" };
}

/** When a task falls, in words: "Overdue by 3 days", "Due today", "Due tomorrow", "Due in 4 days". */
export function dueLine(dueOn: string, today: string): string {
  if (!dueOn || !today) return "";
  const d = daysBetween(today, dueOn);
  if (d < 0) return d === -1 ? "Overdue by 1 day" : `Overdue by ${-d} days`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

/** The draft with its placeholders filled for this task and this person. */
export function draftFor(t: Pick<WeekTask, "draft" | "contact">, w: Pick<Week, "me" | "org">): string {
  return fillDraft(t.draft, { name: t.contact, me: w.me, org: w.org });
}

// ── The weekly reminder's setting ───────────────────────────────────────────
export type WeekSettings = { notify: boolean; dow: number; canManage: boolean };
export function parseWeekSettings(v: unknown): WeekSettings {
  const o = obj(v);
  const dow = o.notify_dow;
  return { notify: bool(o.notify), dow: typeof dow === "number" && Number.isInteger(dow) && dow >= 0 && dow <= 6 ? dow : 1, canManage: bool(o.can_manage) };
}
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
