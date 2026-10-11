// The Events commands (B90 phase 4). Read and draft ones are on for everyone whose role allows them; the confirm-level ones are
// registered but OFF for Niva until the owner switches each on (assistant.tools.<key>). The Server Actions in
// src/app/(app)/events/actions.ts call the same `execute` through bridge.ts, so a screen, the ⌘K palette and Niva share one code path.

import type { AnyCommand } from "../../types";

import { audiencePreview } from "./audience";
import { assignVolunteerCommand } from "./assign-volunteer";
import { draftEventChange, setEventField } from "./change";
import { createFromClone, draftCloneEvent } from "./clone";
import { eventReadinessCommand } from "./readiness";
import { eventRsvps, setRsvpStatusCommand } from "./rsvps";
import { setEventStatusCommand } from "./set-status";
import { eventSummary } from "./summary";
import { eventsUpcoming } from "./upcoming";

export { runCommandFromScreen } from "./bridge";
export { assignVolunteerCommand, setEventStatusCommand, setRsvpStatusCommand };

/** In the order a person would meet them: look, prepare, then change. */
export const EVENT_COMMANDS: readonly AnyCommand[] = [
  // read
  eventsUpcoming,
  eventSummary,
  eventReadinessCommand,
  audiencePreview,
  eventRsvps,
  // draft
  draftEventChange,
  draftCloneEvent,
  // confirm (off by default)
  setEventField,
  setEventStatusCommand,
  setRsvpStatusCommand,
  assignVolunteerCommand,
  createFromClone,
];
