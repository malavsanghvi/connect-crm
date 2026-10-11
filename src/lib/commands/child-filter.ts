// Decision D2: nothing about a child reaches an AI provider. Anyone under 18, and any learner record: names, birth dates,
// attendance, homework, progress, photos, voice notes, dietary or health notes. This is the command layer's filter. It cleans every
// result a command returns to the assistant before the model sees it, and no command takes a child's record as input.
//
// Three layers, so one miss is not a leak:
//   1. The commands build their answers from adults only (household cards list adults; see catalog/household.ts).
//   2. filterChildren() removes, from whatever is left, birth dates, children lists, learner records, the sensitive notes and any
//      record that is itself a minor (a birth date, an age, a role or a flag says so).
//   3. The names of the community's minors (MinorNameSource) are replaced wherever they appear in text, and the result is checked
//      once more; if a name is still there the result is withheld (run.ts), never sent.
// People on the screen see children as before: this filter runs only for `via: "assistant"`.
//
// Any culture: names are matched without assuming an order, a number of words or a script (see minor-names.ts). The age is 18 as a
// floor and the community's own age of majority above it where there is one (src/lib/age-of-majority.ts).

import { ageOfMajority, birthCutoff, MIN_AGE_OF_MAJORITY, type MajorityPlace } from "@/lib/age-of-majority";
import { todayInTz, ageOn } from "@/lib/dates";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import type { AppSupabase } from "@/lib/supabase/server";

import { CHILD_NAME_REPLACEMENT, compileMinorNames, isNameParticle, nameTokens, type MinorName, type MinorNameEntry } from "./minor-names";

export { CHILD_NAME_REPLACEMENT, compileMinorNames };
export type { MinorName, MinorNameEntry };

/** The community whose children these are: where it is decides the age of majority. */
export type MinorSession = { db: AppSupabase; center: { id: string; time_zone: string } & MajorityPlace };

/** Whoever can say which names in a community belong to people under 18 (a database lookup in the app, a list in tests). */
export interface MinorNameSource {
  /**
   * The community's people under the age of majority: a bare string is a name whose parts are not known (every word of it counts),
   * a MinorName says which words identify the child alone. Throws if it cannot tell: the result is then withheld.
   */
  namesOfMinors(session: MinorSession): Promise<MinorNameEntry[]>;
}

/** The age at which someone in this community is an adult for D2: never below 18. */
export function communityMajority(center: MajorityPlace | null | undefined): number {
  return ageOfMajority(center);
}

// ---------------------------------------------------------------------------
// Who counts as an adult
// ---------------------------------------------------------------------------
const ADULT_ROLES = new Set(["primary", "spouse", "parent"]);

/**
 * A household member is an adult when their birth date says they have reached the age of majority (18, or more where the community's
 * place sets it: pass `majority` from communityMajority). With no birth date on file the household role decides, and only the roles
 * of a head, spouse or parent count: a "child", "sibling" or "other" with no birth date is treated as a child (D2 errs on the side
 * of withholding).
 */
export function isAdultMember(member: { date_of_birth: string | null | undefined; role?: string | null }, today: string, majority: number = MIN_AGE_OF_MAJORITY): boolean {
  const age = ageOn(member.date_of_birth, today);
  if (age !== null) return age >= Math.max(majority, MIN_AGE_OF_MAJORITY);
  return ADULT_ROLES.has((member.role ?? "").toLowerCase());
}

/**
 * A household's display name ("Shah, Priya, Rahul & Zoya") without the first names of its members under 18. Names are matched
 * the way every other child name is (any case, accents or script); separators left dangling are tidied. Null when nothing is left.
 */
export function householdNameWithoutChildren(name: string | null, minorFirstNames: readonly string[]): string | null {
  if (!name) return name;
  const minors = compileMinorNames(minorFirstNames.map((n) => n.trim()).filter(Boolean));
  if (minors.size === 0) return name;
  const stripped = minors.strip(name);
  if (stripped.count === 0) return name;
  const out = stripped.text
    .replace(/\(\s*[,&]*\s*\)/g, "")
    .replace(/\s+(?:and|&)\s*(?=[,)]|$)/gi, "")
    .replace(/(?:\s*[,&]\s*){2,}/g, ", ")
    .replace(/\s*[,&]\s*(?=\)|$)/g, "")
    .replace(/^[\s,&]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || null;
}

// ---------------------------------------------------------------------------
// Structural filter
// ---------------------------------------------------------------------------
function snake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[-\s.]+/g, "_").toLowerCase();
}

const BIRTH_KEYS = new Set(["date_of_birth", "dob", "birth_date", "birthdate", "birthday", "born_on", "birth_year", "year_of_birth", "birth_month", "birth_day"]);

/** A list or record of children: removed with everything under it. */
const CHILD_KEYS = new Set(["children", "child", "kids", "minors", "minor", "dependents", "dependants", "sons", "daughters", "grandchildren", "child_members", "kids_members"]);

/** A learner record: removed with everything under it. Counts ("12 classes waiting") are not records and are kept. */
const LEARNER_KEYS = new Set([
  "learner", "learners", "student", "students", "pupil", "pupils", "enrollment", "enrollments", "enrolment", "enrolments",
  "registration", "registrations", "attendance", "attendances", "homework", "progress", "progress_notes", "progress_reports",
  "report_card", "report_cards", "grades", "sign_off", "sign_offs", "signoff", "signoffs", "gyan_progress", "roster", "class_roster",
  "learner_notes", "teacher_notes",
]);

/** Photos, voice notes, dietary and health notes: withheld for everyone, since the filter cannot tell whose they are. */
const SENSITIVE_KEYS = new Set([
  "photo", "photos", "photo_path", "photo_url", "avatar", "avatar_url", "voice_note", "voice_notes", "voice_path", "dietary",
  "dietary_notes", "dietary_needs", "dietary_options", "allergies", "allergy", "health_notes", "health", "medical", "medical_notes", "special_needs",
]);

/** A household card or search row lists everyone's first names in one text: it cannot be filtered by name, so it is dropped. */
const WHOLE_HOUSEHOLD_TEXT_KEYS = new Set(["members", "household_members", "primary_member", "member_names", "family_members"]);

const CHILD_ROLE_WORDS = new Set(["child", "son", "daughter", "kid", "minor", "student", "learner", "pupil", "grandchild", "dependent"]);
const ROLE_KEYS = new Set(["role", "relationship", "relation", "role_in_household", "household_role", "member_role", "relationship_to_primary"]);
const AGE_KEYS = new Set(["age", "age_years", "age_in_years", "years_old"]);
const CHILD_FLAG_KEYS = new Set(["is_minor", "is_child", "minor", "child", "is_learner", "under_18", "under18"]);
const LEARNER_ID_KEYS = new Set(["learner_id", "learner_person_id", "student_id"]);

function isDropKey(k: string): boolean {
  return BIRTH_KEYS.has(k) || CHILD_KEYS.has(k) || LEARNER_KEYS.has(k) || SENSITIVE_KEYS.has(k) || WHOLE_HOUSEHOLD_TEXT_KEYS.has(k);
}

/** True when a record says, by its own fields, that it is about a person under the age of majority or a learner. */
function describesMinor(o: Record<string, unknown>, today: string, majority: number): boolean {
  for (const [rawKey, value] of Object.entries(o)) {
    const k = snake(rawKey);
    if (CHILD_FLAG_KEYS.has(k) && value === true) return true;
    if (LEARNER_ID_KEYS.has(k) && value !== null && value !== undefined && value !== "") return true;
    if (ROLE_KEYS.has(k) && typeof value === "string" && CHILD_ROLE_WORDS.has(value.trim().toLowerCase())) return true;
    if (AGE_KEYS.has(k) && typeof value === "number" && value >= 0 && value < majority) return true;
    if (BIRTH_KEYS.has(k) && typeof value === "string") {
      const age = ageOn(value.slice(0, 10), today);
      if (age !== null && age < majority) return true;
    }
  }
  return false;
}

export type ChildFilterOptions = {
  /** The community's minors (see MinorNameSource). */
  minorNames?: Iterable<MinorNameEntry>;
  /** Today's date in the community's time zone (YYYY-MM-DD). */
  today?: string;
  /** The community's age of majority (communityMajority); 18 when not given. Never below 18. */
  majority?: number;
};

export type ChildFilterResult<T> = { value: T; removed: number };

const REMOVE = Symbol("remove");

/**
 * A copy of `value` with every child taken out: birth dates, children lists, learner records and sensitive notes dropped by name;
 * any record that is a minor (by birth date, age, role or flag) removed from its list; the names of minors replaced in any text.
 * `removed` counts what was taken out. The input is never changed.
 */
export function filterChildren<T>(value: T, opts: ChildFilterOptions = {}): ChildFilterResult<T> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const majority = Math.max(opts.majority ?? MIN_AGE_OF_MAJORITY, MIN_AGE_OF_MAJORITY);
  const names = compileMinorNames(opts.minorNames);
  let removed = 0;

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (names.size === 0) return v;
      const cleaned = names.redact(v);
      removed += cleaned.count;
      return cleaned.text;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) {
        const w = walk(item);
        if (w !== REMOVE) out.push(w);
      }
      return out;
    }
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if (describesMinor(o, today, majority)) {
        removed += 1;
        return REMOVE;
      }
      const out: Record<string, unknown> = {};
      for (const [rawKey, child] of Object.entries(o)) {
        if (isDropKey(snake(rawKey))) {
          removed += 1;
          continue;
        }
        const w = walk(child);
        if (w === REMOVE) continue;
        out[rawKey] = w;
      }
      return out;
    }
    return v;
  };

  const result = walk(value);
  return { value: (result === REMOVE ? null : result) as T, removed };
}

/** The minors whose names are still readable in `value`, keys included (compared without case or accents). Empty means clean. */
export function leakedMinorNames(value: unknown, minorNames: Iterable<MinorNameEntry>): string[] {
  return compileMinorNames(minorNames).leaked(value);
}

// ---------------------------------------------------------------------------
// The community's minors, from the database
// ---------------------------------------------------------------------------
const MAX_MINORS = 20_000;
const PERSON_COLUMNS = "id, first_name, last_name, preferred_name";

type NamedPerson = { id: string; first_name: string; last_name: string; preferred_name: string | null };

/**
 * One person under the age of majority as the filter wants them. Given names, a preferred name and any single name identify the
 * child on their own. A family word that an adult of the same household shares (`sharedFamily`) does not: it names the family, so
 * it is removed only beside the child's other words, and the adults keep their surname. Any other family word identifies the child
 * too (a family-name-first entry such as first "Wang", last "Wei" is safe this way: nothing in the household shares "Wei").
 */
export function minorNameEntry(p: Pick<NamedPerson, "first_name" | "last_name" | "preferred_name">, sharedFamily?: ReadonlySet<string>): MinorName {
  const first = p.first_name.trim();
  const last = p.last_name.trim();
  const preferred = (p.preferred_name ?? "").trim();
  const nickname = preferred && preferred !== first ? preferred : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  const familyTokens = nameTokens(last);
  const ownFamily = familyTokens.filter((t) => !sharedFamily?.has(t) && !(familyTokens.length >= 2 && isNameParticle(t)));
  const words = [first, nickname, ...(ownFamily.length > 0 ? [ownFamily.join(" ")] : [])].filter(Boolean);
  return {
    full: [join(first, last), ...(nickname ? [join(nickname, last)] : [])].filter(Boolean),
    // With nothing to go on (no given name at all) the name is matched by every word of it.
    words: words.length > 0 ? words : undefined,
  };
}

/** Reads each chunk of ids at the same time: a community of thousands is a handful of requests at once, not a long line of them. */
async function inChunks<T>(ids: readonly string[], size: number, read: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message?: string | null } | null }>, doing: string): Promise<T[]> {
  const parts = await Promise.all(chunk([...ids], size).map((part) => read(part)));
  const out: T[] = [];
  for (const res of parts) {
    if (res.error) throw new Error(`could not read ${doing}: ${res.error.message ?? "unknown error"}`);
    out.push(...(res.data ?? []));
  }
  return out;
}

/** Person id → the family words (folded) of the adults who share a household with them. */
async function adultFamilyWords(db: AppSupabase, minorIds: string[], today: string, majority: number): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (minorIds.length === 0) return out;
  const minors = new Set(minorIds);
  const links = await inChunks(
    minorIds,
    100,
    (part) => db.from("household_members").select("household_id, person_id").in("person_id", part).is("left_at", null),
    "the households of the people under 18",
  );
  const householdsOf = new Map<string, Set<string>>();
  for (const r of links) householdsOf.set(r.person_id, (householdsOf.get(r.person_id) ?? new Set<string>()).add(r.household_id));
  const members = await inChunks(
    [...new Set(links.map((l) => l.household_id))],
    100,
    (part) => db.from("household_members").select("household_id, person_id, role").in("household_id", part).is("left_at", null),
    "the members of the households",
  );
  const adults = await inChunks(
    [...new Set(members.map((m) => m.person_id).filter((id) => !minors.has(id)))],
    100,
    (part) => db.from("people").select("id, last_name, date_of_birth").in("id", part),
    "the adults of the households",
  );
  const others = new Map(adults.map((p) => [p.id, p]));
  const familyOf = new Map<string, Set<string>>();
  for (const m of members) {
    const p = others.get(m.person_id);
    // A person the signed-in role cannot read is not counted: their family word then stays on the list (the safe side).
    if (!p || !isAdultMember({ date_of_birth: p.date_of_birth, role: m.role }, today, majority)) continue;
    const set = familyOf.get(m.household_id) ?? new Set<string>();
    for (const t of nameTokens(p.last_name)) set.add(t);
    familyOf.set(m.household_id, set);
  }
  for (const [personId, households] of householdsOf) {
    const set = new Set<string>();
    for (const h of households) for (const t of familyOf.get(h) ?? []) set.add(t);
    out.set(personId, set);
  }
  return out;
}

/**
 * Everyone under the community's age of majority that the signed-in person's role can see: born after the cutoff, or listed as a
 * child of a household with no birth date on file. RLS decides what comes back, so a person who may not see people gets an empty
 * list (and then no command can show them a person either).
 */
export const databaseMinorNames: MinorNameSource = {
  async namesOfMinors(session) {
    const today = todayInTz(session.center.time_zone);
    const majority = communityMajority(session.center);
    const cutoff = birthCutoff(today, majority);
    const { db, center } = session;
    const minors = new Map<string, NamedPerson>();

    const byBirth = await fetchAll<NamedPerson>(
      (from, to) =>
        db
          .from("people")
          .select(PERSON_COLUMNS)
          .eq("center_id", center.id)
          .gt("date_of_birth", cutoff)
          .order("id")
          .range(from, to),
      { max: MAX_MINORS },
    );
    if (byBirth.error) throw new Error(`could not read the people under 18: ${byBirth.error.message ?? "unknown error"}`);
    if (byBirth.truncated) throw new Error("there are too many people under 18 to check");
    for (const p of byBirth.data) minors.set(p.id, p);

    const children = await fetchAll<{ person_id: string }>(
      (from, to) =>
        db.from("household_members").select("person_id").eq("center_id", center.id).eq("role", "child").is("left_at", null).order("person_id").range(from, to),
      { max: MAX_MINORS },
    );
    if (children.error) throw new Error(`could not read the children of households: ${children.error.message ?? "unknown error"}`);
    const undated = await inChunks<NamedPerson>(
      [...new Set(children.data.map((c) => c.person_id))],
      150,
      (part) => db.from("people").select(PERSON_COLUMNS).in("id", part).is("date_of_birth", null),
      "the children of households",
    );
    for (const p of undated) minors.set(p.id, p);

    const family = await adultFamilyWords(db, [...minors.keys()], today, majority);
    return [...minors.values()].map((p) => minorNameEntry(p, family.get(p.id)));
  },
};
