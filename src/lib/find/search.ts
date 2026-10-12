// The two pure steps the server lookup (src/lib/data/find.ts) and the dev preview share: read a sentence as a list, and score and rank
// whatever candidates the database (or the preview's invented data) handed back. No I/O.

import type { CommunityFormat } from "@/lib/community-format";
import { hrefWith } from "@/lib/search-params";
import { tierLabel } from "@/lib/people";
import { chipsFor, paramsFromFilters, type AskVocab } from "@/lib/people-v2/ask";

import { readsAsFilter } from "./classify";
import type { IdLabelRules } from "./labels";
import { familyOfAdult, scoreFamily, scorePerson } from "./match";
import { rankMatches, type RankedItem } from "./rank";
import type { Classified, FamilyCandidate, FindFilter, PersonCandidate } from "./types";

/** The address of "show these as a list" and the chips that say what was understood; null when the rule-based reader found no filter. */
export function filterFor(text: string, vocab: AskVocab, fmt: CommunityFormat): FindFilter | null {
  const reading = readsAsFilter(text, vocab);
  if (!reading) return null;
  const chips = chipsFor(reading.filters, { zones: vocab.zones, fmt, tierLabel }).map((c) => c.label);
  return { href: hrefWith("/people", {}, { ...paramsFromFilters(reading.filters), said: text.slice(0, 300) }), chips, understood: chips.join(" · ") };
}

/**
 * Score every candidate against what was typed and put the matches in order. A family is found on its own facts (name, number,
 * identifiers) and, when an ADULT matched, through that adult. A child is only ever a person row, and only when `canSeeChildren`.
 */
export function rankCandidates(
  q: Classified,
  rules: IdLabelRules,
  people: readonly PersonCandidate[],
  families: ReadonlyMap<string, FamilyCandidate>,
  { canSeeChildren }: { canSeeChildren: boolean },
): { items: RankedItem[]; more: number } {
  const scoredPeople = people.filter((c) => canSeeChildren || !c.isChild).flatMap((c) => scorePerson(q, c, rules) ?? []);
  const scoredFamilies = [...families.values()].flatMap((f) => scoreFamily(q, f, rules) ?? []);
  for (const p of scoredPeople) {
    const family = p.item.householdId ? families.get(p.item.householdId) : undefined;
    const derived = family ? familyOfAdult(p, family) : null;
    if (derived) scoredFamilies.push(derived);
  }
  return rankMatches(scoredPeople, scoredFamilies);
}
