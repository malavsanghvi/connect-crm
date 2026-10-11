// Tiers. Every candidate pair (and every record on its own) lands in exactly one of four tiers:
//   A  automatic  two or more independent identifiers agree and nothing conflicts. Applied, listed in the report.
//   B  strong     bulk review: one screen, sorted by evidence, "approve all" and per row.
//   C  ask        weak or conflicting. A plain question, grouped with its look-alikes.
//   D  hold       anyone under 18 or with a child flag, any money conflict, any record whose type is uncertain.
//                 Never decided by code or by a model, and never answered by a remembered rule.
// The thresholds live in config.ts; this file only applies them.

import type { ResolveConfig } from "./config";
import type { CandidatePair, ClassifiedPair, HoldReason, NormalizedRecord, PatternSignature, Tier } from "./types";

/** Why a record on its own must be held, or null. Children come first: D2 outranks everything. */
export function holdForRecord(r: NormalizedRecord): HoldReason | null {
  if (r.minor.isMinor) return "minor";
  if (r.typeUncertain) return "uncertain_type";
  if (r.gift && r.gift.problem !== null) return "unreadable_money";
  return null;
}

/** A paper or photo read the reader was not sure about. A person checks it beside the photo. */
export function isLowConfidence(r: NormalizedRecord, cfg: ResolveConfig): boolean {
  return r.readConfidence !== null && r.readConfidence < cfg.minReadConfidence;
}

/** The record a question is "about": the one that arrived later, unless that one is already in the records. */
export function subjectOf(a: NormalizedRecord, b: NormalizedRecord): NormalizedRecord {
  if (a.sourceKind === "existing" && b.sourceKind !== "existing") return b;
  if (b.sourceKind === "existing" && a.sourceKind !== "existing") return a;
  return a.order >= b.order ? a : b;
}

function singleIndependentKind(pair: CandidatePair): string | null {
  const kinds = [...new Set(pair.evidence.filter((e) => e.independent).map((e) => e.kind))];
  return kinds.length === 1 ? kinds[0] : null;
}

/** The pattern a tier C pair belongs to. Questions are grouped by this. */
export function patternSignature(pair: CandidatePair, lowConfidence: boolean): PatternSignature {
  if (lowConfidence) return "low_confidence_read";
  if (pair.relation === "same_gift") return "duplicate_gift_two_sources";
  const blockKinds = pair.conflicts.filter((c) => c.severity === "block").map((c) => c.kind);
  if (blockKinds.includes("birth_year") || blockKinds.includes("generation")) return "birth_year_differs";
  if (blockKinds.includes("id")) return "ids_differ";
  // The same name twice (a father and son, a repeated row) or a Jr/Sr mark on one side only: relatives with one name.
  const lowerKinds = pair.conflicts.filter((c) => c.severity === "lower").map((c) => c.kind);
  if (lowerKinds.some((k) => k === "ambiguous_name" || k === "one_sided_generation" || k === "middle_name" || k === "birth_date")) return "birth_year_differs";
  const unitOnly = pair.evidence.some((e) => e.kind === "address" && !e.independent) && pair.independent === 0;
  if (unitOnly) return "address_unit_differs";
  if (pair.independent === 0) return "name_only";
  switch (singleIndependentKind(pair)) {
    case "phone":
      return "shared_phone_households";
    case "email":
      return "shared_email_households";
    case "address":
      return "spouse_maiden_name";
    default:
      // An ID or birth date is the only thing that agrees.
      return pair.nameLevel === "maiden" || pair.nameLevel === "given_only" ? "spouse_maiden_name" : "id_name_differs";
  }
}

/** Puts one scored pair into a tier. D holds beat everything; low-confidence reads never go above C. */
export function classifyPair(pair: CandidatePair, a: NormalizedRecord, b: NormalizedRecord, cfg: ResolveConfig): ClassifiedPair {
  return { ...classifyCore(pair, a, b, cfg), implied: false };
}

function classifyCore(pair: CandidatePair, a: NormalizedRecord, b: NormalizedRecord, cfg: ResolveConfig): Omit<ClassifiedPair, "implied"> {
  const reasons: string[] = [];
  const minors = [a, b].filter((r) => r.minor.isMinor);
  const uncertain = [a, b].filter((r) => r.typeUncertain);
  const unreadable = [a, b].filter((r) => r.gift && r.gift.problem !== null);
  const lowConf = [a, b].filter((r) => isLowConfidence(r, cfg));

  if (minors.length > 0) {
    reasons.push("a record is about someone under 18");
    return { ...pair, tier: "D", tierReasons: reasons, hold: "minor", signature: "minor_record", affected: minors.map((r) => r.id) };
  }
  if (pair.money) {
    reasons.push("the amounts disagree");
    return { ...pair, tier: "D", tierReasons: reasons, hold: "money_conflict", signature: pair.money.kind, affected: [a.id, b.id] };
  }
  if (uncertain.length > 0) {
    reasons.push("the kind of record is uncertain");
    return { ...pair, tier: "D", tierReasons: reasons, hold: "uncertain_type", signature: "uncertain_type", affected: uncertain.map((r) => r.id) };
  }
  if (unreadable.length > 0) {
    reasons.push("an amount could not be read");
    return { ...pair, tier: "D", tierReasons: reasons, hold: "unreadable_money", signature: "unreadable_money", affected: unreadable.map((r) => r.id) };
  }

  let tier: Tier = pair.strength === "strong" ? "A" : pair.strength === "medium" ? "B" : "C";
  if (tier === "A") reasons.push(`${pair.independent} independent identifiers agree and nothing conflicts`);
  if (tier === "B") reasons.push("strong evidence, but not certain");
  if (tier === "C") reasons.push(pair.nameOnly ? "only the name agrees" : "the evidence is thin or conflicts");
  if (lowConf.length > 0 && tier !== "C") {
    tier = "C";
    reasons.push("a value was read from a photo or page with low confidence");
  }
  if (tier === "A") return { ...pair, tier, tierReasons: reasons, hold: null, signature: null, affected: [] };
  const signature = patternSignature(pair, lowConf.length > 0);
  const affected = lowConf.length > 0 ? lowConf.map((r) => r.id) : [subjectOf(a, b).id];
  return { ...pair, tier, tierReasons: reasons, hold: null, signature: tier === "B" ? null : signature, affected };
}
