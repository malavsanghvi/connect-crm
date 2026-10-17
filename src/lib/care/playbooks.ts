// DonorDelight slice 5 (connect-crm 0891): the playbooks of a community, in words. Pure: no React and no server imports, so the screen, the
// editor, the actions and the tests read the same thing. The database decides who may read and change (app.care_can: no platform-admin
// branch); this file only reads what came back, checks what is typed the way the database will, and says it in plain English.
//
// A playbook is a set of timed steps for one kind of household. A step is a TOUCH to record (never an ask for money: there is no "ask" in a step;
// an ask is its own touch and comes only through who-to-approach, after the touch balance). The draft is the organization's own words with three
// placeholders: {{name}} (the adult to reach), {{me}} (the person writing) and {{org}} (the organization).

import { CHANNEL_LABEL, TOUCH_KIND_LABEL, type TouchChannel, type TouchKind } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const TRIGGERS = [
  "first_gift",
  "new_household",
  "steady",
  "cooling",
  "at_risk",
  "lapsed",
  "volunteer_no_gift",
  "giver_no_part",
  "pledge_due",
  "monthly_giver",
] as const;
export type TriggerKey = (typeof TRIGGERS)[number];

export const TRIGGER_LABEL: Record<TriggerKey, string> = {
  first_gift: "A household's first gift",
  new_household: "A new household",
  steady: "A steady giver",
  cooling: "A household that is cooling",
  at_risk: "A household at risk",
  lapsed: "A household that has gone quiet for a long time",
  volunteer_no_gift: "A volunteer who does not give",
  giver_no_part: "A giver who does not take part",
  pledge_due: "A pledge falling due",
  monthly_giver: "A monthly giver",
};

/** When a household enters it, in one sentence (the same arithmetic as the engagement signs). */
export const TRIGGER_HELP: Record<TriggerKey, string> = {
  first_gift: "The household's first gift, with no earlier history, within the window.",
  new_household: "A household added within the window.",
  steady: "As many gifts in the last 12 months as the year before, and not cooling, at risk or lapsed.",
  cooling: "Fewer gifts than the year before, or no gift for six months.",
  at_risk: "Gave the year before and nothing in the last 12 months.",
  lapsed: "Nothing on record for 18 months: no gift, no event, no shift.",
  volunteer_no_gift: "Took part in two or more volunteer shifts in the last 12 months and gave nothing in two years.",
  giver_no_part: "Gave in the last 12 months and took part in nothing.",
  pledge_due: "A pledge with a balance falls due within the window. A reminder, never an ask for more.",
  monthly_giver: "Has an active monthly recurring gift.",
};

/** Triggers that use the window (days), and what it counts. */
export const WINDOW_TRIGGERS: Partial<Record<TriggerKey, string>> = {
  first_gift: "Still start for a first gift up to this many days old",
  new_household: "Still start for a household added up to this many days ago",
  pledge_due: "Start this many days before a pledge falls due",
};
/** Triggers that can start again, and how long they wait. */
export const COOLDOWN_TRIGGERS: readonly TriggerKey[] = ["steady", "cooling", "at_risk", "lapsed", "volunteer_no_gift", "giver_no_part", "pledge_due", "monthly_giver"];

/** The kinds a step may be: any touch except a care moment (which is never planned). */
export const STEP_KINDS = ["thank_you", "check_in", "greeting", "welcome", "update", "invitation", "other"] as const satisfies readonly TouchKind[];
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_KIND_LABEL: Record<StepKind, string> = {
  thank_you: TOUCH_KIND_LABEL.thank_you,
  check_in: TOUCH_KIND_LABEL.check_in,
  greeting: TOUCH_KIND_LABEL.greeting,
  welcome: TOUCH_KIND_LABEL.welcome,
  update: TOUCH_KIND_LABEL.update,
  invitation: TOUCH_KIND_LABEL.invitation,
  other: TOUCH_KIND_LABEL.other,
};
export const STEP_CHANNELS = ["in_person", "phone", "text", "email", "whatsapp", "post", "video", "other"] as const satisfies readonly TouchChannel[];

export const MAX_STEPS = 12;
export const DRAFT_HELP = "Use {{name}} for the person you are writing to, {{me}} for you and {{org}} for your organization.";

// ── Shapes ──────────────────────────────────────────────────────────────────
export type PlaybookStep = {
  id: string;
  position: number;
  afterDays: number;
  title: string;
  why: string;
  kind: StepKind;
  channel: TouchChannel | null;
  draft: string | null;
};
export type Playbook = {
  id: string;
  key: string;
  name: string;
  summary: string | null;
  trigger: TriggerKey;
  windowDays: number;
  cooldownDays: number;
  enabled: boolean;
  starterKey: string | null;
  steps: PlaybookStep[];
};
export type PlaybookList = { playbooks: Playbook[]; startersMissing: number; audience: "faith" | "civic"; canManage: boolean; label: string };

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}

export function parsePlaybooks(v: unknown): PlaybookList {
  const o = obj(v);
  return {
    playbooks: arr(o.playbooks)
      .map((p): Playbook | null => {
        const x = obj(p);
        const trigger = oneOf(TRIGGERS, x.trigger_key);
        const id = str(x.id);
        if (!trigger || !id) return null;
        return {
          id,
          key: str(x.key) ?? "",
          name: str(x.name) ?? "Playbook",
          summary: str(x.summary),
          trigger,
          windowDays: num(x.window_days) || 60,
          cooldownDays: num(x.cooldown_days) || 180,
          enabled: bool(x.enabled),
          starterKey: str(x.starter_key),
          steps: arr(x.steps).map((s): PlaybookStep => {
            const y = obj(s);
            return {
              id: str(y.id) ?? "",
              position: num(y.position),
              afterDays: num(y.after_days),
              title: str(y.title) ?? "",
              why: str(y.why) ?? "",
              kind: oneOf(STEP_KINDS, y.kind) ?? "other",
              channel: oneOf(STEP_CHANNELS, y.channel),
              draft: str(y.draft),
            };
          }),
        };
      })
      .filter((p): p is Playbook => p !== null),
    startersMissing: num(o.starters_missing),
    audience: o.audience === "faith" ? "faith" : "civic",
    canManage: bool(o.can_manage),
    label: str(o.label) ?? "DonorDelight",
  };
}

// ── What is typed, checked the way the database will ─────────────────────────
export type StepInput = { id?: string | null; afterDays: number; title: string; why: string; kind: StepKind; channel: TouchChannel | null; draft: string };
export type PlaybookInput = {
  id?: string | null;
  name: string;
  summary: string;
  trigger: TriggerKey;
  windowDays: number;
  cooldownDays: number;
  enabled: boolean;
  steps: StepInput[];
};

export function blankStep(afterDays = 0): StepInput {
  return { id: null, afterDays, title: "", why: "", kind: "check_in", channel: "phone", draft: "" };
}
export function blankPlaybook(): PlaybookInput {
  return { id: null, name: "", summary: "", trigger: "steady", windowDays: 60, cooldownDays: 180, enabled: true, steps: [blankStep(0)] };
}
export function playbookInput(p: Playbook): PlaybookInput {
  return {
    id: p.id,
    name: p.name,
    summary: p.summary ?? "",
    trigger: p.trigger,
    windowDays: p.windowDays,
    cooldownDays: p.cooldownDays,
    enabled: p.enabled,
    steps: p.steps.map((s) => ({ id: s.id, afterDays: s.afterDays, title: s.title, why: s.why, kind: s.kind, channel: s.channel, draft: s.draft ?? "" })),
  };
}

export type Checked = { ok: true } | { ok: false; error: string };

/** The same rules as app.save_care_playbook, in the same words: the first problem found, or ok. */
export function checkPlaybook(p: PlaybookInput): Checked {
  const bad = (error: string): Checked => ({ ok: false, error });
  const name = p.name.trim();
  if (name.length < 1 || name.length > 80) return bad("Give the playbook a name of up to 80 characters.");
  if (p.summary.trim().length > 300) return bad("The summary is at most 300 characters.");
  if (!(TRIGGERS as readonly string[]).includes(p.trigger)) return bad("Say who the playbook is for.");
  if (!Number.isInteger(p.windowDays) || p.windowDays < 1 || p.windowDays > 365) return bad("The window is 1 to 365 days.");
  if (!Number.isInteger(p.cooldownDays) || p.cooldownDays < 30 || p.cooldownDays > 1095) return bad("Wait 30 to 1,095 days before a household enters the same playbook again.");
  if (p.steps.length < 1 || p.steps.length > MAX_STEPS) return bad(`A playbook has 1 to ${MAX_STEPS} steps.`);
  for (const [i, s] of p.steps.entries()) {
    const n = i + 1;
    if (!Number.isInteger(s.afterDays) || s.afterDays < 0 || s.afterDays > 365) return bad(`Step ${n}: say how many days after the household enters it (0 to 365).`);
    if (s.title.trim().length < 1 || s.title.trim().length > 120) return bad(`Step ${n}: give it a title of up to 120 characters.`);
    if (s.why.trim().length < 1 || s.why.trim().length > 300) return bad(`Step ${n}: say why, in up to 300 characters.`);
    if (!(STEP_KINDS as readonly string[]).includes(s.kind)) return bad(`Step ${n}: say what the touch is.`);
    if (s.draft.trim().length > 1500) return bad(`Step ${n}: the draft is at most 1,500 characters.`);
  }
  return { ok: true };
}

/** The object app.save_care_playbook takes. */
export function toPayload(p: PlaybookInput): Record<string, unknown> {
  return {
    ...(p.id ? { id: p.id } : {}),
    name: p.name.trim(),
    summary: p.summary.trim() === "" ? null : p.summary.trim(),
    trigger_key: p.trigger,
    window_days: p.windowDays,
    cooldown_days: p.cooldownDays,
    enabled: p.enabled,
    steps: p.steps.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      after_days: s.afterDays,
      title: s.title.trim(),
      why: s.why.trim(),
      kind: s.kind,
      channel: s.channel,
      draft: s.draft.trim() === "" ? null : s.draft.trim(),
    })),
  };
}

// ── Words ───────────────────────────────────────────────────────────────────
/** "Day 0", "3 days later", "A week later": when a step falls, counted from the day the household enters. */
export function afterLine(days: number): string {
  if (days === 0) return "The day they enter";
  if (days === 1) return "1 day later";
  if (days === 7) return "A week later";
  return `${days} days later`;
}

export function stepWay(s: Pick<PlaybookStep, "kind" | "channel">): string {
  const kind = STEP_KIND_LABEL[s.kind] ?? "Touch";
  return s.channel ? `${kind} · ${CHANNEL_LABEL[s.channel] ?? s.channel}` : kind;
}

/** A draft with its placeholders filled; a missing name reads "there", a missing sender is left as a visible gap to fill by hand. */
export function fillDraft(text: string | null | undefined, v: { name?: string | null; me?: string | null; org?: string | null }): string {
  if (!text) return "";
  const map: Record<string, string> = {
    name: v.name?.trim() || "there",
    me: v.me?.trim() || "[your name]",
    org: v.org?.trim() || "our organization",
  };
  return text.replace(/\{\{\s*(name|me|org)\s*\}\}/g, (_m, k: string) => map[k]);
}
