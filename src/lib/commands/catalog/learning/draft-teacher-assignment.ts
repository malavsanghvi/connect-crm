import { schoolOrGeneric } from "@/lib/kind-samples";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { assessAssignment, classWhen, TEACHER_ROLES } from "./assess";

const input = object({
  class_id: f.uuid("The class (its id, from learning.classes_needing_teachers)."),
  person_id: f.uuid("The adult to propose as teacher (their person id, from the suggestions learning.classes_needing_teachers gave, or from people.search)."),
  role: f.withDefault(f.enum("What they would be on the class: teacher, assistant or substitute.", TEACHER_ROLES), "teacher"),
});
export type DraftTeacherInput = Infer<typeof input>;

export type TeacherProposal = {
  class: { class_id: string; name: string; term: string; level: string; when: string; room: string | null };
  teacher: { person_id: string; name: string; member_number: string | null };
  role: string;
  /** False when something stops it (they are already on the class). A clash is a warning, not a stop. */
  can_be_assigned: boolean;
  checks: { status: "ok" | "check" | "note"; text: string }[];
  next_step: string;
};

/** A teacher assignment, prepared and checked, with nothing saved. */
export const draftTeacherAssignment = defineCommand<DraftTeacherInput, TeacherProposal>({
  key: "learning.draft_teacher_assignment",
  title: "Prepare a teacher for a class",
  description: (kind) => {
    const schoolName = schoolOrGeneric(kind);
    return (
      `Prepare a teacher for a ${schoolName} class and check it without saving anything: whether the adult is already on the class, whether they are free at the class's time or already teach another class then, whether they taught this level before or were selected for a teacher position, and their background-check status. ` +
      `The teacher must be an ADULT; Niva never plans with anyone under 18 and never looks at any learner. To make it happen, use learning.assign_teacher, which asks the person to confirm. It changes nothing.`
    );
  },
  level: "draft",
  permission: "pathshala",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const a = await assessAssignment(ctx, inp.class_id, inp.person_id, inp.role);
    const checks: TeacherProposal["checks"] = [];
    if (a.alreadyHere) checks.push({ status: "check", text: `${a.person.name} is already on this class as ${a.alreadyHere}.` });
    checks.push(
      a.clash
        ? { status: "check", text: `${a.clash}, which is at the same time as ${a.cls.name}. They could not be in both.` }
        : { status: "ok", text: `Free at that time: no other class they teach meets on ${classWhen(a.cls)}.` },
    );
    checks.push(a.why.length ? { status: "ok", text: `${a.why.join(". ")}.` } : { status: "note", text: `No earlier record of ${a.person.name} teaching ${a.levelName} or being selected for a teacher position.` });
    if (a.backgroundCheck !== null) {
      const clear = a.backgroundCheck.startsWith("clear");
      checks.push({ status: clear ? "ok" : "check", text: clear ? `Background check: ${a.backgroundCheck}.` : `Background check: ${a.backgroundCheck}. Sort that out before they start teaching.` });
    } else if (a.pool.backgroundNote) {
      checks.push({ status: "note", text: a.pool.backgroundNote });
    }
    if (a.role === "teacher" && (a.teachersHere.length > 0 || a.othersHere > 0)) {
      const names = a.teachersHere.length ? a.teachersHere.join(" and ") : "someone";
      checks.push({ status: "note", text: `This class already has ${names} on it${a.othersHere && a.teachersHere.length ? ` and ${a.othersHere} more` : ""}. Adding a teacher puts one more on it.` });
    }
    const can = a.alreadyHere === null;
    return {
      ok: true,
      data: {
        class: { class_id: a.cls.id, name: a.cls.name, term: a.termName, level: a.levelName, when: classWhen(a.cls), room: a.cls.room },
        teacher: { person_id: a.person.id, name: a.person.name, member_number: a.person.memberNumber },
        role: a.role,
        can_be_assigned: can,
        checks,
        next_step: can
          ? "To assign them, use learning.assign_teacher: the person is shown what will happen and confirms. Or add them on the class page."
          : "They are already on this class, so there is nothing to assign.",
      },
      message: can
        ? `${a.person.name} as ${a.role} of ${a.cls.name}: ${a.clash ? "there is a clash with another class" : "free at that time"}. Nothing has been saved.`
        : `${a.person.name} is already on ${a.cls.name} as ${a.alreadyHere}.`,
    };
  },
});
