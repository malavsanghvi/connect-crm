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

import { todayInTz, ageOn } from "@/lib/dates";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import type { AppSupabase } from "@/lib/supabase/server";

export const CHILD_NAME_REPLACEMENT = "[a child: not shown]";

/** Whoever can say which names in a community belong to people under 18 (a database lookup in the app, a list in tests). */
export interface MinorNameSource {
  /** Full names ("Zoya Shah"), preferred and legal, of people under 18. Throws if it cannot tell: the result is then withheld. */
  namesOfMinors(session: { db: AppSupabase; center: { id: string; time_zone: string } }): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Who counts as an adult
// ---------------------------------------------------------------------------
const ADULT_ROLES = new Set(["primary", "spouse", "parent"]);

/**
 * A household member is an adult when their birth date says they are 18 or more. With no birth date on file the household role
 * decides, and only the roles of a head, spouse or parent count: a "child", "sibling" or "other" with no birth date is treated as
 * a child (D2 errs on the side of withholding).
 */
export function isAdultMember(member: { date_of_birth: string | null | undefined; role?: string | null }, today: string): boolean {
  const age = ageOn(member.date_of_birth, today);
  if (age !== null) return age >= 18;
  return ADULT_ROLES.has((member.role ?? "").toLowerCase());
}

/**
 * A household's display name ("Shah, Priya, Rahul & Zoya") without the first names of its members under 18. Names are matched as
 * whole words; separators left dangling are tidied. Null when nothing is left.
 */
export function householdNameWithoutChildren(name: string | null, minorFirstNames: readonly string[]): string | null {
  if (!name) return name;
  const minors = new Set(minorFirstNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  if (minors.size === 0) return name;
  // Split into words and the separators between them; drop the words that are a child's first name.
  const parts = name.split(/([\p{L}\p{N}'’.-]+)/u);
  let removedAny = false;
  for (let i = 1; i < parts.length; i += 2) {
    if (minors.has(parts[i].toLowerCase())) {
      parts[i] = "";
      removedAny = true;
    }
  }
  if (!removedAny) return name;
  const out = parts
    .join("")
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

/** True when a record says, by its own fields, that it is about a person under 18 or a learner. */
function describesMinor(o: Record<string, unknown>, today: string): boolean {
  for (const [rawKey, value] of Object.entries(o)) {
    const k = snake(rawKey);
    if (CHILD_FLAG_KEYS.has(k) && value === true) return true;
    if (LEARNER_ID_KEYS.has(k) && value !== null && value !== undefined && value !== "") return true;
    if (ROLE_KEYS.has(k) && typeof value === "string" && CHILD_ROLE_WORDS.has(value.trim().toLowerCase())) return true;
    if (AGE_KEYS.has(k) && typeof value === "number" && value >= 0 && value < 18) return true;
    if (BIRTH_KEYS.has(k) && typeof value === "string") {
      const age = ageOn(value.slice(0, 10), today);
      if (age !== null && age < 18) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------
function fold(text: string): string {
  // Accents on Latin letters are ignored; the marks of other scripts (Gujarati, Hindi vowel signs) are part of the letters and stay.
  return text.normalize("NFKC").normalize("NFD").replace(/(?<=\p{Script=Latin})\p{M}+/gu, "").toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A matcher for whole-word, case-insensitive occurrences of any of these full names (two words or more). */
export function nameMatcher(names: Iterable<string>): RegExp | null {
  const unique = new Set<string>();
  for (const n of names) {
    const t = n.replace(/\s+/g, " ").trim();
    if (t.split(" ").length >= 2) unique.add(t);
  }
  if (unique.size === 0) return null;
  const parts = [...unique].sort((a, b) => b.length - a.length).map((n) => escapeRegExp(n).replace(/ /g, "\\s+"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

export type ChildFilterOptions = {
  /** Full names of the community's minors. */
  minorNames?: Iterable<string>;
  /** Today's date in the community's time zone (YYYY-MM-DD). */
  today?: string;
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
  const matcher = nameMatcher(opts.minorNames ?? []);
  let removed = 0;

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!matcher) return v;
      matcher.lastIndex = 0;
      return v.replace(matcher, () => {
        removed += 1;
        return CHILD_NAME_REPLACEMENT;
      });
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
      if (describesMinor(o, today)) {
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

/** The minors' names that still appear in `value` (compared without case or accents). Empty means clean. */
export function leakedMinorNames(value: unknown, minorNames: Iterable<string>): string[] {
  const names = [...new Set([...minorNames].map((n) => n.replace(/\s+/g, " ").trim()).filter((n) => n.split(" ").length >= 2))];
  if (names.length === 0) return [];
  const haystack = fold(JSON.stringify(value) ?? "");
  const leaked: string[] = [];
  for (const name of names) {
    const matcher = nameMatcher([fold(name)]);
    if (matcher && matcher.test(haystack)) leaked.push(name);
  }
  return leaked;
}

// ---------------------------------------------------------------------------
// The community's minors, from the database
// ---------------------------------------------------------------------------
const MAX_MINORS = 20_000;

function eighteenYearsAgo(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y - 18, m - 1, d)).toISOString().slice(0, 10);
}

type NamedPerson = { first_name: string; last_name: string; preferred_name: string | null };

function namesOf(p: NamedPerson): string[] {
  const out = [`${p.first_name} ${p.last_name}`];
  if (p.preferred_name && p.preferred_name.trim() && p.preferred_name.trim() !== p.first_name.trim()) out.push(`${p.preferred_name.trim()} ${p.last_name}`);
  return out;
}

/**
 * The names of everyone under 18 the signed-in person's role can see: born in the last 18 years, or listed as a child of a
 * household with no birth date on file. RLS decides what comes back, so a person who may not see people gets an empty list
 * (and then no command can show them a person either).
 */
export const databaseMinorNames: MinorNameSource = {
  async namesOfMinors(session) {
    const today = todayInTz(session.center.time_zone);
    const cutoff = eighteenYearsAgo(today);
    const { db, center } = session;
    const byBirth = await fetchAll<NamedPerson>(
      (from, to) =>
        db
          .from("people")
          .select("first_name, last_name, preferred_name")
          .eq("center_id", center.id)
          .gt("date_of_birth", cutoff)
          .order("id")
          .range(from, to),
      { max: MAX_MINORS },
    );
    if (byBirth.error) throw new Error(`could not read the people under 18: ${byBirth.error.message ?? "unknown error"}`);
    if (byBirth.truncated) throw new Error("there are too many people under 18 to check");
    const names = byBirth.data.flatMap(namesOf);

    const children = await fetchAll<{ person_id: string }>(
      (from, to) =>
        db.from("household_members").select("person_id").eq("center_id", center.id).eq("role", "child").is("left_at", null).order("person_id").range(from, to),
      { max: MAX_MINORS },
    );
    if (children.error) throw new Error(`could not read the children of households: ${children.error.message ?? "unknown error"}`);
    for (const ids of chunk([...new Set(children.data.map((c) => c.person_id))])) {
      const res = await db.from("people").select("first_name, last_name, preferred_name").in("id", ids).is("date_of_birth", null);
      if (res.error) throw new Error(`could not read the children of households: ${res.error.message ?? "unknown error"}`);
      names.push(...(res.data ?? []).flatMap(namesOf));
    }
    return [...new Set(names)];
  },
};
