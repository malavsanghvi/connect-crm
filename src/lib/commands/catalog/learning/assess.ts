// Looking at one proposed teacher for one class: who they are, whether they are free at that time, whether they taught the level before,
// and their background check. Shared by learning.draft_teacher_assignment and learning.assign_teacher. For Niva the teacher must be an
// ADULT (decision D2: no tool takes a child's record as input); nothing about the refused person is ever put in the answer.

import { must } from "../db";
import { CommandError, type CommandContext } from "../../types";
import { loadPersonBrief } from "../people/shared";

import { NO_TERM, type Term } from "./setup";
import { clashFor, loadTeacherPool, whyWords, whenWords, type PoolClass, type TeacherPool } from "./teachers";

export const TEACHER_ROLES = ["teacher", "assistant", "substitute"] as const;
export type TeacherRole = (typeof TEACHER_ROLES)[number];

export const TEACHERS_ARE_ADULTS = "Niva only plans with adults as teachers, and this person is not on file as an adult. Add them on the class page instead.";
export const NO_CLASS = "That class was not found, or you can't see it.";
export const NO_PERSON = "That person was not found, or you can't see them.";

export type Assessment = {
  cls: PoolClass;
  termName: string;
  levelName: string;
  person: { id: string; name: string; memberNumber: string | null; isAdult: boolean };
  role: TeacherRole;
  /** The role they already have on this class, when they are on it. */
  alreadyHere: string | null;
  clash: string | null;
  why: string[];
  backgroundCheck: string | null;
  /** Adults who already teach this class (names); `others` counts everyone else on it without naming them. */
  teachersHere: string[];
  othersHere: number;
  pool: TeacherPool;
};

/** Read the class, the person and what the community's records say about them. Throws a plain sentence for a class or person that is not there. */
export async function assessAssignment(ctx: CommandContext, classId: string, personId: string, role: TeacherRole): Promise<Assessment> {
  const { db, center } = ctx.session;
  const cls = must(
    await db.from("pathshala_classes").select("id, term_id, level_id, name, meets_on, starts_time, ends_time, room, capacity").eq("id", classId).eq("center_id", center.id).maybeSingle(),
    "find the class",
  ) as PoolClass | null;
  if (!cls) throw new CommandError(NO_CLASS);
  const brief = await loadPersonBrief(ctx, personId);
  if (!brief || brief.mergedInto) throw new CommandError(NO_PERSON);
  // A person asking through Niva or the palette may only plan with an adult. The refusal says nothing about who it was.
  if (ctx.via !== "screen" && !brief.isAdult) throw new CommandError(TEACHERS_ARE_ADULTS);

  const terms = (must(await db.from("pathshala_terms").select("*").eq("center_id", center.id), "read the terms") ?? []) as Term[];
  const term = terms.find((t) => t.id === cls.term_id);
  if (!term) throw new CommandError(NO_TERM);
  const pool = await loadTeacherPool(ctx, terms, [personId]);
  const here = pool.teachers.filter((t) => t.class_id === cls.id);
  const mine = here.find((t) => t.person_id === personId);
  const named = here.filter((t) => t.role === "teacher" && t.person_id !== personId && pool.adults.has(t.person_id));
  return {
    cls,
    termName: term.name,
    levelName: pool.levelNames.get(cls.level_id) ?? "this level",
    person: { id: brief.id, name: brief.name, memberNumber: brief.memberNumber, isAdult: brief.isAdult },
    role,
    alreadyHere: mine ? mine.role : null,
    clash: clashFor(pool, cls, personId),
    why: whyWords(pool, cls, personId),
    backgroundCheck: pool.backgroundChecks ? (pool.backgroundChecks.get(personId) ?? null) : null,
    teachersHere: named.map((t) => pool.adults.get(t.person_id)?.name ?? "A teacher"),
    othersHere: here.filter((t) => t.person_id !== personId && !named.includes(t)).length,
    pool,
  };
}

/** "Sunday 10 AM to 11:30 AM" for the class. */
export const classWhen = (cls: PoolClass): string => whenWords(cls);
