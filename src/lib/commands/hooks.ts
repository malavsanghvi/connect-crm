// The one place the activity recorder plugs in (MASTER_PLAN priority 5, "record every action"). Every call to runCommand and
// confirmProposal ends here with a CommandEvent: who (role, person), what (the command key), through what (screen, palette or
// assistant), what came of it (outcome, plain-English error) and how long it took. The event carries the NAMES of the values
// given, never the values, so recording a call can never store a secret or a child's details.
//
// The event is turned into an activity event (activity.ts: a catalog key, the outcome, the duration and how it was started, and
// nothing else) and handed to the recorder, which queues it and sends it after the response has gone. Recording is off until a
// platform admin switches the community on; the database drops keys it does not list and people it may not record. run.ts
// calls this after every call and never lets it break a command (a failure in the recorder is logged, not shown as a failed
// action).

import { recordActivity } from "@/lib/activity/record";
import type { CrmSession } from "@/lib/session";

import { commandEventToActivity } from "./activity";
import type { CommandEvent } from "./types";

export function onCommandEvent(event: CommandEvent, session: Pick<CrmSession, "db" | "center">): void {
  const input = commandEventToActivity(event);
  if (!input) return;
  recordActivity({ db: session.db, center: session.center }, input);
}
