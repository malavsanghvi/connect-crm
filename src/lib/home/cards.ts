// What Home shows besides "My tasks" (docs/DEMO_ROLE_WORK.md). Pure, so Home, Today and the tests share one rule.

import type { AssignmentsCard } from "./assignments";
import type { MemberWork } from "./member-work";

export type HomeCards = {
  /** "Your work is in the member app": for a person with no staff queue and no module screen; null for everyone else. */
  memberWork: MemberWork | null;
  /** "My assignments": for anyone who holds a role for one event, class or zone; null for everyone else. */
  assignments: AssignmentsCard | null;
};

export const hasHomeCards = (cards: HomeCards): boolean => cards.memberWork !== null || cards.assignments !== null;

/**
 * Whether Home shows "My tasks". It always does for a person with a staff queue; for a person with none it does unless their work
 * is on a card, so "Nothing here for your role" is never said to someone who has something.
 */
export const showsTasksCard = (hasSources: boolean, cards: HomeCards): boolean => hasSources || !hasHomeCards(cards);
