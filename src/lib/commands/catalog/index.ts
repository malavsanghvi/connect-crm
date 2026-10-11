// The commands. Read and draft commands are on for everyone whose role allows them; the one confirm-level write is registered
// but OFF until the owner approves it (assistant.tools.<key> in the community's settings). No command here moves money, changes a
// role or permission, or deletes anything. The Giving commands (giving.*, B90 phase 4) are reads and one draft: they look at pledges,
// bank lines, Zelle reports and approvals, and giving.draft_payment prepares a payment without saving it. The three that move money
// (giving.record_payment, giving.confirm_exact_zelle_matches, giving.match_deposit) are built but OFF for every door until an owner
// switches each one on (requiresOwnerSwitch). Refunds and write-offs have no command: they need a second person.

import { defaultRegistry } from "../registry";
import type { AnyCommand } from "../types";

import { EVENT_COMMANDS } from "./events";
import { bankLinesUnmatched } from "./giving-bank-lines";
import { confirmExactZelleMatches } from "./giving-confirm-zelle";
import { draftPayment } from "./giving-draft-payment";
import { fundMappingStatus } from "./giving-fund-mapping";
import { householdGivingSummary } from "./giving-household-summary";
import { matchDeposit } from "./giving-match-deposit";
import { recordPayment } from "./giving-record-payment";
import { waitingForSecondApprover } from "./giving-second-approver";
import { zelleWaiting } from "./giving-zelle-waiting";
import { draftReminderCommand } from "./messages-draft-reminder";
import { monthCloseBlockers } from "./month-close-blockers";
import { PEOPLE_COMMANDS } from "./people";
import { peopleSearch } from "./people-search";
import { pledgesBehind } from "./pledges-behind";
import { tasksMine } from "./tasks-mine";

export const CATALOG: readonly AnyCommand[] = [
  // read
  peopleSearch,
  tasksMine,
  pledgesBehind,
  householdGivingSummary,
  bankLinesUnmatched,
  zelleWaiting,
  waitingForSecondApprover,
  fundMappingStatus,
  monthCloseBlockers,
  // draft
  draftReminderCommand,
  draftPayment,
  // Events: read, draft and confirm (the confirm ones off by default), see events/index.ts
  ...EVENT_COMMANDS,
  // People (docs/ADMIN_REDESIGN.md phase 4)
  ...PEOPLE_COMMANDS,
  // Giving: the three that move money are confirm commands, off for EVERY door until an owner switches each one on (requiresOwnerSwitch)
  recordPayment,
  confirmExactZelleMatches,
  matchDeposit,
];

let registered = false;

/** Put the catalog in the shared registry, once. */
export function ensureCatalog(): void {
  if (registered) return;
  registered = true;
  for (const command of CATALOG) {
    if (!defaultRegistry.get(command.key)) defaultRegistry.register(command);
  }
}
