// The People commands (B90 phase 4): lookups and drafts are on for everyone whose role allows them; every command that changes
// something is confirm level and OFF for Niva until the community's owner switches it on (assistant.tools.<key>).
// The Server Actions of the People screens call the same `execute` through runScreenCommand (../../screen.ts).

import type { AnyCommand } from "../../types";

import { addIdentifier } from "./add-identifier";
import { addPerson } from "./add-person";
import { decideApplication } from "./decide-application";
import { decideHouseholdRequest } from "./decide-request";
import { dismissDuplicate } from "./dismiss-duplicate";
import { findHousehold } from "./find-household";
import { householdSummary } from "./household-summary";
import { markDeceased } from "./mark-deceased";
import { mergeHouseholds } from "./merge-households";
import { mergePeople } from "./merge-people";
import { movePerson } from "./move-person";
import { pendingReviews } from "./pending-reviews";
import { retireIdentifier } from "./retire-identifier";
import { setPrimary } from "./set-primary";
import { suggestDuplicates } from "./suggest-duplicates";
import { updateHousehold } from "./update-household";
import { updatePerson } from "./update-person";

export const PEOPLE_COMMANDS: readonly AnyCommand[] = [
  // read
  findHousehold,
  householdSummary,
  pendingReviews,
  // draft
  suggestDuplicates,
  // confirm (off by default)
  addPerson,
  updatePerson,
  movePerson,
  updateHousehold,
  mergePeople,
  mergeHouseholds,
  dismissDuplicate,
  decideApplication,
  decideHouseholdRequest,
  // the More menu (People redesign slice 5, migration 0720): deceased and primary are the person's own screen only
  markDeceased,
  setPrimary,
  addIdentifier,
  retireIdentifier,
];
