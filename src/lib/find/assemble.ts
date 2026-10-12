// From scored candidates to the rows the box shows. Pure. A family row is only ever drawn with its household card line (the number,
// the organization's household ID, the adults, the city and area): when the viewer cannot read a family's card, its row is left
// out rather than shown as a name alone. A person's row names their family and shows the same card line. Children appear only as
// "Child · staff only" rows, and the card line names adults only.

import type { HouseholdCard } from "@/lib/commands/types";
import { relationshipLabel } from "@/lib/people";

import { householdCardLine } from "./labels";
import type { RankedItem } from "./rank";
import { familyHref, personHref } from "./rows";
import type { FindRow, PersonCandidate } from "./types";

export const CHILD_SUBTITLE = "Child · staff only";

export function personTitle(p: Pick<PersonCandidate, "firstName" | "lastName" | "preferredName">): string {
  return `${p.preferredName?.trim() || p.firstName} ${p.lastName}`.trim();
}

function subtitleOf(p: PersonCandidate): string {
  if (p.isChild) return CHILD_SUBTITLE;
  const rel = p.relationship ? relationshipLabel(p.relationship) : "Not in a family";
  return p.isDeceased ? `${rel} · Deceased` : rel;
}

/** The household ids the ranked rows need a card for. */
export function householdIdsNeeded(items: readonly RankedItem[]): string[] {
  const ids = new Set<string>();
  for (const i of items) {
    if (i.kind === "family") ids.add(i.scored.item.id);
    else if (i.scored.item.householdId) ids.add(i.scored.item.householdId);
  }
  return [...ids];
}

export function toFindRows(items: readonly RankedItem[], cards: ReadonlyMap<string, HouseholdCard>): FindRow[] {
  const rows: FindRow[] = [];
  for (const i of items) {
    if (i.kind === "family") {
      const { item, score, why } = i.scored;
      const card = cards.get(item.id);
      if (!card) continue;
      rows.push({ kind: "family", id: item.id, title: card.household_name?.trim() || item.displayName?.trim() || "Family", cardLine: householdCardLine(card), why, href: familyHref(item.id), score });
      continue;
    }
    const { item, score, why } = i.scored;
    const card = item.householdId ? cards.get(item.householdId) : undefined;
    rows.push({
      kind: "person",
      id: item.id,
      householdId: item.householdId,
      title: personTitle(item),
      subtitle: subtitleOf(item),
      familyName: card ? card.household_name?.trim() || null : null,
      cardLine: card ? householdCardLine(card) : null,
      child: item.isChild,
      why,
      href: personHref(item.id, item.householdId),
      score,
    });
  }
  return rows;
}
