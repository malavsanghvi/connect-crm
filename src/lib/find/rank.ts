// Putting the matches in order for the find box: the best match first, then the families, then the people, at most ten rows.
// Pure. "Best" is the highest score; on a tie a family comes before a person, an adult before a child, then by name.

import { foldName } from "@/lib/commands/name-fold";

import type { FamilyCandidate, PersonCandidate, Scored } from "./types";

export const FIND_LIMIT = 10;

export type RankedItem = { kind: "family"; scored: Scored<FamilyCandidate> } | { kind: "person"; scored: Scored<PersonCandidate> };

function titleOf(item: RankedItem): string {
  return item.kind === "family" ? (item.scored.item.displayName ?? "") : `${item.scored.item.firstName} ${item.scored.item.lastName}`;
}

function compare(a: RankedItem, b: RankedItem): number {
  if (a.scored.score !== b.scored.score) return b.scored.score - a.scored.score;
  if (a.kind !== b.kind) return a.kind === "family" ? -1 : 1;
  const childA = a.kind === "person" && a.scored.item.isChild ? 1 : 0;
  const childB = b.kind === "person" && b.scored.item.isChild ? 1 : 0;
  if (childA !== childB) return childA - childB;
  const byTitle = foldName(titleOf(a)).localeCompare(foldName(titleOf(b)));
  return byTitle !== 0 ? byTitle : a.scored.item.id.localeCompare(b.scored.item.id);
}

/**
 * Order the matches. A family found twice (by its own name and through an adult) is shown once, with its best reason. The result
 * is in display order: the best match first, then the other families, then the other people. `more` counts what did not fit.
 */
export function rankMatches(
  people: readonly Scored<PersonCandidate>[],
  families: readonly Scored<FamilyCandidate>[],
  { limit = FIND_LIMIT }: { limit?: number } = {},
): { items: RankedItem[]; more: number } {
  const bestFamily = new Map<string, Scored<FamilyCandidate>>();
  for (const f of families) {
    const have = bestFamily.get(f.item.id);
    if (!have || f.score > have.score) bestFamily.set(f.item.id, f);
  }
  const bestPerson = new Map<string, Scored<PersonCandidate>>();
  for (const p of people) {
    const have = bestPerson.get(p.item.id);
    if (!have || p.score > have.score) bestPerson.set(p.item.id, p);
  }
  const all: RankedItem[] = [
    ...[...bestFamily.values()].map((scored) => ({ kind: "family" as const, scored })),
    ...[...bestPerson.values()].map((scored) => ({ kind: "person" as const, scored })),
  ].sort(compare);
  const kept = all.slice(0, Math.max(0, limit));
  const [first, ...rest] = kept;
  const ordered = first ? [first, ...rest.filter((i) => i.kind === "family"), ...rest.filter((i) => i.kind === "person")] : [];
  return { items: ordered, more: Math.max(0, all.length - kept.length) };
}
