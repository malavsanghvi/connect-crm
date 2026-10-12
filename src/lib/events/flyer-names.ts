// A gentle check on the names typed into a flyer's blocks (the host card, the contacts): when one matches a child in the community
// (decision D2: nothing about anyone under 18 is made public by accident), the flyer maker says so beside the preview. It only ever
// WARNS, never blocks: a parent may well mean to thank their own child, and a first name can match by chance. The child's name is
// never shown, only that a name matches. Server side only (it reads the community's children through RLS, like the assistant does).

import { databaseMinorNames, type MinorNameSource, type MinorSession } from "@/lib/commands/child-filter";
import { compileMinorNames } from "@/lib/commands/minor-names";

import type { PosterLayout } from "./flyer-layout";
import { layoutPeople } from "./flyer-layout";

export const NAME_MATCHES_CHILD_NOTE =
  "A name on this flyer matches a child in your community. Check that you mean to put it on a flyer anyone can see. Weaver does not say which name, and this is a reminder, not a block.";

export const NAMES_NOT_CHECKED_NOTE = "Weaver could not check the names on this flyer against the children in your community just now, so look at them yourself before you share it.";

/** The notes to show with the flyer: [] when no name is typed, or none matches a child. */
export async function flyerNameNotes(session: MinorSession, layout: PosterLayout | undefined, source: MinorNameSource = databaseMinorNames): Promise<string[]> {
  const people = layout ? layoutPeople(layout) : [];
  if (people.length === 0) return [];
  try {
    const scanner = compileMinorNames(await source.namesOfMinors(session));
    return people.some((p) => scanner.mentions(p)) ? [NAME_MATCHES_CHILD_NOTE] : [];
  } catch (err) {
    console.error("[events/flyer] could not check the names on the flyer against the community's children:", err);
    return [NAMES_NOT_CHECKED_NOTE];
  }
}
