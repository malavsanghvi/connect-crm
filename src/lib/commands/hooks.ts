// The one place the activity recorder plugs in (MASTER_PLAN priority 5, "record every action"). Every call to runCommand and
// confirmProposal ends here with a CommandEvent: who (role, person), what (the command key), through what (screen, palette or
// assistant), what came of it (outcome, plain-English error) and how long it took. The event carries the NAMES of the values
// given, never the values, so recording a call can never store a secret or a child's details.
//
// It does nothing yet. The recorder stream replaces the body below; run.ts already calls it after every call and never lets it
// break a command (a failure in the recorder is logged, not shown as a failed action).

import type { CommandEvent } from "./types";

export function onCommandEvent(event: CommandEvent): void {
  void event;
}
