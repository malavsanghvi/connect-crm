// The exceptions inbox, as logic and words. Pure: no database, no React. The screen (src/app/(app)/setup/onboarding/questions) is a
// thin layer over this: which question is in front, what the cards say, what an answer asks the database to do, how the screen
// moves after a round trip. Every sentence is plain English; "pledge" never "bid"; a household is never shown by its name alone.

import { formatCents } from "@/lib/money";

import type { AnswerCode } from "./exceptions";
import { text } from "./strings";
import type { CardRecord, GroupStatus, InboxGroup, InboxView, ItemDetail, Progress } from "./views";

// ---------------------------------------------------------------------------
// Which question is in front
// ---------------------------------------------------------------------------

/** A question still to do: open or put off for later, with something left to answer. */
export function isToDo(g: InboxGroup): boolean {
  return (g.status === "open" || g.status === "postponed") && g.openItems > 0;
}

/**
 * The question to show. The one the person picked, if it can still be worked on (a question put off, skipped or passed on can be
 * picked again); otherwise the first open one by rank (money first), then the first put off. Nothing when there is nothing to do.
 */
export function currentGroup(view: InboxView, selectedId: string | null = null): InboxGroup | null {
  if (selectedId) {
    const picked = view.groups.find((g) => g.id === selectedId);
    if (picked && picked.openItems > 0 && picked.status !== "answered") return picked;
  }
  const sorted = [...view.groups].sort((a, b) => a.rank - b.rank);
  return sorted.find((g) => g.status === "open" && g.openItems > 0) ?? sorted.find((g) => g.status === "postponed" && g.openItems > 0) ?? null;
}

const STATUS_LABEL: Record<GroupStatus, string> = {
  open: "To do",
  answered: "Answered",
  postponed: "Later",
  skipped: "Skipped",
  sent: "Passed on",
};

export function statusLabel(status: GroupStatus): string {
  return STATUS_LABEL[status];
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

/** The answer that is selected before the person touches anything: the one Weaver recommends. */
export function defaultPick(group: InboxGroup): AnswerCode {
  const codes = group.question.answers.map((a) => a.code);
  return codes.includes(group.recommended) ? group.recommended : (codes[0] ?? group.recommended);
}

/** "Use the same answer for the other 13", or null when there is no other item or one answer cannot serve the rest. */
export function sameForRestLabel(group: InboxGroup): string | null {
  const others = group.openItems - 1;
  if (!group.sameForRest || others < 1) return null;
  return text("q.same_for_rest", "en", { n: others });
}

/** Why one answer cannot be used for the rest, when there are others and the answer is held to one item at a time. */
export function noBulkReason(group: InboxGroup): string | null {
  if (group.sameForRest || group.openItems < 2) return null;
  if (group.signature === "minor_record") return "Rows about children are answered one at a time.";
  return group.money ? text("q.same_for_rest.no_hold") : "Each of these needs its own answer.";
}

/** One line about whether the answer is remembered. */
export function rememberNote(group: InboxGroup): string {
  if (group.rememberable) return "Weaver remembers this answer, so you are not asked the same thing again.";
  if (group.signature === "name_only") return "This answer is not remembered: a name alone is never enough to join two records, so Weaver asks again next time.";
  return text("q.not_remembered_hold");
}

/** Who is best placed to answer, as one sentence (the helper link that sends it there comes later). */
export function routeHint(group: InboxGroup): string | null {
  if (group.routeSuggested === "treasurer") return "The treasurer is best placed to answer this one.";
  if (group.routeSuggested === "membership") return "The membership coordinator is best placed to answer this one.";
  return null;
}

export type AnswerRequest = {
  groupId: string;
  answer: AnswerCode;
  /** The item shown, so a second tab or a slow click cannot answer another one. */
  itemId: string;
  applyToRest: boolean;
  /**
   * With "the same answer for the other N": the N on the button. The database refuses when the number it would answer is not this
   * one (someone else answered in the meantime), so the label the person read is the number of rows that change.
   */
  expectedOthers: number | null;
  remember: boolean;
};

export type AnswerScope = "one" | "rest";

/**
 * What an answer asks the database to do, or the sentence that says why it cannot be asked. "Same answer for the other N" is only
 * offered where the kind of question allows it (never for money), and only when there is another open item.
 */
export function answerRequestFor(group: InboxGroup, pick: AnswerCode | null, scope: AnswerScope): { ok: true; request: AnswerRequest } | { ok: false; error: string } {
  if (group.status === "answered") return { ok: false, error: "This question is already answered." };
  if (!group.nextItemId || group.openItems < 1) return { ok: false, error: "Every item in this question already has an answer." };
  if (!pick || !group.question.answers.some((a) => a.code === pick)) return { ok: false, error: "Choose one of the answers first." };
  if (scope === "rest") {
    if (!group.sameForRest) return { ok: false, error: noBulkReason(group) ?? "One answer cannot be used for the others in this question." };
    if (group.openItems < 2) return { ok: false, error: "There is nothing else in this question to use the same answer for." };
  }
  return {
    ok: true,
    request: {
      groupId: group.id,
      answer: pick,
      itemId: group.nextItemId,
      applyToRest: scope === "rest",
      expectedOthers: scope === "rest" ? group.openItems - 1 : null,
      remember: group.rememberable,
    },
  };
}

/** What a click on "Same answer for the other N" will change, in words, before it is made. */
export function applyToRestPreview(group: InboxGroup, pick: AnswerCode): string | null {
  const others = group.openItems - 1;
  if (!group.sameForRest || others < 1) return null;
  const answer = group.question.answers.find((a) => a.code === pick)?.label ?? "this answer";
  return `This answers ${others === 1 ? "the other one" : `the other ${others}`} the same way: ${answer}.`;
}

// ---------------------------------------------------------------------------
// The numbers at the top
// ---------------------------------------------------------------------------

export type ProgressText = {
  headline: string;
  minutes: string;
  /** 0..1: the share of the questions that are no longer waiting for the person. */
  fraction: number;
  left: number;
  total: number;
};

export function progressText(p: Progress | null): ProgressText {
  if (!p) return { headline: "No questions yet", minutes: "", fraction: 0, left: 0, total: 0 };
  const left = p.questionsLeft;
  const total = p.groupsTotal;
  const minutes =
    left === 0 ? "" : p.minutesLeft < 1 ? "less than a minute" : `about ${Math.ceil(p.minutesLeft)} minute${Math.ceil(p.minutesLeft) === 1 ? "" : "s"}`;
  return {
    headline: total === 0 ? "Nothing to ask" : left === 0 ? "No questions left" : left === 1 ? "1 question left" : `${left} questions left`,
    minutes,
    fraction: total === 0 ? 1 : Math.min(1, Math.max(0, (total - left) / total)),
    left,
    total,
  };
}

export type MetricTile = { label: string; value: string; hint: string; tone: "navy" | "success" | "saffron" | "danger" };

const num = (n: number) => n.toLocaleString("en-US");

/** The four tiles: how much Weaver decided by itself, what the questions cost, the time, and what is held for a person. */
export function metricTiles(view: Pick<InboxView, "metrics" | "recordCount">): MetricTile[] {
  const m = view.metrics;
  if (!m) return [];
  const auto = Math.round(m.autoShare * 100);
  const learned = m.learned > 0 ? `, and ${num(m.learned)} more from answers you gave before` : "";
  return [
    { label: "Resolved automatically", value: `${auto}%`, hint: `${num(m.auto)} of ${num(m.rows)} rows${learned}`, tone: auto >= 75 ? "success" : "saffron" },
    {
      label: "Questions per 1,000 rows",
      value: String(m.questionsPer1000),
      hint: m.withinQuestionTarget ? `${num(m.questions)} questions, within the target of ${m.questionTarget}` : `${num(m.questions)} questions; the target is ${m.questionTarget}`,
      tone: m.withinQuestionTarget ? "success" : "saffron",
    },
    {
      label: "Minutes of your time",
      value: m.minutes < 1 ? "<1" : String(Math.round(m.minutes)),
      hint: m.withinMinuteTarget ? "an estimate, within the target" : "an estimate; the target is under 10 per 1,000 rows",
      tone: m.withinMinuteTarget ? "success" : "saffron",
    },
    { label: "Held for a person", value: num(m.held), hint: m.held === 0 ? "nothing held" : "children and gifts are never decided by software", tone: m.held === 0 ? "success" : "navy" },
  ];
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

const ID_LABEL: Record<string, string> = {
  household_number: "Household number",
  household_legacy: "Household ID in the old system",
  household_crm: "Household ID in the old CRM",
  household_ref: "Household reference",
  person_connect: "Member number",
  person_crm: "Person ID in the old CRM",
  person_legacy: "Person ID in the old system",
  person_ref: "Person reference",
};

export function idLabel(system: string): string {
  const known = ID_LABEL[system];
  if (known) return known;
  const words = system.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "ID";
}

const last4 = (v: string): string => v.replace(/\D/g, "").slice(-4);

/** e-mail with only its first letter and its domain showing: enough to tell two apart, not enough to read out. */
export function maskEmail(e: string): string {
  return e.replace(/^(.).*(@.*)$/, "$1***$2");
}

export type CardView = {
  /** The heading: a name, or for a held row only where it is. */
  heading: string;
  kind: string;
  /** Facts that tell one household or person from another: address, phone, e-mail. */
  lines: string[];
  /** Identifiers, written out ("Household number 0417"). */
  ids: string[];
  /** Where the row is from. */
  origin: string;
  /** A child's row: details are withheld. */
  held: boolean;
  /** Already in the records (not a row of the file). */
  inRecords: boolean;
};

function addressLine(c: NonNullable<CardRecord["card"]>): string | null {
  const street = [c.address1, c.address2].filter(Boolean).join(", ");
  const place = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
  const line = [street, place].filter(Boolean).join(", ");
  return line || null;
}

function giftLine(g: NonNullable<NonNullable<CardRecord["card"]>["gift"]>): string | null {
  const n = g.amount === null ? NaN : Number(g.amount);
  const amount = Number.isFinite(n) ? formatCents(Math.round(n * 100)) : null;
  const bits = [amount, g.date ? `on ${g.date}` : null].filter(Boolean);
  return bits.length > 0 ? bits.join(" ") : null;
}

const KIND_LABEL: Record<string, string> = { person: "Person", household: "Household", gift: "Gift", unknown: "Kind not clear" };

/** What one card says. A child's row says only that it is held; everything else says enough to tell two households apart. */
export function cardView(r: CardRecord): CardView {
  const inRecords = r.sourceKind === "existing";
  const origin = inRecords ? "Already in your records" : `Row ${r.rowNo} of ${r.source}`;
  if (r.minor || !r.card) {
    return { heading: `Row ${r.rowNo} of ${r.source}`, kind: "About a child", lines: ["Details are withheld. Children are never matched by software; a person adds them with their family."], ids: [], origin, held: true, inRecords: false };
  }
  const c = r.card;
  const name = c.name ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null);
  const lines: string[] = [];
  const address = addressLine(c);
  if (address) lines.push(address);
  const phones = [...new Set([c.mobile, c.phone, c.phone2].filter((p): p is string => !!p).map(last4).filter(Boolean))];
  for (const p of phones) lines.push(`Phone ending ${p}`);
  for (const e of [c.email, c.email2].filter((x): x is string => !!x)) lines.push(`E-mail ${maskEmail(e)}`);
  if (c.gift) {
    const g = giftLine(c.gift);
    if (g) lines.push(g);
    if (c.gift.ref) lines.push(`Check or reference ${c.gift.ref}`);
  }
  const ids = Object.entries(c.ids).map(([system, value]) => `${idLabel(system)} ${value}`);
  if (c.existingNumber && !Object.keys(c.ids).includes("household_number")) ids.push(`Household number ${c.existingNumber}`);
  return { heading: name ?? "No name on this row", kind: KIND_LABEL[r.kind] ?? "Record", lines, ids, origin, held: false, inRecords };
}

export type EvidenceView = { agree: string[]; differ: string[]; summary: string };

/** What agrees and what does not, from the evidence of the pair. */
export function evidenceView(detail: Pick<ItemDetail, "evidence" | "conflicts">): EvidenceView {
  const agree = [...new Set(detail.evidence.map((e) => e.label).filter(Boolean))];
  const differ = [...new Set(detail.conflicts.map((c) => c.label).filter(Boolean))];
  const summary =
    agree.length === 0 && differ.length === 0
      ? ""
      : [agree.length > 0 ? `Agrees: ${agree.join("; ")}.` : "Nothing but the name agrees.", differ.length > 0 ? `Differs: ${differ.join("; ")}.` : ""].filter(Boolean).join(" ");
  return { agree, differ, summary };
}

// ---------------------------------------------------------------------------
// How the screen moves
// ---------------------------------------------------------------------------

export type Busy = null | "load" | "answer" | "rest" | "later" | "skip" | "reopen";

export type InboxState = {
  view: InboxView;
  /** The question the person picked from the list, if any. */
  selectedGroupId: string | null;
  /** The answer selected for the item in front. */
  pick: AnswerCode | null;
  /** The item the pick belongs to: a new item resets the pick to the recommended answer. */
  pickFor: string | null;
  busy: Busy;
  /** Shown next to what the person did. */
  error: string | null;
};

export type InboxAction =
  | { type: "view"; view: InboxView }
  | { type: "select"; groupId: string }
  | { type: "pick"; code: AnswerCode }
  | { type: "busy"; busy: Busy }
  | { type: "error"; error: string | null };

export function initialState(view: InboxView): InboxState {
  const g = currentGroup(view);
  return { view, selectedGroupId: null, pick: g ? defaultPick(g) : null, pickFor: g?.nextItemId ?? null, busy: null, error: null };
}

/** The group in front for a state. */
export function frontGroup(state: InboxState): InboxGroup | null {
  return currentGroup(state.view, state.selectedGroupId);
}

export function inboxReducer(state: InboxState, action: InboxAction): InboxState {
  switch (action.type) {
    case "view": {
      // New truth from the server. Keep the picked question while it can still be worked on; reset the answer when the item changes.
      const keep = state.selectedGroupId && currentGroup(action.view, state.selectedGroupId)?.id === state.selectedGroupId ? state.selectedGroupId : null;
      const front = currentGroup(action.view, keep);
      const sameItem = front?.nextItemId != null && front.nextItemId === state.pickFor;
      return {
        view: action.view,
        selectedGroupId: keep,
        pick: sameItem ? state.pick : front ? defaultPick(front) : null,
        pickFor: front?.nextItemId ?? null,
        busy: null,
        error: null,
      };
    }
    case "select": {
      const front = currentGroup(state.view, action.groupId);
      if (!front) return state;
      return { ...state, selectedGroupId: front.id, pick: defaultPick(front), pickFor: front.nextItemId, error: null };
    }
    case "pick":
      return { ...state, pick: action.code, error: null };
    case "busy":
      return { ...state, busy: action.busy, error: action.busy ? null : state.error };
    case "error":
      return { ...state, busy: null, error: action.error };
  }
}
