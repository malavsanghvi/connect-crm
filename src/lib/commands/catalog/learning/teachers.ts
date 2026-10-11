// Teachers for classes: who could teach a class, and whether someone is free at its time. ADULTS only (decision D2): a person whose age is
// not on file as 18 or more is left out of every answer, and only counted ("N people were left out"). The suggestions come from what
// the community has set up about its teachers: who taught the same level before, who was selected for a teacher position, and which
// other classes someone already teaches at the same time. Never from learners.

import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { todayInTz } from "@/lib/dates";
import { classTimeLabel, clockTime, formatDate } from "@/lib/pathshala/format";
import { can } from "@/lib/permissions";

import { isAdultMember } from "../../child-filter";
import { CommandDbError, type CommandContext } from "../../types";
import { must } from "../db";

import type { ClassRow, Term } from "./setup";

type Row = Record<string, unknown>;

export type PoolClass = Pick<ClassRow, "id" | "term_id" | "level_id" | "name" | "meets_on" | "starts_time" | "ends_time" | "room" | "capacity">;
export type TeacherRow = { class_id: string; person_id: string; role: string };

export type PersonLite = { id: string; name: string; memberNumber: string | null };

export type TeacherPool = {
  classes: PoolClass[];
  teachers: TeacherRow[];
  /** People selected for a teacher position (an application with the outcome "selected"). */
  selected: { person_id: string; level_id: string | null; term_id: string | null; title: string }[];
  /** Adults only. */
  adults: Map<string, PersonLite>;
  /** People who showed up as possible teachers but are not on file as adults (counted, never named). */
  leftOut: number;
  /** "clear until Mar 3, 2027" / "none on file" / "expired Mar 3, 2026"; null when the checks cannot be shown (backgroundNote says why). */
  backgroundChecks: Map<string, string> | null;
  /** Why the background checks are not shown, in a sentence; null when they are. */
  backgroundNote: string | null;
  termNames: Map<string, string>;
  levelNames: Map<string, string>;
};

const DAY_WORDS: Record<string, string> = { sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday" };

export function dayWord(meetsOn: string): string {
  return DAY_WORDS[meetsOn.toLowerCase()] ?? meetsOn;
}

/** "Sunday 10 AM to 11:30 AM". */
export function whenWords(c: Pick<PoolClass, "meets_on" | "starts_time" | "ends_time">): string {
  const start = clockTime(c.starts_time);
  const end = clockTime(c.ends_time);
  if (start && end) return `${dayWord(c.meets_on)} ${start} to ${end}`;
  return start ? `${dayWord(c.meets_on)} ${start}` : dayWord(c.meets_on);
}

export const classLabel = (c: Pick<PoolClass, "name" | "meets_on" | "starts_time">): string => `${c.name} (${classTimeLabel(c.meets_on, c.starts_time)})`;

function minutes(t: string | null): number | null {
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Two classes of the same term on the same day clash when their times overlap; when a time is missing they MAY clash, so they are treated as clashing. */
export function clashes(a: Pick<PoolClass, "id" | "term_id" | "meets_on" | "starts_time" | "ends_time">, b: Pick<PoolClass, "id" | "term_id" | "meets_on" | "starts_time" | "ends_time">): boolean {
  if (a.id === b.id || a.term_id !== b.term_id || a.meets_on.toLowerCase() !== b.meets_on.toLowerCase()) return false;
  const [as, ae, bs, be] = [minutes(a.starts_time), minutes(a.ends_time), minutes(b.starts_time), minutes(b.ends_time)];
  if (as === null || ae === null || bs === null || be === null) return true;
  return as < be && bs < ae;
}

/** The sentence about someone's background check. */
function checkWords(rows: { status: string; cleared_on: string | null; expires_on: string | null }[], today: string, tz: string): string {
  const clear = rows.filter((r) => r.status === "clear").sort((a, b) => (b.cleared_on ?? "").localeCompare(a.cleared_on ?? ""));
  const latest = clear[0];
  if (!latest) return "none on file";
  if (!latest.expires_on) return "clear, with no end date";
  return latest.expires_on < today ? `expired ${formatDate(latest.expires_on, tz)}` : `clear until ${formatDate(latest.expires_on, tz)}`;
}

const personName = (p: Row): string => `${String(p.preferred_name ?? "").trim() || String(p.first_name)} ${String(p.last_name)}`.trim();

/** Everything about teachers that the suggestions and the assignment need, read once. `extraPeople` are people to describe whatever their history. */
export async function loadTeacherPool(ctx: CommandContext, allTerms: readonly Term[], extraPeople: readonly string[] = []): Promise<TeacherPool> {
  const { db, center } = ctx.session;
  const today = todayInTz(center.time_zone, ctx.now?.());

  const classes = await fetchAll<PoolClass>((from, to) =>
    db.from("pathshala_classes").select("id, term_id, level_id, name, meets_on, starts_time, ends_time, room, capacity").eq("center_id", center.id).order("id").range(from, to),
  );
  if (classes.error) throw new CommandDbError(classes.error, "read the classes");
  const teachers = await fetchAll<TeacherRow>((from, to) => db.from("pathshala_teachers").select("class_id, person_id, role").eq("center_id", center.id).order("id").range(from, to));
  if (teachers.error) throw new CommandDbError(teachers.error, "read the teachers");

  const positions = (must(await db.from("teacher_positions").select("id, term_id, level_id, title").eq("center_id", center.id), "read the teacher positions") ?? []) as {
    id: string;
    term_id: string | null;
    level_id: string | null;
    title: string;
  }[];
  const applications = (must(await db.from("teacher_applications").select("position_id, person_id").eq("center_id", center.id).eq("outcome", "selected"), "read the teacher applications") ?? []) as {
    position_id: string;
    person_id: string | null;
  }[];
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const selected = applications.flatMap((a) => {
    const p = positionById.get(a.position_id);
    return a.person_id && p ? [{ person_id: a.person_id, level_id: p.level_id, term_id: p.term_id, title: p.title }] : [];
  });

  const candidateIds = [...new Set([...teachers.data.map((t) => t.person_id), ...selected.map((s) => s.person_id), ...extraPeople])];
  const people: Row[] = [];
  const links: Row[] = [];
  for (const part of chunk(candidateIds)) {
    people.push(...((must(await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, member_number, merged_into_id, is_deceased").eq("center_id", center.id).in("id", part), "read the teachers' details") ?? []) as Row[]));
    links.push(...((must(await db.from("household_members").select("person_id, role").in("person_id", part).is("left_at", null), "read the teachers' households") ?? []) as Row[]));
  }
  const rolesOf = new Map<string, string[]>();
  for (const l of links) rolesOf.set(String(l.person_id), [...(rolesOf.get(String(l.person_id)) ?? []), String(l.role)]);

  const adults = new Map<string, PersonLite>();
  let leftOut = 0;
  for (const p of people) {
    if (p.merged_into_id || p.is_deceased) continue;
    const dob = typeof p.date_of_birth === "string" ? p.date_of_birth : null;
    const roles = rolesOf.get(String(p.id)) ?? [];
    // A person is an adult by birth date; with none on file, only when every household role they hold is a head, spouse or parent.
    const adult = dob ? isAdultMember({ date_of_birth: dob }, today) : roles.length > 0 && roles.every((role) => isAdultMember({ date_of_birth: null, role }, today));
    if (!adult) {
      leftOut += 1;
      continue;
    }
    adults.set(String(p.id), { id: String(p.id), name: personName(p), memberNumber: p.member_number ? String(p.member_number) : null });
  }

  let backgroundChecks: Map<string, string> | null = new Map();
  let backgroundNote: string | null = null;
  const adultIds = [...adults.keys()];
  if (!can(ctx.session, ["safety.view", "safety.manage"])) {
    // background_checks is readable with safety.view or safety.manage only; without it the database returns nothing, which is not "none on file".
    backgroundChecks = null;
    backgroundNote = "Background checks are not visible to your role, so they are not shown.";
  } else {
    try {
      const rows: { person_id: string; status: string; cleared_on: string | null; expires_on: string | null }[] = [];
      for (const part of chunk(adultIds)) {
        const res = await db.from("background_checks").select("person_id, status, cleared_on, expires_on").eq("center_id", center.id).in("person_id", part);
        if (res.error) throw res.error;
        rows.push(...((res.data ?? []) as typeof rows));
      }
      for (const id of adultIds) backgroundChecks.set(id, checkWords(rows.filter((r) => r.person_id === id), today, center.time_zone));
    } catch (error) {
      console.error("[learning] could not read the background checks; the answer says they were not checked:", error);
      backgroundChecks = null;
      backgroundNote = "Background checks could not be read just now, so they are not shown.";
    }
  }

  const levels = (must(await db.from("pathshala_levels").select("id, name").eq("center_id", center.id), "read the levels") ?? []) as { id: string; name: string }[];
  return {
    classes: classes.data,
    teachers: teachers.data,
    selected,
    adults,
    leftOut,
    backgroundChecks,
    backgroundNote,
    termNames: new Map(allTerms.map((t) => [t.id, t.name])),
    levelNames: new Map(levels.map((l) => [l.id, l.name])),
  };
}

export type Suggestion = {
  person_id: string;
  name: string;
  member_number: string | null;
  /** Why this person: "Taught Jainism 2 in 2025-26". */
  why: string[];
  free_at_that_time: boolean;
  /** "Already teaches Jainism 3 (Sun 10 AM), Sunday 10 AM to 11:30 AM" or null. */
  clash: string | null;
  background_check: string | null;
};

/** Where the person already teaches that clashes with this class (another class of the same term, same day, overlapping time). */
export function clashFor(pool: TeacherPool, cls: PoolClass, personId: string): string | null {
  const byId = new Map(pool.classes.map((c) => [c.id, c]));
  for (const t of pool.teachers) {
    if (t.person_id !== personId || t.class_id === cls.id) continue;
    const other = byId.get(t.class_id);
    if (other && clashes(cls, other)) return `Already teaches ${other.name}, ${whenWords(other)}`;
  }
  return null;
}

/** Why this person is a fit for the class's level. Empty when nothing in the community's own records points to them. */
export function whyWords(pool: TeacherPool, cls: PoolClass, personId: string): string[] {
  const why: string[] = [];
  const level = pool.levelNames.get(cls.level_id) ?? "this level";
  const byId = new Map(pool.classes.map((c) => [c.id, c]));
  const before = pool.teachers
    .filter((t) => t.person_id === personId)
    .map((t) => byId.get(t.class_id))
    .filter((c): c is PoolClass => !!c && c.level_id === cls.level_id && c.term_id !== cls.term_id);
  const terms = [...new Set(before.map((c) => pool.termNames.get(c.term_id) ?? "an earlier term"))];
  if (terms.length) why.push(`Taught ${level} in ${terms.slice(0, 3).join(" and ")}`);
  const picked = pool.selected.find((s) => s.person_id === personId && (s.level_id === cls.level_id || (s.level_id === null && s.term_id === cls.term_id)));
  if (picked) why.push(`Selected for the teacher position "${picked.title}"`);
  return why;
}

/** Up to `limit` adults who could teach the class, best first: free at its time, then selected for a position, then taught the level before. */
export function suggestTeachers(pool: TeacherPool, cls: PoolClass, limit = 3): Suggestion[] {
  const alreadyHere = new Set(pool.teachers.filter((t) => t.class_id === cls.id).map((t) => t.person_id));
  const out: { suggestion: Suggestion; score: number }[] = [];
  for (const person of pool.adults.values()) {
    if (alreadyHere.has(person.id)) continue;
    const why = whyWords(pool, cls, person.id);
    if (why.length === 0) continue;
    const clash = clashFor(pool, cls, person.id);
    const score = (clash ? 0 : 100) + (why.some((w) => w.startsWith("Selected")) ? 20 : 0) + (why.some((w) => w.startsWith("Taught")) ? 10 : 0);
    out.push({
      score,
      suggestion: {
        person_id: person.id,
        name: person.name,
        member_number: person.memberNumber,
        why,
        free_at_that_time: clash === null,
        clash,
        background_check: pool.backgroundChecks ? (pool.backgroundChecks.get(person.id) ?? "none on file") : null,
      },
    });
  }
  return out
    .sort((a, b) => b.score - a.score || a.suggestion.name.localeCompare(b.suggestion.name))
    .slice(0, limit)
    .map((x) => x.suggestion);
}
