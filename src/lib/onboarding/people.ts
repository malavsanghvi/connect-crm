// Onboarding steps "Members" and "Rest of the family": template, column mapping, typed validation and the
// people file the existing import tool stages. Pure (no I/O).

import { normHeader } from "@/lib/import/mapping";
import { cleanText, toDate, toE164, toEmail, type Transformed } from "@/lib/import/transforms";
import type { Group, PayerInput } from "./match";

export type PersonFieldKey =
  | "firstName" | "lastName" | "fullName" | "relationship" | "email" | "phone" | "dob" | "gender" | "language"
  | "familyId" | "memberId" | "address1" | "address2" | "city" | "state" | "zip" | "membership";

export type PersonField = { key: PersonFieldKey; label: string; required: boolean; hint: string; example: string; synonyms: string[] };

export const PERSON_FIELDS: readonly PersonField[] = [
  { key: "firstName", label: "First name", required: true, hint: "Or use Full name.", example: "Malav", synonyms: ["first", "given name", "forename"] },
  { key: "lastName", label: "Last name", required: true, hint: "Or use Full name.", example: "Sanghvi", synonyms: ["last", "surname", "family name"] },
  { key: "fullName", label: "Full name", required: false, hint: "Only when there are no separate first and last name columns.", example: "Malav Sanghvi", synonyms: ["name", "member name", "contact name"] },
  { key: "relationship", label: "Relationship", required: false, hint: "Self, spouse, child, parent, sibling, other.", example: "self", synonyms: ["relation", "role", "household role", "relationship to head"] },
  { key: "familyId", label: "Household or family ID", required: false, hint: "Rows with the same ID are one household.", example: "F-0212", synonyms: ["household id", "family id", "account id", "hh id", "household number", "family number"] },
  { key: "memberId", label: "Member ID (old system)", required: false, hint: "Your existing ID, kept as issued.", example: "0417", synonyms: ["member id", "person id", "contact id", "constituent id", "member number"] },
  { key: "email", label: "Email", required: false, hint: "Members sign in with it.", example: "malav@example.com", synonyms: ["email address", "e-mail", "primary email", "email 1"] },
  { key: "phone", label: "Mobile", required: false, hint: "", example: "281-555-0142", synonyms: ["phone", "cell", "mobile phone", "cell phone", "phone number", "phone 1"] },
  { key: "dob", label: "Birth date", required: false, hint: "Decides who is a minor.", example: "1986-04-12", synonyms: ["dob", "birthday", "date of birth", "birthdate"] },
  { key: "gender", label: "Gender", required: false, hint: "Female, male or other.", example: "male", synonyms: ["sex"] },
  { key: "language", label: "Language", required: false, hint: "English, Gujarati or Hindi.", example: "English", synonyms: ["preferred language"] },
  { key: "address1", label: "Address", required: false, hint: "Helps match the family.", example: "12 Lotus Lane", synonyms: ["address line 1", "street", "street address", "address 1"] },
  { key: "address2", label: "Address line 2", required: false, hint: "", example: "Apt 4", synonyms: ["address 2", "apt", "unit"] },
  { key: "city", label: "City", required: false, hint: "", example: "Sugar Land", synonyms: ["town"] },
  { key: "state", label: "State", required: false, hint: "", example: "TX", synonyms: ["state/province", "province", "region"] },
  { key: "zip", label: "ZIP", required: false, hint: "", example: "77478", synonyms: ["zip code", "postal code", "postcode"] },
  { key: "membership", label: "Membership type", required: false, hint: "Kept as custom data for now.", example: "Life", synonyms: ["membership", "tier", "member type", "membership level"] },
] as const;

export const personTemplateHeader = (): string[] => PERSON_FIELDS.map((f) => f.label);
export const personTemplateExample = (): string[] => PERSON_FIELDS.map((f) => f.example);

export type PersonChoice = PersonFieldKey | "custom" | "skip";

export function autoMapPersonColumns(headers: readonly string[], sampleRows: readonly (readonly string[])[]): PersonChoice[] {
  const used = new Set<PersonFieldKey>();
  return headers.map((h, i) => {
    const n = normHeader(h);
    const f =
      PERSON_FIELDS.find((x) => normHeader(x.key) === n) ??
      PERSON_FIELDS.find((x) => normHeader(x.label) === n) ??
      PERSON_FIELDS.find((x) => x.synonyms.some((s) => normHeader(s) === n));
    if (f && !used.has(f.key)) {
      used.add(f.key);
      return f.key;
    }
    return sampleRows.every((r) => !cleanText(r[i] ?? "")) ? "skip" : "custom";
  });
}

/** A name is required: first + last, or a full name. */
export function missingPersonFields(choices: readonly PersonChoice[]): string[] {
  if (choices.includes("fullName") || (choices.includes("firstName") && choices.includes("lastName"))) return [];
  return ["First name and Last name (or Full name)"];
}

export type Relationship = "primary" | "spouse" | "child" | "parent" | "sibling" | "other";

export function relationshipOf(text: string): Relationship | null {
  const s = cleanText(text).toLowerCase();
  if (!s) return null;
  if (/^(self|head|primary|member|head of household|main|me)$/.test(s)) return "primary";
  if (/husband|wife|spouse|partner/.test(s)) return "spouse";
  if (/son|daughter|child|kid|dependent/.test(s)) return "child";
  if (/father|mother|parent|grand|in-law|in law/.test(s)) return "parent";
  if (/brother|sister|sibling/.test(s)) return "sibling";
  return "other";
}

function genderOf(text: string): "female" | "male" | "other" | null {
  const s = cleanText(text).toLowerCase();
  if (!s) return null;
  if (/^(f|female|woman|girl)$/.test(s)) return "female";
  if (/^(m|male|man|boy)$/.test(s)) return "male";
  return "other";
}

function languageOf(text: string): "en" | "gu" | "hi" | null {
  const s = cleanText(text).toLowerCase();
  if (/^(en|english)/.test(s)) return "en";
  if (/^(gu|gujarati)/.test(s)) return "gu";
  if (/^(hi|hindi)/.test(s)) return "hi";
  return null;
}

export type ParsedPerson = {
  rowNo: number;
  firstName: string;
  lastName: string;
  relationship: Relationship | null;
  familyId: string | null;
  memberId: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  gender: "female" | "male" | "other" | null;
  language: "en" | "gu" | "hi" | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  membership: string | null;
  extras: Record<string, string>;
};

export type PersonProblem = { rowNo: number; column: string; level: "error" | "warning"; message: string };

const unwrap = <T,>(t: Transformed<T>): T | null => (t.ok ? t.value : null);

function splitFull(full: string): { first: string; last: string } {
  const s = cleanText(full);
  const comma = s.indexOf(",");
  if (comma > 0) return { last: s.slice(0, comma).trim(), first: s.slice(comma + 1).trim() };
  const parts = s.split(" ");
  if (parts.length === 1) return { first: "", last: parts[0]! };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

/** Check every row by what the column is. Bad optional values are dropped with a warning; a missing name stops that row. */
export function validatePeople(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  choices: readonly PersonChoice[],
  opts: { dateOrder?: "mdy" | "dmy"; rowOffset?: number; today?: string } = {},
): { rows: ParsedPerson[]; problems: PersonProblem[]; badRows: Set<number> } {
  const idx = Object.fromEntries(PERSON_FIELDS.map((f) => [f.key, choices.indexOf(f.key)])) as Record<PersonFieldKey, number>;
  const out: ParsedPerson[] = [];
  const problems: PersonProblem[] = [];
  const badRows = new Set<number>();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  rows.forEach((cells, k) => {
    const fileRow = k + 2;
    const rowNo = (opts.rowOffset ?? 0) + fileRow;
    const cell = (key: PersonFieldKey) => (idx[key] >= 0 ? cleanText(cells[idx[key]] ?? "") : "");
    const warn = (column: string, message: string) => problems.push({ rowNo: fileRow, column, level: "warning", message });
    let first = cell("firstName");
    let last = cell("lastName");
    if ((!first || !last) && cell("fullName")) {
      const f = splitFull(cell("fullName"));
      first = first || f.first;
      last = last || f.last;
    }
    if (!first && !last) {
      problems.push({ rowNo: fileRow, column: "Name", level: "error", message: "is blank" });
      badRows.add(fileRow);
      return;
    }
    let email: string | null = null;
    if (cell("email")) {
      email = unwrap(toEmail(cell("email")));
      if (!email) warn("Email", `"${cell("email")}" is not an email address; it was left out`);
    }
    let phone: string | null = null;
    if (cell("phone")) {
      phone = unwrap(toE164(cell("phone")));
      if (!phone) warn("Mobile", `"${cell("phone")}" is not a phone number; it was left out`);
    }
    let dob: string | null = null;
    if (cell("dob")) {
      dob = unwrap(toDate(cell("dob"), opts.dateOrder ?? "mdy"));
      if (!dob) warn("Birth date", `"${cell("dob")}" is not a date; it was left out`);
      else if (dob > today || dob < "1900-01-01") {
        warn("Birth date", `${dob} is not a possible birth date; it was left out`);
        dob = null;
      }
    }
    const extras: Record<string, string> = {};
    choices.forEach((c, i) => {
      if (c === "custom" && cleanText(cells[i] ?? "")) extras[cleanText(headers[i] ?? `Column ${i + 1}`)] = cleanText(cells[i] ?? "");
    });
    out.push({
      rowNo,
      firstName: first,
      lastName: last,
      relationship: relationshipOf(cell("relationship")),
      familyId: cell("familyId") || null,
      memberId: cell("memberId") || null,
      email,
      phone,
      dob,
      gender: genderOf(cell("gender")),
      language: languageOf(cell("language")),
      address1: cell("address1") || null,
      address2: cell("address2") || null,
      city: cell("city") || null,
      state: cell("state") || null,
      zip: cell("zip") || null,
      membership: cell("membership") || null,
      extras,
    });
  });
  return { rows: out, problems, badRows };
}

export function personToInput(p: ParsedPerson): PayerInput {
  return {
    rowNo: p.rowNo,
    name: `${p.firstName} ${p.lastName}`.trim(),
    email: p.email,
    phone: p.phone,
    address1: p.address1,
    address2: p.address2,
    zip: p.zip,
    groupKey: p.familyId ? `fam:${p.familyId}` : null,
  };
}

export type PeopleFile = { headers: string[]; rows: string[][] };

/**
 * One row per person. In each household exactly one person is primary: the one the file calls primary/self,
 * else the first listed member. Everyone else keeps the relationship the file gave, or "other".
 */
export function buildPeopleFile(groups: readonly Group[], people: readonly ParsedPerson[], householdId: (g: Group) => string): PeopleFile {
  const byRow = new Map(people.map((p) => [p.rowNo, p]));
  const extraHeaders = [...new Set(people.flatMap((p) => [...(p.membership ? ["Membership type"] : []), ...Object.keys(p.extras)]))];
  const headers = ["Person ID (old system)", "Household ID (old system)", "Relationship", "Primary contact", "First name", "Last name", "Birth date", "Gender", "Email", "Mobile", "Language", ...extraHeaders];
  const out: string[][] = [];
  let seq = 0;
  for (const g of groups) {
    const members = g.rows.map((n) => byRow.get(n)).filter((p): p is ParsedPerson => !!p);
    if (members.length === 0) continue;
    const primary = members.find((m) => m.relationship === "primary") ?? members[0]!;
    for (const m of members) {
      seq++;
      const isPrimary = m === primary;
      const rel = isPrimary ? "primary" : m.relationship && m.relationship !== "primary" ? m.relationship : "other";
      out.push([
        m.memberId ? `ONB-M-${m.memberId}` : `ONB-M-${String(seq).padStart(6, "0")}`,
        householdId(g),
        rel,
        isPrimary ? "Yes" : "No",
        m.firstName || m.lastName,
        m.firstName ? m.lastName || m.firstName : m.lastName,
        m.dob ?? "",
        m.gender ?? "",
        m.email ?? "",
        m.phone ?? "",
        m.language ?? "",
        ...extraHeaders.map((h) => (h === "Membership type" ? (m.membership ?? "") : (m.extras[h] ?? ""))),
      ]);
    }
  }
  return { headers, rows: out };
}
