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

/** Any key that says "born": born, born_on, dob_iso, birth, birthyear, date_of_birth_text, bday, yob. */
function isBirthKey(k: string): boolean {
  return BIRTH_KEYS.has(k) || /birth/.test(k) || /(^|_)(dob|born|yob|bday)(_|$)/.test(k);
}

/** A list or record of children: removed with everything under it. */
const CHILD_KEYS = new Set(["children", "child", "kids", "minors", "minor", "dependents", "dependants", "sons", "daughters", "grandchildren", "child_members", "kids_members"]);

/** A learner record: removed with everything under it. Counts ("12 classes waiting") are not records and are kept. */
const LEARNER_KEYS = new Set([
  "learner", "learners", "student", "students", "pupil", "pupils", "enrollment", "enrollments", "enrolment", "enrolments",
  "registration", "registrations", "attendance", "attendances", "homework", "progress", "progress_notes", "progress_reports",
  "report_card", "report_cards", "grades", "sign_off", "sign_offs", "signoff", "signoffs", "gyan_progress", "roster", "class_roster",
  "learner_notes", "teacher_notes",
  // What a school knows about a pupil, other than the pupil's name.
  "grade", "grade_level", "school_grade", "year_group", "class_year",
]);

/** Photos, voice notes, dietary and health notes: withheld for everyone, since the filter cannot tell whose they are. */
const SENSITIVE_KEYS = new Set([
  "photo", "photos", "photo_path", "photo_url", "avatar", "avatar_url", "voice_note", "voice_notes", "voice_path", "dietary",
  "dietary_notes", "dietary_needs", "dietary_options", "allergies", "allergy", "health_notes", "health", "medical", "medical_notes", "special_needs",
]);

/** A household card or search row lists everyone's first names in one text: it cannot be filtered by name, so it is dropped. */
const WHOLE_HOUSEHOLD_TEXT_KEYS = new Set(["members", "household_members", "primary_member", "member_names", "family_members"]);

const CHILD_ROLE_WORDS = new Set([
  "child", "son", "daughter", "kid", "minor", "student", "learner", "pupil", "grandchild", "dependent", "boy", "girl", "teen", "teenager", "youth",
  "infant", "baby", "toddler", "stepchild", "stepson", "stepdaughter", "grandson", "granddaughter", "nephew", "niece", "ward", "foster child",
]);
const ROLE_KEYS = new Set(["role", "relationship", "relation", "role_in_household", "household_role", "member_role", "relationship_to_primary"]);
const AGE_KEYS = new Set(["age", "age_years", "age_in_years", "years_old", "age_now", "current_age", "age_at"]);
const CHILD_FLAG_KEYS = new Set(["is_minor", "is_child", "minor", "child", "is_learner", "under_18", "under18", "is_under_18"]);
const LEARNER_ID_KEYS = new Set(["learner_id", "learner_person_id", "student_id"]);

/** "age_group", "age_range", "age_band", "agegroup": a child's age by another name, withheld for everyone. */
function isAgeBandKey(k: string): boolean {
  return /(^|_)age_?(group|range|band|bracket|class|category|bucket)(_|$)/.test(k) || k === "agegroup";
}

function isDropKey(k: string): boolean {
  return isBirthKey(k) || isAgeBandKey(k) || CHILD_KEYS.has(k) || LEARNER_KEYS.has(k) || SENSITIVE_KEYS.has(k) || WHOLE_HOUSEHOLD_TEXT_KEYS.has(k);
}

/** The keys a field's name is kept under when a record is a list of {label, value} pairs. */
const LABEL_KEYS = new Set(["label", "name", "field", "key", "title", "attribute", "question", "heading", "caption", "type"]);
const SENSITIVE_LABEL = /^\s*(?:date\s+of\s+birth|birth\s*date|birthday|d\.?o\.?b\.?|born(?:\s+on)?|year\s+of\s+birth|birth\s+year|age|age\s+group|age\s+range|grade|school(?:\s+grade)?|class\s+year|dietary(?:\s+needs)?|allergies|health|medical)\s*:?\s*$/i;

/** A {label: "Date of birth", value: "2015-05-05"} pair: the label says what the value is. */
function isSensitiveLabel(o: Record<string, unknown>): boolean {
  for (const [rawKey, value] of Object.entries(o)) {
    if (typeof value === "string" && LABEL_KEYS.has(snake(rawKey)) && SENSITIVE_LABEL.test(value)) return true;
  }
  return false;
}

/** What an age field says: a number of years, in a number or text ("12", "12 yrs", "12y"), or none. */
function ageValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const m = /^\s*(\d{1,3}(?:\.\d+)?)\s*(?:y|yr|yrs|yo|years?)?(?:\s*old)?\s*$/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** Text that says the person is a child, in an age field ("child", "teen", "under 18"). */
const CHILD_AGE_WORDS = /child|kid|teen|minor|youth|junior|infant|toddler|baby|under|adolescent|boy|girl|juvenile|preschool|school.?age/i;

/** True when a record says, by its own fields, that it is about a person under the age of majority or a learner. */
function describesMinor(o: Record<string, unknown>, today: string, majority: number): boolean {
  for (const [rawKey, value] of Object.entries(o)) {
    const k = snake(rawKey);
    if (CHILD_FLAG_KEYS.has(k) && (value === true || value === "true" || value === "yes" || value === 1)) return true;
    if (LEARNER_ID_KEYS.has(k) && value !== null && value !== undefined && value !== "") return true;
    if (ROLE_KEYS.has(k) && typeof value === "string" && CHILD_ROLE_WORDS.has(value.trim().toLowerCase())) return true;
    if (AGE_KEYS.has(k)) {
      const age = ageValue(value);
      if (age !== null && age >= 0 && age < majority) return true;
      if (age === null && typeof value === "string" && CHILD_AGE_WORDS.test(value)) return true;
    }
    if (isBirthKey(k) && typeof value === "string") {
      const iso = /\d{4}-\d{2}-\d{2}/.exec(value);
      const age = ageOn(iso ? iso[0] : value.slice(0, 10), today);
      if (age !== null && age < majority) return true;
      // A birth year alone ("2015") is enough to tell.
      const year = /^\s*(\d{4})\s*$/.exec(value);
      if (year && Number(today.slice(0, 4)) - Number(year[1]) < majority) return true;
    }
    if (isBirthKey(k) && typeof value === "number" && value > 1900 && value < 2200 && Number(today.slice(0, 4)) - value < majority) return true;
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
      if (describesMinor(o, today, majority) || isSensitiveLabel(o)) {
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
        // A key can carry a name too ("ZoyaNote", "zoya2015"): it is renamed, and kept distinct from the keys already there.
        let key = rawKey;
        if (names.size > 0) {
          const renamed = names.redact(rawKey);
          if (renamed.count > 0) {
            removed += renamed.count;
            key = renamed.text;
            for (let n = 2; key in out; n += 1) key = `${renamed.text} (${n})`;
          }
        }
        out[key] = w;
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
const PERSON_COLUMNS = "id, first_name, last_name, preferred_name, email, phone_e164, member_number";
/** The household roles that are not a head, spouse or parent: with no birth date on file, isAdultMember counts these people as children. */
const NON_ADULT_ROLES = ["child", "sibling", "other"];

type NamedPerson = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email?: string | null;
  phone_e164?: string | null;
  member_number?: string | null;
};

/**
 * One person under the age of majority as the filter wants them. Given names, a preferred name and any single name identify the
 * child on their own. A family word that an adult of the same household shares (`sharedFamily`) does not: it names the family, so
 * it is removed only beside the child's other words, and the adults keep their surname. Any other family word identifies the child
 * too (a family-name-first entry such as first "Wang", last "Wei" is safe this way: nothing in the household shares "Wei").
 * The child's e-mail address, phone number and member number are found as they are written.
 */
export function minorNameEntry(p: Pick<NamedPerson, "first_name" | "last_name" | "preferred_name"> & Partial<NamedPerson>, sharedFamily?: ReadonlySet<string>): MinorName {
  const first = p.first_name.trim();
  const last = p.last_name.trim();
  const preferred = (p.preferred_name ?? "").trim();
  const nickname = preferred && preferred !== first ? preferred : "";
  const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
  const familyTokens = nameTokens(last);
  const ownFamily = familyTokens.filter((t) => !sharedFamily?.has(t) && !(familyTokens.length >= 2 && isNameParticle(t)));
  const words = [first, nickname, ...(ownFamily.length > 0 ? [ownFamily.join(" ")] : [])].filter(Boolean);
  const ids = [p.email, p.member_number].map((x) => (x ?? "").trim()).filter(Boolean);
  const phones = [(p.phone_e164 ?? "").trim()].filter(Boolean);
  return {
    full: [join(first, last), ...(nickname ? [join(nickname, last)] : [])].filter(Boolean),
    // With nothing to go on (no given name at all) the name is matched by every word of it.
    words: words.length > 0 ? words : undefined,
    ...(ids.length > 0 ? { ids } : {}),
    ...(phones.length > 0 ? { phones } : {}),
  };
}

/** Reads each chunk of ids at the same time: a community of thousands is a handful of requests at once, not a long line of them. */
async function inChunks<T>(ids: readonly string[], size: number, read: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message?: string | null; code?: string | null } | null }>, doing: string): Promise<T[]> {
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
 * Family words that two or more adults of the community carry are the name of families, not of a child ("Shah"): they do not
 * identify a child on their own even when the child's own household has no adult with that name. Only where this community
 * writes the family name in the last-name column (most children share it with an adult of their household): in a community that
 * writes the family name first, the last-name column holds given names ("Wei") and the rule would let one through.
 */
async function communityFamilyWords(
  db: AppSupabase,
  centerId: string,
  minors: Map<string, NamedPerson>,
  shared: Map<string, Set<string>>,
  today: string,
  majority: number,
): Promise<Set<string>> {
  const withAdults = [...minors.keys()].filter((id) => (shared.get(id)?.size ?? 0) > 0);
  if (withAdults.length < 5) return new Set();
  const sharing = withAdults.filter((id) => nameTokens(minors.get(id)?.last_name ?? "").some((t) => shared.get(id)?.has(t))).length;
  if (sharing / withAdults.length < 0.6) return new Set();
  const unshared = new Map<string, string>();
  for (const id of withAdults) {
    const p = minors.get(id) as NamedPerson;
    if (nameTokens(p.last_name).some((t) => !shared.get(id)?.has(t))) unshared.set(p.last_name.trim(), p.last_name.trim());
  }
  if (unshared.size === 0) return new Set();
  const rows = await inChunks(
    [...unshared.keys()],
    100,
    (part) => db.from("people").select("id, last_name, date_of_birth").eq("center_id", centerId).in("last_name", part),
    "the family names of the adults",
  );
  const carriers = new Map<string, Set<string>>();
  for (const r of rows) {
    if (minors.has(r.id) || !r.date_of_birth || !isAdultMember({ date_of_birth: r.date_of_birth }, today, majority)) continue;
    for (const t of nameTokens(r.last_name)) carriers.set(t, (carriers.get(t) ?? new Set<string>()).add(r.id));
  }
  return new Set([...carriers].filter(([, ids]) => ids.size >= 2).map(([t]) => t));
}

/**
 * Everyone the assistant must never see a word about, as far as the signed-in person's role can see them:
 *   - born after the birth date that makes an adult in this community (18 or more; see age-of-majority.ts);
 *   - with no birth date, a household relationship that is not head, spouse or parent, now or in the past (the rule isAdultMember
 *     uses: a child, a sibling or "other" with no birth date counts as a child; a child who has left the household still does);
 *   - enrolled in the religious school (any learner).
 * RLS decides what comes back, so a person who may not see people gets an empty list (and then no command can show them a person
 * either).
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

    const byRole = await fetchAll<{ person_id: string }>(
      (from, to) => db.from("household_members").select("person_id").eq("center_id", center.id).in("role", NON_ADULT_ROLES).order("person_id").range(from, to),
      { max: MAX_MINORS },
    );
    if (byRole.error) throw new Error(`could not read the children of households: ${byRole.error.message ?? "unknown error"}`);
    const undated = await inChunks<NamedPerson>(
      [...new Set(byRole.data.map((c) => c.person_id))],
      150,
      (part) => db.from("people").select(PERSON_COLUMNS).in("id", part).is("date_of_birth", null),
      "the children of households",
    );
    for (const p of undated) minors.set(p.id, p);

    // Learners of the religious school, of any age: nothing about a learner reaches the assistant.
    const enrolled = await fetchAll<{ student_person_id: string }>(
      (from, to) => db.from("pathshala_enrollments").select("student_person_id").eq("center_id", center.id).order("student_person_id").range(from, to),
      { max: MAX_MINORS },
    );
    // A role that may not read enrolments sees none (and cannot be shown a learner by a command either).
    if (enrolled.error && enrolled.error.code !== "42501") throw new Error(`could not read the learners: ${enrolled.error.message ?? "unknown error"}`);
    const learners = await inChunks<NamedPerson>(
      [...new Set((enrolled.error ? [] : enrolled.data).map((e) => e.student_person_id))].filter((id) => !minors.has(id)),
      150,
      (part) => db.from("people").select(PERSON_COLUMNS).in("id", part),
      "the learners",
    );
    for (const p of learners) minors.set(p.id, p);

    const family = await adultFamilyWords(db, [...minors.keys()], today, majority);
    const common = await communityFamilyWords(db, center.id, minors, family, today, majority);
    return [...minors.values()].map((p) => {
      const sharedWords = family.get(p.id);
      return minorNameEntry(p, common.size > 0 ? new Set([...(sharedWords ?? []), ...common]) : sharedWords);
    });
  },
};
