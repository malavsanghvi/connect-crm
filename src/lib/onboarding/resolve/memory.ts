// Learning: every answer can become a DecisionRule, so a nightly pull never asks the same thing twice.
//
// A rule is a signature (the pattern), conditions on the evidence, an answer, and who decided when. Rules are as narrow as
// the person chose:
//   exact_pair  these two records (recognised by content hash, so it survives re-reads and row shifts)
//   identifier  this phone, e-mail or street address, whoever it turns up on
//   pattern     any later item with the same signature, at least this evidence and no other conflict
// RULES NEVER APPLY TO TIER D. Anyone under 18, any money conflict, any record of uncertain type is decided by a person
// every time. That is enforced three times: a D group cannot produce a rule, a rule for a D signature is invalid, and the
// matcher skips D items.

import { hash32 } from "./normalize";
import { SIGNATURES, type AnswerCode, type ExceptionGroup, type ExceptionItem, type RuleScope } from "./exceptions";
import { text, type Locale, type StringKey } from "./strings";
import type { ConflictKind, EvidenceKind, PatternSignature } from "./types";

export type RuleCondition =
  | { type: "pair"; fingerprints: [string, string] }
  | { type: "identifier"; field: "phone" | "email" | "address" | "id"; value: string }
  | { type: "evidence"; requires: EvidenceKind[]; allowsConflicts: ConflictKind[] };

export type DecisionRule = {
  id: string;
  signature: PatternSignature;
  scope: RuleScope;
  conditions: RuleCondition[];
  answer: AnswerCode;
  /** Who answered (a user id). */
  decidedBy: string;
  /** When (ISO timestamp). */
  decidedAt: string;
  /** The exceptions group the answer was given to. */
  fromGroup: string | null;
  revokedAt: string | null;
};

export type RuleResult = { ok: true; rule: DecisionRule } | { ok: false; reason: string };

const IDENTIFIER_FOR: Partial<Record<PatternSignature, "phone" | "email" | "address" | "id">> = {
  shared_phone_households: "phone",
  shared_email_households: "email",
  address_unit_differs: "address",
};

function identifierCondition(item: ExceptionItem, signature: PatternSignature): RuleCondition | null {
  const preferred = IDENTIFIER_FOR[signature];
  const order: Array<"phone" | "email" | "address" | "id"> = preferred ? [preferred, "phone", "email", "address", "id"] : ["phone", "email", "address", "id"];
  for (const field of order) {
    const value = item.shared[field];
    if (value) return { type: "identifier", field, value };
  }
  return null;
}

/**
 * Turns an answer into a rule. `sample` is an item of the group (the first by default) that supplies the details the
 * rule is made from. Returns a reason instead of a rule for anything that must not be remembered.
 */
export function ruleFromAnswer(input: {
  group: ExceptionGroup;
  answer: AnswerCode;
  decidedBy: string;
  decidedAt: string;
  scope?: RuleScope;
  sample?: ExceptionItem;
}): RuleResult {
  const { group, answer } = input;
  const spec = SIGNATURES[group.signature];
  if (group.tier === "D" || spec.tier === "D") return { ok: false, reason: "Answers about children and money are never remembered; a person decides each time." };
  if (!spec.rememberable) return { ok: false, reason: "This kind of answer is not remembered." };
  if (!spec.answers.includes(answer)) return { ok: false, reason: "That is not one of the answers to this question." };
  const sample = input.sample ?? group.items[0];
  if (!sample) return { ok: false, reason: "There is nothing in this group to remember." };
  if (sample.tier === "D" || sample.kind === "record") return { ok: false, reason: "This item is held for a person and cannot be remembered." };

  let scope: RuleScope = input.scope ?? spec.defaultScope;
  let conditions: RuleCondition[];
  if (scope === "identifier") {
    const c = identifierCondition(sample, group.signature);
    if (c) conditions = [c];
    else {
      scope = "exact_pair";
      conditions = [{ type: "pair", fingerprints: [sample.fingerprints[0], sample.fingerprints[1] ?? sample.fingerprints[0]] }];
    }
  } else if (scope === "pattern") {
    conditions = [{ type: "evidence", requires: [...sample.evidenceKinds], allowsConflicts: [...sample.conflictKinds] }];
  } else {
    conditions = [{ type: "pair", fingerprints: [sample.fingerprints[0], sample.fingerprints[1] ?? sample.fingerprints[0]] }];
  }
  const id = `rule:${group.signature}:${scope}:${hash32(JSON.stringify(conditions))}`;
  return {
    ok: true,
    rule: { id, signature: group.signature, scope, conditions, answer, decidedBy: input.decidedBy, decidedAt: input.decidedAt, fromGroup: group.id, revokedAt: null },
  };
}

/** Why a rule must not be used, or null. */
export function validateRule(rule: DecisionRule): string | null {
  const spec = SIGNATURES[rule.signature];
  if (!spec) return "unknown pattern";
  if (spec.tier === "D") return "rules never apply to held items";
  if (!spec.rememberable) return "this kind of answer is not remembered";
  if (!spec.answers.includes(rule.answer)) return "the answer is not valid for this pattern";
  if (rule.revokedAt) return "the rule was withdrawn";
  if (rule.conditions.length === 0) return "a rule needs at least one condition";
  return null;
}

function conditionHolds(c: RuleCondition, item: ExceptionItem): boolean {
  switch (c.type) {
    case "pair": {
      if (item.kind !== "pair") return false;
      const have = [...item.fingerprints].sort();
      const want = [...c.fingerprints].sort();
      return have.length === want.length && have.every((f, i) => f === want[i]);
    }
    case "identifier":
      return item.shared[c.field] === c.value;
    case "evidence": {
      if (item.kind !== "pair") return false;
      const kinds = new Set(item.evidenceKinds);
      if (!c.requires.every((k) => kinds.has(k))) return false;
      const allowed = new Set(c.allowsConflicts);
      return item.conflictKinds.every((k) => allowed.has(k));
    }
  }
}

/** Whether a rule answers an item. Tier D items are never matched, whatever the rule says. */
export function ruleMatches(rule: DecisionRule, item: ExceptionItem): boolean {
  if (item.tier === "D" || item.kind === "record") return false;
  if (validateRule(rule) !== null) return false;
  if (rule.signature !== item.signature) return false;
  return rule.conditions.every((c) => conditionHolds(c, item));
}

const SPECIFICITY: Record<RuleScope, number> = { exact_pair: 3, identifier: 2, pattern: 1 };

export type AppliedRule = { itemKey: string; ruleId: string; answer: AnswerCode };

/** Answers what it can from remembered rules. The narrowest rule wins; ties go to the newest answer. */
export function applyRules(items: readonly ExceptionItem[], rules: readonly DecisionRule[]): { applied: AppliedRule[]; remaining: ExceptionItem[] } {
  const usable = rules.filter((r) => validateRule(r) === null);
  const applied: AppliedRule[] = [];
  const remaining: ExceptionItem[] = [];
  for (const item of items) {
    const hits = usable
      .filter((r) => ruleMatches(r, item))
      .sort((a, b) => SPECIFICITY[b.scope] - SPECIFICITY[a.scope] || b.decidedAt.localeCompare(a.decidedAt) || a.id.localeCompare(b.id));
    if (hits.length === 0) remaining.push(item);
    else applied.push({ itemKey: item.key, ruleId: hits[0].id, answer: hits[0].answer });
  }
  return { applied, remaining };
}

/** One plain sentence for a "remembered answers" list. */
export function describeRule(rule: DecisionRule, locale: Locale = "en"): string {
  const what = text(`q.${rule.signature}.detail` as StringKey, locale);
  const answer = text(`a.${rule.answer}` as StringKey, locale);
  const scope = rule.scope === "exact_pair" ? "for these two rows" : rule.scope === "identifier" ? "for this phone, e-mail or address" : "for every similar case";
  return `${what} Answer ${scope}: ${answer} (decided ${rule.decidedAt.slice(0, 10)}).`;
}
