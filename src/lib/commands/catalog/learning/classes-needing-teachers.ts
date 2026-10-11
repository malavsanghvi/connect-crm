import { plural } from "@/lib/pathshala/format";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { loadSetup } from "./setup";
import { loadTeacherPool, suggestTeachers, whenWords, type Suggestion } from "./teachers";

const input = object({
  term_id: f.optional(f.uuid("One term (its id, from learning.term_setup). Leave it out for every term that is not closed.")),
});

export type ClassWithoutTeacher = {
  class_id: string;
  class: string;
  level: string;
  when: string;
  room: string | null;
  capacity: number | null;
  /** The class has an assistant or a substitute but no teacher. */
  has_an_assistant_or_substitute: boolean;
  /** Adults who could teach it, best first (up to three). Empty when nothing in the records points to anyone. */
  suggestions: Suggestion[];
};

export type ClassesNeedingTeachersData = {
  terms: { term_id: string; term: string; classes: number; with_a_teacher: number; without_a_teacher: ClassWithoutTeacher[] }[];
  /** People who would have been considered but are not on file as adults: counted, never named. */
  people_left_out_because_their_age_is_not_on_file_as_an_adult: number;
  notes: string[];
};

/** Classes that have no teacher yet, with adults who could teach them (who taught the level before, who was selected for a position, who is free at that time). */
export const classesNeedingTeachers = defineCommand<Infer<typeof input>, ClassesNeedingTeachersData>({
  key: "learning.classes_needing_teachers",
  title: "Look at which classes need a teacher",
  description:
    "List the Pathshala classes that have no teacher yet, term by term, and for each one up to three adults who could teach it: people who taught that level before, people selected for a teacher position, and whether they are free at the class's time or already teach another class then, with their background-check status. " +
    "Suggestions are teachers only, adults only, and are never based on any learner. A class's learners are never shown. Use learning.draft_teacher_assignment to prepare one of the suggestions. It changes nothing.",
  level: "read",
  permission: "pathshala",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const world = await loadSetup(ctx, { termId: inp.term_id });
    const pool = await loadTeacherPool(ctx, world.allTerms);
    const notes: string[] = [];
    if (pool.backgroundNote) notes.push(pool.backgroundNote);
    const levelName = (id: string) => pool.levelNames.get(id) ?? "Level";

    const terms = world.terms.map((term) => {
      const classes = world.classes.filter((c) => c.term_id === term.id);
      const taught = (id: string, roles: readonly string[]) => pool.teachers.some((t) => t.class_id === id && roles.includes(t.role));
      const missing = classes.filter((c) => !taught(c.id, ["teacher"]));
      return {
        term_id: term.id,
        term: term.name,
        classes: classes.length,
        with_a_teacher: classes.length - missing.length,
        without_a_teacher: missing.map(
          (c): ClassWithoutTeacher => ({
            class_id: c.id,
            class: c.name,
            level: levelName(c.level_id),
            when: whenWords(c),
            room: c.room,
            capacity: c.capacity,
            has_an_assistant_or_substitute: taught(c.id, ["assistant", "substitute"]),
            suggestions: suggestTeachers(pool, c, 3),
          }),
        ),
      };
    });
    const total = terms.reduce((n, t) => n + t.without_a_teacher.length, 0);
    return {
      ok: true,
      data: { terms, people_left_out_because_their_age_is_not_on_file_as_an_adult: pool.leftOut, notes },
      message:
        terms.length === 0
          ? "There is no Pathshala term that is not closed."
          : total === 0
            ? "Every class has a teacher."
            : `${plural(total, "class", "classes")} ${total === 1 ? "has" : "have"} no teacher yet: ${terms
                .filter((t) => t.without_a_teacher.length)
                .map((t) => `${t.without_a_teacher.length} in ${t.term}`)
                .join(", ")}.`,
    };
  },
});
