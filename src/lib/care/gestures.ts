// DonorDelight slice 6 (connect-crm 0894): the gesture library in words, and which gestures suit a household. Pure: no React and no server imports.
//
// A gesture is a thing to do FOR a supporter. It is NEVER paired with an ask: there is no ask in it (no field for one), the touch it records is always
// "no ask", and words that ask for a gift, a donation or a pledge cannot be saved (checkGesture here and app._care_words_ask in the database use the
// same list). Which gestures suit a household is worked out here from the household's own care profile and the records its organization already holds
// (People): how they like to be thanked, how they like to be recognised, a special day, an anniversary, expertise, interests. Nothing from outside the
// organization, nothing about anyone under 18 (the card lists adults only), no amount.

import { fillDraft } from "@/lib/care/playbooks";
import {
  THANKS_LABEL,
  TOUCH_CHANNELS,
  TOUCH_KINDS,
  type CareCard,
  type Thanks,
  type TouchChannel,
  type TouchKind,
} from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const COSTS = ["free", "low"] as const;
export type Cost = (typeof COSTS)[number];
export const COST_LABEL: Record<Cost, string> = { free: "Free", low: "Low cost" };
export const EFFORTS = ["quick", "some", "a_while"] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABEL: Record<Effort, string> = { quick: "A few minutes", some: "Under an hour", a_while: "Half a day or more" };
export const WHOS = ["anyone", "leader", "staff", "volunteer"] as const;
export type Who = (typeof WHOS)[number];
export const WHO_LABEL: Record<Who, string> = { anyone: "Anyone", leader: "A leader", staff: "Staff", volunteer: "A volunteer" };

export const SUIT_THANKS = ["in_person", "call", "card", "message"] as const satisfies readonly Thanks[];
export const SUIT_RECOGNITION = ["public", "private_only", "anonymous"] as const;
export const NEEDS = ["special_day", "anniversary", "expertise", "interests"] as const;
export type Need = (typeof NEEDS)[number];
export const NEED_LABEL: Record<Need, string> = {
  special_day: "A special day on file",
  anniversary: "An anniversary on file",
  expertise: "Expertise on file",
  interests: "Interests on file",
};
export const RECOGNITION_SUIT_LABEL: Record<(typeof SUIT_RECOGNITION)[number], string> = { public: "Happy to be named", private_only: "Private only", anonymous: "Anonymous" };

export type Gesture = {
  id: string;
  key: string;
  name: string;
  description: string;
  cost: Cost;
  effort: Effort;
  who: Who;
  suitsThanks: string[];
  suitsRecognition: string[];
  needs: string[];
  suggest: boolean;
  kind: TouchKind;
  channel: TouchChannel | null;
  draft: string | null;
  enabled: boolean;
  starterKey: string | null;
};
export type GestureList = { gestures: Gesture[]; startersMissing: number; audience: "faith" | "civic"; canManage: boolean; label: string };

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null;
}
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string" && x !== "");

export function parseGestures(v: unknown): GestureList {
  const o = obj(v);
  return {
    gestures: arr(o.gestures)
      .map((g): Gesture | null => {
        const x = obj(g);
        const id = str(x.id);
        if (!id) return null;
        return {
          id,
          key: str(x.key) ?? "",
          name: str(x.name) ?? "Gesture",
          description: str(x.description) ?? "",
          cost: oneOf(COSTS, x.cost) ?? "free",
          effort: oneOf(EFFORTS, x.effort) ?? "quick",
          who: oneOf(WHOS, x.who) ?? "anyone",
          suitsThanks: strs(x.suits_thanks),
          suitsRecognition: strs(x.suits_recognition),
          needs: strs(x.needs),
          suggest: x.suggest !== false,
          kind: oneOf(TOUCH_KINDS, x.kind) ?? "other",
          channel: oneOf(TOUCH_CHANNELS, x.channel),
          draft: str(x.draft),
          enabled: bool(x.enabled),
          starterKey: str(x.starter_key),
        };
      })
      .filter((g): g is Gesture => g !== null),
    startersMissing: num(o.starters_missing),
    audience: o.audience === "faith" ? "faith" : "civic",
    canManage: bool(o.can_manage),
    label: str(o.label) ?? "DonorDelight",
  };
}

// ── Never an ask ────────────────────────────────────────────────────────────
// The same words as app._care_words_ask (0894). A plain check on words: it cannot catch every phrasing, which is why a gesture also records a touch that
// is always "no ask".
const ASK_WORDS =
  /(please (give|donate|contribute|pledge)|(would|could|can|will) you (please )?(give|donate|contribute|pledge|consider (giving|donating|a (gift|donation)))|make a (gift|donation|pledge|contribution)|donate (now|today|here)|give (now|today|generously)|consider (giving|donating)|support us with a|\$ ?[0-9])/i;
export function wordsAsk(text: string | null | undefined): boolean {
  return ASK_WORDS.test(text ?? "");
}

// ── What is typed, checked the way the database will ─────────────────────────
export type GestureInput = {
  id?: string | null;
  name: string;
  description: string;
  cost: Cost;
  effort: Effort;
  who: Who;
  suitsThanks: string[];
  suitsRecognition: string[];
  needs: string[];
  suggest: boolean;
  kind: TouchKind;
  channel: TouchChannel | null;
  draft: string;
  enabled: boolean;
};
export function blankGesture(): GestureInput {
  return { id: null, name: "", description: "", cost: "free", effort: "quick", who: "anyone", suitsThanks: [], suitsRecognition: [], needs: [], suggest: true, kind: "check_in", channel: "phone", draft: "", enabled: true };
}
export function gestureInput(g: Gesture): GestureInput {
  return {
    id: g.id, name: g.name, description: g.description, cost: g.cost, effort: g.effort, who: g.who, suitsThanks: g.suitsThanks, suitsRecognition: g.suitsRecognition,
    needs: g.needs, suggest: g.suggest, kind: g.kind, channel: g.channel, draft: g.draft ?? "", enabled: g.enabled,
  };
}

export type Checked = { ok: true } | { ok: false; error: string };
export const NEVER_ASK = "A gesture is never paired with an ask. Take out the words that ask for a gift, a donation or a pledge; an ask is its own step, later.";

/** The same rules as app.save_care_gesture, in the same words: the first problem found, or ok. */
export function checkGesture(g: GestureInput): Checked {
  const bad = (error: string): Checked => ({ ok: false, error });
  if (g.name.trim().length < 1 || g.name.trim().length > 80) return bad("Give the gesture a name of up to 80 characters.");
  if (g.description.trim().length < 1 || g.description.trim().length > 400) return bad("Say what to do, in up to 400 characters.");
  if (!(COSTS as readonly string[]).includes(g.cost)) return bad("A gesture costs nothing or very little: choose free or low.");
  if (!(EFFORTS as readonly string[]).includes(g.effort)) return bad("Say how much effort it takes: quick, some or a while.");
  if (!(WHOS as readonly string[]).includes(g.who)) return bad("Say who should do it: a leader, staff, a volunteer or anyone.");
  if (!(TOUCH_KINDS as readonly string[]).includes(g.kind)) return bad("Say what the touch is.");
  if (g.draft.trim().length > 1500) return bad("The draft is at most 1,500 characters.");
  if (wordsAsk(g.name) || wordsAsk(g.description) || wordsAsk(g.draft)) return bad(NEVER_ASK);
  return { ok: true };
}

/** The object app.save_care_gesture takes. */
export function toPayload(g: GestureInput): Record<string, unknown> {
  return {
    ...(g.id ? { id: g.id } : {}),
    name: g.name.trim(),
    description: g.description.trim(),
    cost: g.cost,
    effort: g.effort,
    who: g.who,
    suits_thanks: g.suitsThanks,
    suits_recognition: g.suitsRecognition,
    needs: g.needs,
    suggest: g.kind === "care_moment" ? false : g.suggest,
    kind: g.kind,
    channel: g.channel,
    draft: g.draft.trim() === "" ? null : g.draft.trim(),
    enabled: g.enabled,
  };
}

// ── Words ───────────────────────────────────────────────────────────────────
/** "Free · A few minutes · A leader". */
export function gestureLine(g: Pick<Gesture, "cost" | "effort" | "who">): string {
  return [COST_LABEL[g.cost], EFFORT_LABEL[g.effort], WHO_LABEL[g.who]].join(" · ");
}

/** Who each profile choice suits, in one line ("Suits households who like a card or a message"), or null when it suits any. */
export function suitsLine(g: Pick<Gesture, "suitsThanks" | "suitsRecognition">): string | null {
  const bits: string[] = [];
  if (g.suitsThanks.length > 0) bits.push(`households who like to be thanked ${g.suitsThanks.map((t) => (THANKS_LABEL[t as Thanks] ?? t).toLowerCase()).join(" or ")}`);
  if (g.suitsRecognition.length > 0) bits.push(`households who are ${g.suitsRecognition.map((r) => RECOGNITION_SUIT_LABEL[r as (typeof SUIT_RECOGNITION)[number]]?.toLowerCase() ?? r).join(" or ")}`);
  return bits.length === 0 ? null : `Suits ${bits.join(", and ")}`;
}

export function needsLine(g: Pick<Gesture, "needs">): string | null {
  return g.needs.length === 0 ? null : `Needs: ${g.needs.map((n) => NEED_LABEL[n as Need]?.toLowerCase() ?? n).join(", ")}`;
}

// ── Which gestures suit a household ─────────────────────────────────────────
export type GestureIdea = { gesture: Gesture; reasons: string[]; draft: string; channel: TouchChannel };

function firstName(full: string | null | undefined): string | null {
  const t = (full ?? "").trim();
  return t === "" ? null : t.split(/\s+/)[0];
}

/**
 * Up to `limit` gestures that suit this household, best first, each with why. Left out: a paused gesture, one that is never offered on its own (a care
 * moment: a person chooses it), a thank-you for a household that asked for no thanks, a gesture that needs recognition they did not choose, one that suits
 * another way of being thanked, and one that needs a record the household does not have (or that this person may not read). Never an amount, never a child.
 */
export function ideasFor(gestures: readonly Gesture[], card: CareCard, ctx: { org?: string | null; me?: string | null } = {}, limit = 5): GestureIdea[] {
  const thanks = card.profile?.thanks ?? null;
  const recognition = card.profile?.recognition ?? null;
  const people = card.people ?? [];
  const has: Record<Need, boolean> = {
    special_day: (card.specialDays ?? []).length > 0,
    anniversary: people.some((p) => p.anniversary !== null),
    expertise: people.some((p) => p.expertise.length > 0),
    interests: people.some((p) => p.interests.length > 0),
  };
  const contact = firstName(card.profile?.contactName) ?? firstName(card.household.primaryMember);
  const scored: { idea: GestureIdea; score: number; at: number }[] = [];
  gestures.forEach((g, at) => {
    if (!g.enabled || !g.suggest) return;
    if (thanks === "none" && g.kind === "thank_you") return;
    if (g.suitsRecognition.length > 0 && (recognition === null || !g.suitsRecognition.includes(recognition))) return;
    if (g.suitsThanks.length > 0 && thanks !== null && (thanks === "none" || !g.suitsThanks.includes(thanks))) return;
    if (g.needs.some((n) => !has[n as Need])) return;
    const reasons: string[] = [];
    let score = 0;
    if (g.suitsThanks.length > 0 && thanks !== null) {
      reasons.push(`They like to be thanked ${(THANKS_LABEL[thanks] ?? thanks).toLowerCase()}`);
      score += 3;
    }
    if (g.suitsRecognition.length > 0) {
      reasons.push("They chose to be named");
      score += 2;
    }
    for (const n of g.needs) {
      reasons.push(NEED_LABEL[n as Need]);
      score += 2;
    }
    if (reasons.length === 0) reasons.push("Suits any household");
    if (g.cost === "free") score += 1;
    scored.push({
      idea: { gesture: g, reasons, draft: fillDraft(g.draft, { name: contact, me: ctx.me, org: ctx.org }), channel: g.channel ?? card.profile?.channel ?? "phone" },
      score,
      at,
    });
  });
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.idea);
}

