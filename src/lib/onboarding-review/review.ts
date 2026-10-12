// "Review before anything is saved": board 3 of docs/handoff/prototypes/onboarding-data/Review.dc.html, as a model the screen
// draws. Pure: the page (real data from a stored matching run, 0630-0632) and the dev preview (invented data) both build it here.
//
// Three rules hold for everything this file returns:
//  - money is integer cents, and every cent found in the files is accounted for in exactly one place (or the difference is
//    named as not explained: never hidden);
//  - a household or person is never shown by a name alone: each card carries where it came from, its numbers and what tells it
//    apart;
//  - nothing about a child leaves this file. A child's record is never opened: its card says only that it is held for a person
//    (D2). The model is what the screen (and its browser half) receives, so a child's name must never be in it.

import { moneyIn, numberIn, type CommunityFormat } from "@/lib/community-format";
import type { AnswerCode } from "@/lib/onboarding/resolve/exceptions";
import { evidenceView, idLabel, maskEmail } from "@/lib/onboarding/resolve/inbox";
import type { CardRecord, InboxGroup, InboxView, ItemDetail, RunRow } from "@/lib/onboarding/resolve/views";
import type { PatternSignature } from "@/lib/onboarding/resolve/types";

/** The pill colors the screen has (the front door's Pill tones). */
export type ReviewTone = "green" | "blue" | "sun" | "grey" | "danger";

// ---------------------------------------------------------------------------- Totals, to the cent

/** One payment row of the run as the database keeps it: what happens to it, and its amount once read. */
export type GiftRow = {
  /** auto · bulk · asked · held · learned (null: the engine gave it no outcome). */
  status: string | null;
  /** linked · new · duplicate_gift · review · question · hold · rule. */
  how: string | null;
  minor: boolean;
  /** The amount in cents, or null when it could not be read (or is no longer kept). */
  cents: number | null;
  /** Why the amount could not be read: blank, unreadable, zero, negative. Null with no cents: the amount is no longer kept. */
  problem: string | null;
};

export type Tally = { count: number; cents: number };

export type GiftTotals = {
  /** Every payment in the files with an amount Weaver can read, each row once (second copies included). */
  files: Tally;
  /** What Weaver would hold: decided by code (linked or new) or by an answer you gave before. */
  hold: Tally;
  /** The second copy of a payment found in two files: loaded once, so this copy is skipped. */
  duplicates: Tally;
  /** Waiting for a person: a question, an "approve all" review, or a row held for a person to add (a child's, a money conflict). */
  waiting: Tally;
  /** Readable rows with no outcome. Should be none; if any, the totals do not agree and the screen says so. */
  unaccounted: Tally;
  /** Rows whose amount cannot be read (blank, zero, not a number). Not added up anywhere. */
  unreadable: number;
  /** Rows whose amount is no longer kept (cleared 90 days after an import). */
  notKept: number;
};

const LOADED = new Set(["auto", "learned"]);
const WAITING = new Set(["asked", "bulk", "held"]);

const zero = (): Tally => ({ count: 0, cents: 0 });
const add = (t: Tally, cents: number) => {
  t.count += 1;
  t.cents += cents;
};

/** Puts every payment row in exactly one place. Integer cents only: an amount that is not a whole number of cents is unreadable. */
export function reconcileGifts(rows: readonly GiftRow[]): GiftTotals {
  const t: GiftTotals = { files: zero(), hold: zero(), duplicates: zero(), waiting: zero(), unaccounted: zero(), unreadable: 0, notKept: 0 };
  for (const r of rows) {
    if (r.cents === null || !Number.isSafeInteger(r.cents)) {
      if (r.cents === null && r.problem === null) t.notKept += 1;
      else t.unreadable += 1;
      continue;
    }
    add(t.files, r.cents);
    if (r.how === "duplicate_gift") add(t.duplicates, r.cents);
    else if (r.minor || (r.status !== null && WAITING.has(r.status))) add(t.waiting, r.cents);
    else if (r.status !== null && LOADED.has(r.status)) add(t.hold, r.cents);
    else add(t.unaccounted, r.cents);
  }
  return t;
}

/** One reason part of a difference: how much, and what it is ("the second copy of 12 payments found in two files"). */
export type MoneyPart = { cents: number; text: string };

export type Explained = {
  kind: "match" | "explained" | "unexplained";
  differenceCents: number;
  /** What the parts do not cover (0 unless kind is "unexplained"). */
  remainderCents: number;
  /** One plain sentence, or "" when the totals match. */
  sentence: string;
};

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Compares what was found with what would be held and explains the difference with the parts given, to the cent. Parts of
 * zero are left out. When the parts do not add up to the difference, the rest is named as not accounted for: never rounded
 * away, never hidden.
 */
export function explainDifference(foundCents: number, holdCents: number, parts: readonly MoneyPart[], money: (cents: number) => string): Explained {
  const differenceCents = foundCents - holdCents;
  if (differenceCents === 0 && parts.every((p) => p.cents === 0)) return { kind: "match", differenceCents: 0, remainderCents: 0, sentence: "" };
  const used = parts.filter((p) => p.cents !== 0);
  const covered = used.reduce((n, p) => n + p.cents, 0);
  const remainderCents = differenceCents - covered;
  const said = used.map((p) => `${money(p.cents)} is ${p.text}`);
  if (remainderCents === 0) {
    return { kind: "explained", differenceCents, remainderCents: 0, sentence: `The difference of ${money(differenceCents)} is explained: ${listWords(said)}.` };
  }
  const rest = `${money(remainderCents)} is not accounted for`;
  return {
    kind: "unexplained",
    differenceCents,
    remainderCents,
    sentence: `The difference of ${money(differenceCents)} is not fully explained: ${listWords([...said, rest])}. Nothing will be loaded until it is.`,
  };
}

export type ReconRow = { title: string; body: string; tag: string; tone: ReviewTone };

export type TotalsState =
  | { state: "rows"; rows: GiftRow[]; capped: boolean }
  | { state: "none" }
  | { state: "error"; error: string };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The rows of the totals check, in the board's order: the whole, what appears twice, what waits, what cannot be read. */
export function totalsRows(state: TotalsState, fmt: CommunityFormat, opts: { accounting: boolean }): ReconRow[] {
  const n = (x: number) => numberIn(x, fmt.locale);
  const money = (c: number) => moneyIn(c, fmt);
  const accountingRow: ReconRow[] = opts.accounting
    ? [{ title: "Your accounting deposits", body: "Comparing these payments with the deposits in your accounting system, to the cent, is coming next.", tag: "Coming next", tone: "grey" }]
    : [];
  if (state.state === "error") return [{ title: "All payments in your files", body: state.error, tag: "Could not add up", tone: "danger" }];
  if (state.state === "none") {
    return [{ title: "No payments in this file", body: "This file has no payments, so there are no totals to add up. Totals are checked to the cent when you bring payments in.", tag: "Nothing to add up", tone: "grey" }];
  }
  if (state.capped) {
    return [{ title: "All payments in your files", body: "This file has too many payments to add up on this page. Settings › Data import adds them up, to the cent, when the file is loaded.", tag: "Not added up here", tone: "grey" }];
  }
  const t = reconcileGifts(state.rows);
  const parts: MoneyPart[] = [
    { cents: t.duplicates.cents, text: `the second copy of ${n(t.duplicates.count)} ${plural(t.duplicates.count, "payment", "payments")} found in two places` },
    { cents: t.waiting.cents, text: `${n(t.waiting.count)} ${plural(t.waiting.count, "payment", "payments")} waiting for a person` },
  ];
  const ex = explainDifference(t.files.cents, t.hold.cents, parts, money);
  const rows: ReconRow[] = [
    {
      title: "All payments in your files",
      body: [
        `Your files add up to ${money(t.files.cents)} across ${n(t.files.count)} ${plural(t.files.count, "payment", "payments")}. Weaver would hold ${money(t.hold.cents)} across ${n(t.hold.count)}.`,
        ex.sentence,
      ]
        .filter(Boolean)
        .join(" "),
      tag: ex.kind === "match" ? "Matches to the cent" : ex.kind === "explained" ? "Explained" : "Not explained",
      tone: ex.kind === "match" ? "green" : ex.kind === "explained" ? "blue" : "danger",
    },
    t.duplicates.count > 0
      ? {
          title: "Payments found in two places",
          body: `${n(t.duplicates.count)} ${plural(t.duplicates.count, "payment appears", "payments appear")} twice (same household, date and amount), ${money(t.duplicates.cents)} in all. Each is loaded once, so nothing is counted twice.`,
          tag: "Loaded once",
          tone: "blue",
        }
      : { title: "Payments found in two places", body: "No payment appears twice, so nothing had to be set aside.", tag: "Nothing doubled", tone: "green" },
    t.waiting.count > 0
      ? {
          title: "Payments waiting for a person",
          body: `${n(t.waiting.count)} ${plural(t.waiting.count, "payment", "payments")} totalling ${money(t.waiting.cents)} wait for an answer, or for a person to add them by hand. They are not in what Weaver would hold until then.`,
          tag: "Needs a look",
          tone: "sun",
        }
      : { title: "Payments waiting for a person", body: "Every payment has an outcome: nothing waits for a person.", tag: "Nothing waiting", tone: "green" },
  ];
  if (t.unreadable > 0) {
    rows.push({
      title: "Amounts that cannot be read",
      body: `${n(t.unreadable)} ${plural(t.unreadable, "payment has an amount", "payments have an amount")} Weaver cannot read (blank, zero or not a number), so ${plural(t.unreadable, "it is", "they are")} not added up. Fix ${plural(t.unreadable, "it", "them")} in the file and bring it in again.`,
      tag: "Needs a look",
      tone: "sun",
    });
  }
  if (t.notKept > 0) {
    rows.push({
      title: "Amounts no longer kept",
      body: `The amounts of ${n(t.notKept)} ${plural(t.notKept, "payment are", "payments are")} no longer kept: the rows of an import are cleared 90 days after it.`,
      tag: "Not kept",
      tone: "grey",
    });
  }
  return [...rows, ...accountingRow];
}

// ---------------------------------------------------------------------------- Household cards with their evidence

/** The questions about two households or two people, and the record held because it is a child's. Money and reading questions are elsewhere. */
const HOUSEHOLD_PAIRS: ReadonlySet<PatternSignature> = new Set<PatternSignature>([
  "spouse_maiden_name",
  "shared_phone_households",
  "address_unit_differs",
  "shared_email_households",
  "linked_through_another_record",
]);
const PERSON_PAIRS: ReadonlySet<PatternSignature> = new Set<PatternSignature>(["name_only", "birth_year_differs", "ids_differ", "id_name_differs"]);

export const CHILD_HELD = "A child's record is held for a person to decide.";

export function isCardSignature(s: PatternSignature): boolean {
  return HOUSEHOLD_PAIRS.has(s) || PERSON_PAIRS.has(s) || s === "minor_record";
}

/** The questions to show as cards: up to `max` open household and person pairs by value, then one held child's record. */
export function cardGroups(view: Pick<InboxView, "groups">, max = 3): InboxGroup[] {
  const open = view.groups.filter((g) => isCardSignature(g.signature) && g.nextItemId !== null && g.openItems > 0);
  const pairs = open.filter((g) => g.signature !== "minor_record").sort((a, b) => a.rank - b.rank);
  const held = open.filter((g) => g.signature === "minor_record");
  return [...pairs.slice(0, max), ...held.slice(0, 1)];
}

export type CardRow = { label: string; value: string; mono?: boolean };

export type CardSide = {
  /** Where it came from: "From members.csv, row 12" or "Already in your records". */
  from: string;
  /** The name as written, or for a child only "A child's record". */
  heading: string;
  rows: CardRow[];
  /** A child's record: nothing about it is shown. */
  held: boolean;
};

export type EvidenceTag = "Same" | "Similar" | "Agrees" | "Different" | "Differs" | "Note";
export type EvidenceItem = { tag: EvidenceTag; text: string; tone: "agree" | "differ" | "note" };

export type MatchPair = {
  itemId: string;
  groupId: string;
  /** "Are these the same household?" / "... person?" / "A child's record is held". */
  question: string;
  /** The question of the whole group, as the Questions screen words it. */
  groupTitle: string;
  sides: CardSide[];
  evidence: EvidenceItem[];
  suggestion: string;
  /** Others of the same kind still waiting (one answer on the Questions screen can cover them). */
  others: number;
  /** Phone, e-mail and address are not shown: the item is held (a child is in it, or money disagrees). */
  limited: boolean;
};

function address(c: NonNullable<CardRecord["card"]>): string | null {
  const street = [c.address1, c.address2].filter(Boolean).join(", ");
  const place = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
  return [street, place].filter(Boolean).join(", ") || null;
}

const lastDigits = (v: string): string => v.replace(/\D/g, "").slice(-4);

function paymentLine(g: NonNullable<NonNullable<CardRecord["card"]>["gift"]>, fmt: CommunityFormat): string | null {
  const n = g.amount === null ? NaN : Number(g.amount);
  const amount = Number.isFinite(n) ? moneyIn(Math.round(n * 100), fmt) : null;
  const bits = [amount, g.date ? `on ${g.date}` : null].filter(Boolean);
  return bits.length > 0 ? bits.join(" ") : null;
}

/** One record as a card side. A child's record says only that it is held: its card, if one came with it, is never read. */
export function cardSide(r: CardRecord, fmt: CommunityFormat): CardSide {
  const inRecords = r.sourceKind === "existing";
  if (r.minor || !r.card) {
    return { from: `From ${r.source}, row ${r.rowNo}`, heading: "A child's record", rows: [{ label: "Held", value: CHILD_HELD }], held: true };
  }
  const c = r.card;
  const rows: CardRow[] = [];
  for (const [system, value] of Object.entries(c.ids)) rows.push({ label: idLabel(system), value, mono: true });
  if (!("household_number" in c.ids)) rows.push({ label: "Household number", value: c.existingNumber ?? "Given when you confirm", mono: c.existingNumber !== null });
  const addr = address(c);
  if (addr) rows.push({ label: "Address", value: addr });
  const phones = [...new Set([c.mobile, c.phone, c.phone2].filter((p): p is string => !!p).map(lastDigits).filter(Boolean))];
  if (phones.length > 0) rows.push({ label: c.mobile ? "Mobile" : "Phone", value: phones.map((p) => `ending ${p}`).join(", "), mono: true });
  const emails = [c.email, c.email2].filter((x): x is string => !!x).map(maskEmail);
  if (emails.length > 0) rows.push({ label: "E-mail", value: emails.join(", "), mono: true });
  if (c.gift) {
    const p = paymentLine(c.gift, fmt);
    if (p) rows.push({ label: "Payment", value: p });
  }
  const name = c.name ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || null);
  return { from: inRecords ? "Already in your records" : `From ${r.source}, row ${r.rowNo}`, heading: name ?? "No name on this row", rows, held: false };
}

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** An engine label as a tagged line: "same mobile" reads Same · mobile, "different birth years" reads Different · birth years. */
export function evidenceItem(label: string, side: "agree" | "differ"): EvidenceItem {
  const l = label.trim();
  if (side === "agree") {
    if (/^same /i.test(l)) return { tag: "Same", text: l.replace(/^same /i, ""), tone: "agree" };
    if (/^similar /i.test(l)) return { tag: "Similar", text: l.replace(/^similar /i, ""), tone: "agree" };
    if (/ matches$/i.test(l)) return { tag: "Same", text: l.replace(/ matches$/i, ""), tone: "agree" };
    return { tag: "Agrees", text: l, tone: "agree" };
  }
  if (/^different /i.test(l)) return { tag: "Different", text: l.replace(/^different /i, ""), tone: "differ" };
  return { tag: "Differs", text: l, tone: "differ" };
}

function answerLabel(group: Pick<InboxGroup, "question" | "recommended">, code: AnswerCode): string | null {
  const answers = Array.isArray(group.question.answers) ? group.question.answers : [];
  return answers.find((a) => a.code === code)?.label ?? null;
}

/** One question as cards side by side with what agrees and what does not, and Weaver's suggestion. Adults only: a child's side is held. */
export function matchPair(detail: ItemDetail, group: Pick<InboxGroup, "id" | "signature" | "question" | "recommended" | "openItems">, fmt: CommunityFormat): MatchPair {
  const sides = detail.records.map((r) => cardSide(r, fmt));
  const child = sides.some((s) => s.held);
  const ev = evidenceView(detail);
  const evidence: EvidenceItem[] = child ? [] : [...ev.agree.map((l) => evidenceItem(l, "agree")), ...ev.differ.map((l) => evidenceItem(l, "differ"))];
  const independent = detail.evidence.some((e) => e.independent);
  if (!child && !independent) evidence.push({ tag: "Note", text: "Only the name agrees, and a name alone never links two households.", tone: "note" });
  if (child) evidence.push({ tag: "Note", text: "A child's record is never compared by software. A person adds children with their family.", tone: "note" });
  const question =
    group.signature === "minor_record" || child ? "A child's record is held" : PERSON_PAIRS.has(group.signature) ? "Are these the same person?" : "Are these the same household?";
  const label = answerLabel(group, group.recommended);
  const detailText = typeof group.question.detail === "string" ? group.question.detail.trim() : "";
  const suggestion = child
    ? "Leave it for a person: whoever adds the family adds the child with them. Nothing about a child is sent to an AI service."
    : [label ? `I suggest: ${label}.` : "", detailText].filter(Boolean).join(" ");
  return {
    itemId: detail.id,
    groupId: group.id,
    question,
    groupTitle: typeof group.question.title === "string" ? group.question.title : "",
    sides,
    evidence,
    suggestion,
    others: Math.max(0, group.openItems - 1),
    limited: detail.limited,
  };
}

// ---------------------------------------------------------------------------- Linked without a question (tier A)

/** One link the engine made by itself, as import_record_links keeps it. */
export type AutoLinkRaw = { a: string; b: string; relation: string; evidence: unknown };

/** A staged record as the auto-linked list reads it: who, and the numbers that tell it apart. Children's rows are never read. */
export type StagedName = {
  id: string;
  rowNo: number;
  source: string;
  sourceKind: string | null;
  minor: boolean;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  existingNumber: string | null;
  ids: Record<string, string>;
};

export type AutoLink = { key: string; who: string; why: string };

function evidenceLabels(json: unknown): { labels: string[]; independent: boolean } {
  const list = Array.isArray(json) ? json : [];
  const labels: string[] = [];
  let independent = false;
  for (const e of list) {
    if (e === null || typeof e !== "object") continue;
    const x = e as Record<string, unknown>;
    if (typeof x.label === "string" && x.label.trim()) labels.push(x.label.trim());
    if (x.independent === true) independent = true;
  }
  return { labels: [...new Set(labels)], independent };
}

function whoOf(r: StagedName | undefined): string {
  if (!r || r.minor) return "a child's record (held for a person to decide)";
  const name = r.name ?? ([r.firstName, r.lastName].filter(Boolean).join(" ") || "No name on this row");
  const ids = Object.entries(r.ids).map(([k, v]) => `${idLabel(k)} ${v}`);
  if (r.sourceKind === "existing") ids.unshift(r.existingNumber ? `household number ${r.existingNumber}, already in your records` : "already in your records");
  else ids.push(`row ${r.rowNo} of ${r.source}`);
  return `${name} (${ids.join(", ")})`;
}

/** The links Weaver made by itself, each with who and why. A link that touches a child's record (it should not happen) says so and nothing more. */
export function autoLinks(links: readonly AutoLinkRaw[], records: readonly StagedName[]): AutoLink[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return links.map((l) => {
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    const ev = evidenceLabels(l.evidence);
    const child = !a || !b || a.minor || b.minor;
    const why = child
      ? CHILD_HELD
      : ev.labels.length > 0
        ? `${capital(listWords(ev.labels))}.${ev.independent ? "" : " Only names agree, so a person should check this one."}`
        : "Linked by its numbers.";
    return { key: `${l.a}|${l.b}`, who: `${whoOf(a)} and ${whoOf(b)}`, why };
  });
}

// ---------------------------------------------------------------------------- The whole screen

export type ReviewTile = { value: string; label: string };

export type QuestionsSummary = {
  total: number;
  left: number;
  answered: number;
  /** Rows held for a person (children, money that disagrees). */
  held: number;
  minutes: number;
  href: string;
};

export type ConfirmSummary = {
  /** "Nothing is saved until you press Confirm. When you do, ..." */
  text: string;
  /** The import in Settings › Data import, where loading still happens today. */
  importHref: string;
};

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

export type ReviewReady = {
  state: "ready";
  runLabel: string;
  intro: string;
  tiles: ReviewTile[];
  totals: ReconRow[];
  pairsIntro: string;
  pairs: Section<MatchPair[]>;
  /** Children's records held for a person, said as a count only. */
  childrenHeld: number;
  autoCount: number;
  autoLinked: Section<AutoLink[]>;
  questions: QuestionsSummary;
  confirm: ConfirmSummary;
};

export type ReviewEmpty = {
  state: "empty";
  /** nothing: no file yet · unchecked: a file that has not been checked for matches · busy: a check is still being saved. */
  reason: "nothing" | "unchecked" | "busy";
  /** Where to go next. */
  href: string;
  runLabel: string | null;
};

export type ReviewError = { state: "error"; error: string; retryHref: string };
export type ReviewDenied = { state: "denied"; message: string };

export type ReviewModel = ReviewReady | ReviewEmpty | ReviewError | ReviewDenied;

export type ReviewLinks = { questions: string; frontDoor: string; dataImport: string };

export type ReviewInput = {
  run: RunRow;
  inbox: InboxView;
  /** The questions shown as cards (cardGroups), and the item of each, in the same order. */
  cards: Section<{ group: InboxGroup; detail: ItemDetail }[]>;
  gifts: TotalsState;
  auto: Section<{ count: number; links: AutoLinkRaw[]; records: StagedName[] }>;
  fmt: CommunityFormat;
  /** Whether the organization keeps an accounting system (the deposits comparison is shown as coming next). */
  accounting: boolean;
  links: ReviewLinks;
};

export const runTitle = (r: Pick<RunRow, "runNumber" | "fileName" | "entityLabel">) => `Import #${r.runNumber} · ${r.fileName ?? r.entityLabel}`;

/** The screen for a run whose matching result is ready. */
export function buildReview(input: ReviewInput): ReviewReady {
  const { run, inbox, fmt } = input;
  const n = (x: number) => numberIn(x, fmt.locale);
  const m = inbox.metrics;
  const p = inbox.progress;
  const runLabel = runTitle(run);
  const rows = m?.rows ?? inbox.recordCount;
  const gifts = input.gifts.state === "rows" && !input.gifts.capped ? reconcileGifts(input.gifts.rows) : null;

  const tiles: ReviewTile[] = [
    { value: n(m?.newRecords ?? 0), label: `${plural(m?.newRecords ?? 0, "row", "rows")} to add as new records` },
    { value: n(m?.linkedAutomatically ?? 0), label: "linked to a match without a question" },
  ];
  if (gifts) tiles.push({ value: n(gifts.hold.count), label: `${plural(gifts.hold.count, "payment", "payments")} to load, ${moneyIn(gifts.hold.cents, fmt)}` });
  tiles.push({ value: n(m?.held ?? 0), label: "held for a person to decide" });
  tiles.push({ value: n(m?.duplicateGiftsSkipped ?? 0), label: "duplicates inside the files, skipped" });

  const cardGroupsShown = cardGroups(inbox);
  const pairQuestions = inbox.groups.filter((g) => isCardSignature(g.signature) && g.signature !== "minor_record");
  const pairsOpen = pairQuestions.reduce((k, g) => k + g.openItems, 0);
  const childrenHeld = inbox.groups.filter((g) => g.signature === "minor_record").reduce((k, g) => k + g.itemCount, 0);
  const pairsIntro =
    pairsOpen > 0
      ? `I link households only when more than a name agrees. For ${n(pairsOpen)} ${plural(pairsOpen, "pair", "pairs")} the evidence disagrees, so I am asking you. A name alone never joins two families, and I compare adults only.`
      : cardGroupsShown.length > 0
        ? "Every pair I found agreed on more than a name. What is left is held for a person: a child's record is never matched by software."
        : "Every pair I found agreed on more than a name, so I have nothing to ask about households. A name alone never joins two families, and I compare adults only.";

  const pairs: Section<MatchPair[]> = input.cards.ok ? { ok: true, data: input.cards.data.map((c) => matchPair(c.detail, c.group, fmt)) } : input.cards;
  const autoLinked: Section<AutoLink[]> = input.auto.ok ? { ok: true, data: autoLinks(input.auto.data.links, input.auto.data.records) } : input.auto;
  const autoCount = input.auto.ok ? input.auto.data.count : (m?.pairsByTier?.A ?? 0);

  const questions: QuestionsSummary = {
    total: p?.groupsTotal ?? inbox.groups.length,
    left: p?.questionsLeft ?? 0,
    answered: p?.groupsAnswered ?? 0,
    held: m?.held ?? 0,
    minutes: p?.minutesLeft ?? 0,
    href: input.links.questions,
  };

  const will = [
    m ? `adds ${n(m.newRecords)} new ${plural(m.newRecords, "record", "records")}` : null,
    m ? `links ${n(m.linkedAutomatically)} ${plural(m.linkedAutomatically, "row", "rows")} to the matches above` : null,
    gifts ? `loads ${n(gifts.hold.count)} ${plural(gifts.hold.count, "payment", "payments")} (${moneyIn(gifts.hold.cents, fmt)})` : null,
  ].filter((x): x is string => x !== null);
  const confirm: ConfirmSummary = {
    text: `Nothing is saved until you press Confirm. When you do, Weaver ${will.length > 0 ? listWords(will) : "loads this file"}, as one numbered import you can undo for 30 days: rows it created are removed and rows it changed go back.`,
    importHref: input.links.dataImport,
  };

  return {
    state: "ready",
    runLabel,
    intro: `I checked ${runLabel}: ${n(rows)} ${plural(rows, "row", "rows")}, compared with each other and with the records you already have. Nothing is in Weaver yet. This is exactly what will happen when you confirm.`,
    tiles,
    totals: totalsRows(input.gifts, fmt, { accounting: input.accounting }),
    pairsIntro,
    pairs,
    childrenHeld,
    autoCount,
    autoLinked,
    questions,
    confirm,
  };
}

/** Imports that can still be checked: nothing has been added from them yet. */
export const WORKABLE_RUN = new Set(["pending", "staged", "previewed"]);

export type RunChoice = { kind: "ready"; run: RunRow } | { kind: "empty"; reason: ReviewEmpty["reason"]; run: RunRow | null };

/** The import to review: the one asked for when it is ready, else the newest whose check is ready; else why there is none. */
export function chooseRun(runs: readonly RunRow[], wanted: string | null = null): RunChoice {
  const open = runs.filter((r) => WORKABLE_RUN.has(r.status));
  const ready = open.filter((r) => r.result === "ready");
  const pick = (wanted ? ready.find((r) => r.id === wanted) : undefined) ?? ready[0];
  if (pick) return { kind: "ready", run: pick };
  const busy = open.find((r) => r.result === "storing");
  if (busy) return { kind: "empty", reason: "busy", run: busy };
  if (open[0]) return { kind: "empty", reason: "unchecked", run: open[0] };
  return { kind: "empty", reason: "nothing", run: null };
}

export function emptyReview(choice: Extract<RunChoice, { kind: "empty" }>, links: Pick<ReviewLinks, "frontDoor"> & { questionsFor: (runId: string) => string }): ReviewEmpty {
  return {
    state: "empty",
    reason: choice.reason,
    href: choice.run ? links.questionsFor(choice.run.id) : links.frontDoor,
    runLabel: choice.run ? runTitle(choice.run) : null,
  };
}
