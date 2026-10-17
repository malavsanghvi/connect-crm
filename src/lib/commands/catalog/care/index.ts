// DonorDelight's Niva commands (slice 8, docs/DONORDELIGHT.md section 8). Five commands, all for Niva's chat only (assistantOnly), all needing iWeaver (ai) and
// DonorDelight (care) on and the organization's own tick (care_niva_settings, app.save_care_niva), all with the asking person's own rights:
//   care.my_week           read     the person's own week: up to five tasks with why and a draft
//   care.household_brief   read     what to know before you call one household (never an amount, never a note's text)
//   care.draft_note        draft    the material for one personal note (nothing is sent; a person sends)
//   care.log_touch         confirm  a dictated note becomes a touch on the log, once the person confirms (off for Niva until ticked, like every confirm command)
//   care.draft_care_plan   draft    the yearly plan's material and a first draft (nothing is saved; a care manager saves, edits and approves it on the screen)
// They hand a model at most ten households, no amount, no free-text note, no reason a household is not to be asked, nobody under 18. They are not recorded in the
// activity stream (src/lib/commands/activity.ts).

import type { AnyCommand } from "../../types";

import { careDraftCarePlan } from "./draft-care-plan";
import { careDraftNote } from "./draft-note";
import { careHouseholdBrief } from "./household-brief";
import { careLogTouch } from "./log-touch";
import { careMyWeek } from "./my-week";

export const CARE_COMMANDS: readonly AnyCommand[] = [careMyWeek, careHouseholdBrief, careDraftNote, careLogTouch, careDraftCarePlan];
