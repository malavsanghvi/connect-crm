// Put a teacher on a class (Pathshala › a class › Teachers). The Add teacher button runs this very `execute` (through
// runCommandFromScreen), with the sentences it has always given. Through Niva or the palette the person must be an adult, and Niva never
// changes anyone's role or access: the class's Teacher role is given on the screen (or in Settings), as the answer says.

import { syncTeacherGrant } from "@/lib/pathshala/teacher-grant";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandPreview } from "../../types";
import { must } from "../db";
import { cardsFor } from "../people/shared";

import { assessAssignment, classWhen, TEACHER_ROLES } from "./assess";

const input = object({
  class_id: f.uuid("The class (its id, from learning.classes_needing_teachers)."),
  person_id: f.uuid("The adult to add (their person id, from learning.draft_teacher_assignment or the suggestions of learning.classes_needing_teachers)."),
  role: f.withDefault(f.enum("What they are on the class: teacher, assistant or substitute.", TEACHER_ROLES), "teacher"),
});
export type AssignTeacherInput = Infer<typeof input>;

const ACCESS_NOTE =
  "Niva does not change anyone's access. Give them the Teacher role for this class in Settings › Roles and access (role: Teacher, scoped to this class), or add them from the class page, so they can open it under Pathshala › My classes.";

export const assignTeacherCommand = defineCommand<AssignTeacherInput, undefined>({
  key: "learning.assign_teacher",
  title: "Assign a teacher to a class",
  description:
    "Add an adult as the teacher (or assistant, or substitute) of a Pathshala class. It shows who and which class, with their household card, whether they are free at that time and their background-check status, and asks the person to confirm. " +
    "The person must be an adult. Niva does not change anyone's access: the Teacher role for the class is given on the screen. Use learning.draft_teacher_assignment first to check it. It never touches a learner.",
  level: "confirm",
  permission: "pathshalaManage",
  module: "pathshala",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/pathshala/actions.ts#addTeacher"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const a = await assessAssignment(ctx, inp.class_id, inp.person_id, inp.role);
    if (a.alreadyHere) throw new CommandError(`${a.person.name} is already on ${a.cls.name} as ${a.alreadyHere}.`);
    const links = must(await ctx.session.db.from("household_members").select("household_id").eq("person_id", a.person.id).is("left_at", null), "read the person's households") ?? [];
    const households = await cardsFor(ctx, links.map((l) => l.household_id));
    const warnings = [
      ...(a.clash ? [`${a.clash}, at the same time as this class.`] : []),
      ...(a.backgroundCheck !== null && !a.backgroundCheck.startsWith("clear") ? [`Background check: ${a.backgroundCheck}.`] : []),
      ACCESS_NOTE,
    ];
    return {
      summary: `Add ${a.person.name}${a.person.memberNumber ? ` (member ${a.person.memberNumber})` : ""} as ${a.role} of ${a.cls.name}.`,
      lines: [
        { label: "Class", value: `${a.cls.name} · ${a.termName} · ${a.levelName}` },
        { label: "Meets", value: classWhen(a.cls) },
        { label: "Role", value: a.role },
        ...(a.why.length ? [{ label: "Why them", value: a.why.join(". ") }] : []),
        { label: "Free at that time", value: a.clash ? "No" : "Yes" },
        ...(a.backgroundCheck !== null ? [{ label: "Background check", value: a.backgroundCheck }] : []),
      ],
      households,
      warnings,
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const screen = ctx.via === "screen";
    if (!screen) {
      // For Niva and the palette: the same checks the preview made (an adult, a real class, not already on it).
      const a = await assessAssignment(ctx, inp.class_id, inp.person_id, inp.role);
      if (a.alreadyHere) throw new CommandError(`${a.person.name} is already on ${a.cls.name} as ${a.alreadyHere}.`);
    }
    must(await db.from("pathshala_teachers").insert({ center_id: center.id, class_id: inp.class_id, person_id: inp.person_id, role: inp.role }), "add the teacher to this class");
    // The screen keeps the class's Teacher role in step when the person may; Niva never changes anyone's role or access.
    const note = screen ? await syncTeacherGrant(db, ctx.session, center.id, inp.class_id, inp.person_id, "grant", ctx.session.userId) : ACCESS_NOTE;
    revalidateAfterCommand(["/pathshala"]);
    return { ok: true, data: undefined, message: `Teacher added.${note ? " " + note : ""}` };
  },
});
