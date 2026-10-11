// The Learning commands (B90 phase 4): Niva as the helper for Pathshala's setup. They are about TERMS, LEVELS, FEES, CLASSES and TEACHERS
// (adults) and nothing else. Decision D2: nothing about any learner or anyone under 18 reaches the model: no names, birth dates,
// attendance, homework, progress, photos, voice notes, and no registration of a named child. People do learner work on the screen.
//
//   read       a term's setup (levels, age bands, fees in dollars, rules, whether registration is open); what is missing before
//              registration can open; classes with no teacher and adults who could teach them; counts of what is waiting; fee totals
//   draft      a change to a term's setup, from-and-to in dollars; a teacher for a class (both write nothing)
//   confirm    assign a teacher to a class; add or change a class; change the fees of levels. All three start OFF for Niva; the fees
//              are a money rule and need the owner's OK before they are merged.
//
// Learner-facing actions (attendance, homework, sign-offs, enrollments, placement, withdrawals, the learners of "Try a family") have
// no command here on purpose. Any command that wraps such an action for the screen must carry `screenOnly: true`, so the registry
// never offers it to Niva or to the palette (tests/commands/screen-only.test.ts and learning-d2.test.ts keep it so).

import type { AnyCommand } from "../../types";

import { assignTeacherCommand } from "./assign-teacher";
import { classesNeedingTeachers } from "./classes-needing-teachers";
import { draftTeacherAssignment } from "./draft-teacher-assignment";
import { draftTermChange } from "./draft-term-change";
import { feeReport } from "./fee-report";
import { registrationChecklist } from "./registration-checklist";
import { saveClassCommand } from "./save-class";
import { setLevelFeesCommand } from "./set-level-fees";
import { termSetup } from "./term-setup";
import { waitingCounts } from "./waiting-counts";

export { assignTeacherCommand, saveClassCommand, setLevelFeesCommand };

/** In the order a principal would meet them: look, prepare, then change. */
export const LEARNING_COMMANDS: readonly AnyCommand[] = [
  // read
  termSetup,
  registrationChecklist,
  classesNeedingTeachers,
  waitingCounts,
  feeReport,
  // draft
  draftTermChange,
  draftTeacherAssignment,
  // confirm (off for Niva until the community switches each one on)
  assignTeacherCommand,
  saveClassCommand,
  setLevelFeesCommand,
];
