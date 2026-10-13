// What the "Add to an event" panel is given for a family: the card line (never a name alone), the people (adults first, children after) and
// the person it opens from. Pure, so the page, the Events tab and the dev previews build it the same way.

import type { AddToEventProps } from "./event-add";
import type { FamilyModel } from "./family-model";
import { detailHousehold, householdLine } from "./slideover";

export function addToEventProps(model: FamilyModel, openedFrom: string | null, timeZone: string): AddToEventProps {
  return {
    householdId: model.id,
    cardLine: householdLine(detailHousehold(model)),
    people: [...model.adults, ...model.children].map((p) => ({ id: p.id, name: p.name, firstName: p.firstName, isChild: p.isChild, age: p.age, deceased: p.deceased })),
    openedFrom,
    timeZone,
  };
}

/** Who the Events tab ticks first: the family's primary member, else its first adult. */
export function tabDefaultPerson(model: FamilyModel): string | null {
  return (model.adults.find((a) => a.isPrimary) ?? model.adults[0])?.id ?? null;
}
