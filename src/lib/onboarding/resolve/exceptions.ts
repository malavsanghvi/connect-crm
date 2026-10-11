// The exceptions inbox, as data. Tier C and D items are grouped by PATTERN SIGNATURE ("spouse listed under a maiden name",
// "same phone shared by several households"...), ranked by value (money first, then members, then contacts), and each group
// becomes ONE plain-English question with a recommended answer and a "same answer for the other N" choice.
// Code decides what to ask and how to word it; the person confirms. Tier D groups are held: never remembered, and (for money)
// never answered in bulk.

import { formatCents } from "@/lib/money";

import type { ResolveConfig } from "./config";
import { pairKey } from "./link";
import { text, type Locale, type StringKey } from "./strings";
import { holdForRecord, isLowConfidence, subjectOf } from "./tier";
import type { ClassifiedPair, ConflictKind, EvidenceKind, NormalizedRecord, PatternSignature, Tier } from "./types";

export type AnswerCode =
  | "same_household"
  | "same_person"
  | "separate"
  | "same_gift"
  | "different_gifts"
  | "use_first"
  | "use_second"
  | "hold"
  | "person_will_add"
  | "ignore_row"
  | "is_person"
  | "is_household"
  | "confirm_read"
  | "fix_in_source";

/** How widely a remembered answer applies to later items (memory.ts). */
export type RuleScope = "exact_pair" | "identifier" | "pattern";

export type SignatureSpec = {
  tier: "C" | "D";
  /** The first answer is the recommended one. At most three. */
  answers: readonly AnswerCode[];
  rememberable: boolean;
  defaultScope: RuleScope;
  /** Who is best placed to answer (a helper link goes to them). */
  routeTo: "treasurer" | "membership" | null;
  money: boolean;
  /** A person may use one answer for the rest of the group. */
  sameForRest: boolean;
};

export const SIGNATURES: Record<PatternSignature, SignatureSpec> = {
  spouse_maiden_name: { tier: "C", answers: ["same_household", "separate"], rememberable: true, defaultScope: "pattern", routeTo: "membership", money: false, sameForRest: true },
  shared_phone_households: { tier: "C", answers: ["separate", "same_household"], rememberable: true, defaultScope: "identifier", routeTo: "membership", money: false, sameForRest: true },
  address_unit_differs: { tier: "C", answers: ["separate", "same_household"], rememberable: true, defaultScope: "identifier", routeTo: "membership", money: false, sameForRest: true },
  shared_email_households: { tier: "C", answers: ["separate", "same_household"], rememberable: true, defaultScope: "identifier", routeTo: "membership", money: false, sameForRest: true },
  name_only: { tier: "C", answers: ["separate", "same_person"], rememberable: true, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  birth_year_differs: { tier: "C", answers: ["separate", "same_person"], rememberable: true, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  ids_differ: { tier: "C", answers: ["separate", "same_person"], rememberable: true, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  id_name_differs: { tier: "C", answers: ["same_person", "separate"], rememberable: true, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  duplicate_gift_two_sources: { tier: "C", answers: ["same_gift", "different_gifts"], rememberable: true, defaultScope: "exact_pair", routeTo: "treasurer", money: true, sameForRest: true },
  low_confidence_read: { tier: "C", answers: ["confirm_read", "ignore_row"], rememberable: false, defaultScope: "exact_pair", routeTo: null, money: false, sameForRest: false },
  linked_through_another_record: { tier: "C", answers: ["separate", "same_household"], rememberable: true, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  amount_differs_cents: { tier: "D", answers: ["hold", "use_first", "use_second"], rememberable: false, defaultScope: "exact_pair", routeTo: "treasurer", money: true, sameForRest: false },
  amount_differs: { tier: "D", answers: ["hold", "use_first", "use_second"], rememberable: false, defaultScope: "exact_pair", routeTo: "treasurer", money: true, sameForRest: false },
  minor_record: { tier: "D", answers: ["person_will_add", "ignore_row"], rememberable: false, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  uncertain_type: { tier: "D", answers: ["is_person", "is_household", "ignore_row"], rememberable: false, defaultScope: "exact_pair", routeTo: "membership", money: false, sameForRest: true },
  unreadable_money: { tier: "D", answers: ["fix_in_source", "ignore_row"], rememberable: false, defaultScope: "exact_pair", routeTo: "treasurer", money: true, sameForRest: false },
};

// ---------------------------------------------------------------------------
// Items: one per candidate pair (or per record) that needs a person
// ---------------------------------------------------------------------------

export type SharedIdentifiers = { phone: string | null; email: string | null; address: string | null; id: string | null };

export type ExceptionItem = {
  /** Stable across runs: the signature plus content hashes of the two records, so the same pair is recognised again. */
  key: string;
  kind: "pair" | "record";
  signature: PatternSignature;
  tier: "C" | "D";
  /** The record the question is about (the one that arrived later). */
  subject: string;
  recordIds: string[];
  /** For a pair: the two content hashes in a fixed order. */
  fingerprints: string[];
  evidenceKinds: EvidenceKind[];
  conflictKinds: ConflictKind[];
  shared: SharedIdentifiers;
  moneyCents: number;
  members: number;
  contacts: number;
};

function sharedOf(a: NormalizedRecord, b: NormalizedRecord): SharedIdentifiers {
  const phone = a.phones.find((p) => b.phones.some((q) => q.value === p.value))?.value ?? null;
  const email = a.emails.find((e) => b.emails.includes(e)) ?? null;
  const address = a.address?.streetKey && a.address.streetKey === b.address?.streetKey ? a.address.streetKey : null;
  let id: string | null = null;
  for (const [system, value] of Object.entries(a.ids)) if (b.ids[system] === value) id = `${system}:${value}`;
  return { phone, email, address, id };
}

function contactsOf(records: readonly NormalizedRecord[]): number {
  const set = new Set<string>();
  for (const r of records) {
    for (const p of r.phones) set.add(`p:${p.value}`);
    for (const e of r.emails) set.add(`e:${e}`);
  }
  return set.size;
}

function membersOf(records: readonly NormalizedRecord[]): number {
  return new Set(records.filter((r) => r.kind === "person" || r.kind === "household").map((r) => r.id)).size;
}

function giftCents(records: readonly NormalizedRecord[]): number {
  let best = 0;
  for (const r of records) if (r.gift && r.gift.cents !== null && r.gift.cents > best) best = r.gift.cents;
  return best;
}

/** The stable key of the item a pair becomes (null when it is not an exception). */
export function pairItemKey(p: ClassifiedPair, a: NormalizedRecord, b: NormalizedRecord): string | null {
  if (p.signature === null) return null;
  const fps = [a.fingerprint, b.fingerprint].sort();
  return `${p.signature}:${pairKey(fps[0], fps[1])}`;
}

/** The items that need a person: tier C pairs, tier D money conflicts, and records held on their own. */
export function buildItems(pairs: readonly ClassifiedPair[], records: readonly NormalizedRecord[], cfg: ResolveConfig): ExceptionItem[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const items: ExceptionItem[] = [];

  for (const p of pairs) {
    if (p.signature === null) continue;
    if (p.tier === "A" || p.tier === "B" || p.implied) continue;
    // Holds and low-confidence reads belong to a record, not to the pair: they are itemised below.
    if (p.hold === "minor" || p.hold === "uncertain_type" || p.hold === "unreadable_money" || p.signature === "low_confidence_read") continue;
    const a = byId.get(p.a)!;
    const b = byId.get(p.b)!;
    const fps = [a.fingerprint, b.fingerprint].sort();
    const recs = [a, b];
    items.push({
      key: pairItemKey(p, a, b)!,
      kind: "pair",
      signature: p.signature,
      tier: p.tier === "D" ? "D" : "C",
      subject: subjectOf(a, b).id,
      recordIds: [a.id, b.id],
      fingerprints: fps,
      evidenceKinds: [...new Set(p.evidence.map((e) => e.kind))].sort(),
      conflictKinds: [...new Set(p.conflicts.map((c) => c.kind))].sort(),
      shared: sharedOf(a, b),
      moneyCents: giftCents(recs),
      members: membersOf(recs),
      contacts: contactsOf(recs),
    });
  }

  for (const r of records) {
    const hold = holdForRecord(r);
    const signature: PatternSignature | null =
      hold === "minor" ? "minor_record" : hold === "uncertain_type" ? "uncertain_type" : hold === "unreadable_money" ? "unreadable_money" : isLowConfidence(r, cfg) ? "low_confidence_read" : null;
    if (signature === null) continue;
    items.push({
      key: `${signature}:rec~${r.fingerprint}`,
      kind: "record",
      signature,
      tier: SIGNATURES[signature].tier,
      subject: r.id,
      recordIds: [r.id],
      fingerprints: [r.fingerprint],
      evidenceKinds: [],
      conflictKinds: [],
      shared: { phone: null, email: null, address: null, id: null },
      moneyCents: giftCents([r]),
      members: membersOf([r]),
      contacts: contactsOf([r]),
    });
  }
  // Stable and without repeats (the same pair can surface through several keys, never twice here).
  const seen = new Set<string>();
  return items
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .sort((x, y) => x.key.localeCompare(y.key));
}

// ---------------------------------------------------------------------------
// Groups and questions
// ---------------------------------------------------------------------------

export type ValueScore = { moneyCents: number; members: number; contacts: number };

export type QuestionAnswer = { code: AnswerCode; label: string; recommended: boolean };

export type ExampleView = { itemKey: string; lines: string[]; evidence: string[] };

export type Question = {
  id: string;
  signature: PatternSignature;
  tier: "C" | "D";
  title: string;
  detail: string;
  /** Distinct rows the question is about. */
  count: number;
  /** At most three. */
  answers: QuestionAnswer[];
  recommended: AnswerCode;
  sameForRest: { available: boolean; others: number; label: string };
  rememberable: boolean;
  routeTo: "treasurer" | "membership" | null;
  examples: ExampleView[];
  value: ValueScore;
};

export type ExceptionGroup = {
  id: string;
  signature: PatternSignature;
  tier: "C" | "D";
  items: ExceptionItem[];
  /** Subjects (rows) in the group. */
  subjects: string[];
  value: ValueScore;
  question: Question;
};

function describeRecord(r: NormalizedRecord, held: boolean, locale: Locale): string {
  if (held) return text("e.row.held", locale, { row: r.row, source: r.source });
  const bits: string[] = [];
  if (r.name.raw) bits.push(r.name.raw);
  if (r.existing?.number) bits.push(`household number ${r.existing.number}`);
  if (r.gift && r.gift.cents !== null) {
    bits.push(`${formatCents(r.gift.cents)} on ${r.gift.date.iso ?? r.gift.date.alternatives.join(" or ")}`);
    if (r.gift.ref) bits.push(`check or reference ${r.gift.ref}`);
  }
  if (r.address?.number && r.address.street) {
    const unit = r.address.unit ? ` #${r.address.unit}` : "";
    bits.push(`${r.address.number} ${r.address.street}${unit}${r.address.zip5 ? `, ${r.address.zip5}` : ""}`);
  }
  if (r.phones[0]) bits.push(`phone ending ${r.phones[0].value.slice(-4)}`);
  if (r.emails[0]) bits.push(`e-mail ${r.emails[0].replace(/^(.).*(@.*)$/, "$1***$2")}`);
  bits.push(text("e.row", locale, { row: r.row, source: r.source }));
  return bits.join(" · ");
}

function compareValue(a: ValueScore, b: ValueScore): number {
  return b.moneyCents - a.moneyCents || b.members - a.members || b.contacts - a.contacts;
}

function buildQuestion(sig: PatternSignature, items: ExceptionItem[], subjects: string[], value: ValueScore, byId: Map<string, NormalizedRecord>, locale: Locale): Question {
  const spec = SIGNATURES[sig];
  const n = subjects.length;
  const key = (suffix: string) => `q.${sig}.${suffix}` as StringKey;
  const held = sig === "minor_record" || sig === "uncertain_type";
  const examples: ExampleView[] = items.slice(0, 3).map((it) => ({
    itemKey: it.key,
    lines: it.recordIds.map((id) => describeRecord(byId.get(id)!, held, locale)),
    evidence: [],
  }));
  const others = Math.max(0, n - 1);
  const sameAvailable = spec.sameForRest && others >= 1;
  return {
    id: `q:${sig}`,
    signature: sig,
    tier: spec.tier,
    title: text(key("title"), locale, { n }),
    detail: text(key("detail"), locale),
    count: n,
    answers: spec.answers.map((code, i) => ({ code, label: text(`a.${code}` as StringKey, locale), recommended: i === 0 })),
    recommended: spec.answers[0],
    sameForRest: {
      available: sameAvailable,
      others,
      label: sameAvailable ? text("q.same_for_rest", locale, { n: others }) : spec.sameForRest ? "" : text("q.same_for_rest.no_hold", locale),
    },
    rememberable: spec.rememberable,
    routeTo: spec.routeTo,
    examples,
    value,
  };
}

/** Groups items by pattern signature, ranks the groups by value, and writes one question per group. */
export function groupItems(
  items: readonly ExceptionItem[],
  records: readonly NormalizedRecord[],
  pairs: readonly ClassifiedPair[],
  locale: Locale = "en",
): ExceptionGroup[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const evidenceByKey = new Map<string, string[]>();
  for (const p of pairs) {
    const key = pairItemKey(p, byId.get(p.a)!, byId.get(p.b)!);
    if (key !== null) evidenceByKey.set(key, p.evidence.map((e) => e.label));
  }

  const buckets = new Map<PatternSignature, ExceptionItem[]>();
  for (const it of items) {
    const list = buckets.get(it.signature);
    if (list) list.push(it);
    else buckets.set(it.signature, [it]);
  }
  const groups: ExceptionGroup[] = [];
  for (const [sig, list] of buckets) {
    const sorted = [...list].sort((x, y) => y.moneyCents - x.moneyCents || x.key.localeCompare(y.key));
    const subjects = [...new Set(sorted.map((i) => i.subject))].sort();
    const recordSet = new Set(sorted.flatMap((i) => i.recordIds));
    const recs = [...recordSet].map((id) => byId.get(id)!);
    const value: ValueScore = {
      moneyCents: sorted.reduce((n, i) => n + i.moneyCents, 0),
      members: membersOf(recs),
      contacts: contactsOf(recs),
    };
    const question = buildQuestion(sig, sorted, subjects, value, byId, locale);
    question.examples.forEach((e) => (e.evidence = evidenceByKey.get(e.itemKey) ?? []));
    groups.push({ id: `grp:${sig}`, signature: sig, tier: SIGNATURES[sig].tier, items: sorted, subjects, value, question });
  }
  return groups.sort((x, y) => compareValue(x.value, y.value) || x.signature.localeCompare(y.signature));
}

// ---------------------------------------------------------------------------
// The question budget
// ---------------------------------------------------------------------------

export type QuestionBudget = {
  rows: number;
  questions: number;
  perThousand: number;
  target: number;
  withinTarget: boolean;
  /** How many questions the target allows for this many rows (at least one: every pattern costs one). */
  allowed: number;
  /** The lowest-value groups beyond `allowed`: shown last, or postponed. */
  deferrable: string[];
  summary: string;
};

/**
 * Estimates the person's workload: questions after grouping per 1,000 rows against the target (under 10). Because a question
 * is per PATTERN, the number grows slowly with the file: 3,000 rows with the same patterns ask the same questions as 300.
 */
export function questionBudget(groups: readonly ExceptionGroup[], rows: number, cfg: ResolveConfig, locale: Locale = "en"): QuestionBudget {
  const questions = groups.length;
  const perThousand = rows > 0 ? Math.round((questions * 10000) / rows) / 10 : 0;
  const target = cfg.budget.questionsPer1000;
  const allowed = Math.max(1, Math.floor((target * rows) / 1000));
  const withinTarget = rows === 0 || (questions * 1000) / rows <= target;
  const deferrable = [...groups].sort((x, y) => compareValue(x.value, y.value)).slice(allowed).map((g) => g.id);
  const summary = text(withinTarget ? "b.within" : "b.over", locale, { questions, rows, per1000: perThousand, target });
  return { rows, questions, perThousand, target, withinTarget, allowed, deferrable, summary };
}

/** The tier a group's items belong to, for callers that only hold the group id. */
export function tierOfSignature(sig: PatternSignature): Tier {
  return SIGNATURES[sig].tier;
}
