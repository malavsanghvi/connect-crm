// The first commands. Read and draft commands are on for everyone whose role allows them; the one confirm-level write is registered
// but OFF until the owner approves it (assistant.tools.<key> in the community's settings). No command here moves money, changes a
// role or permission, or deletes anything.

import { defaultRegistry } from "../registry";
import type { AnyCommand } from "../types";

import { draftEventChange, setEventField } from "./events-change";
import { eventsUpcoming } from "./events-upcoming";
import { draftReminderCommand } from "./messages-draft-reminder";
import { monthCloseBlockers } from "./month-close-blockers";
import { peopleSearch } from "./people-search";
import { pledgesBehind } from "./pledges-behind";
import { tasksMine } from "./tasks-mine";

export const CATALOG: readonly AnyCommand[] = [
  // read
  peopleSearch,
  tasksMine,
  eventsUpcoming,
  pledgesBehind,
  monthCloseBlockers,
  // draft
  draftReminderCommand,
  draftEventChange,
  // confirm (off by default)
  setEventField,
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
