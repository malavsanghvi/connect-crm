// Pure helpers for the People module: labels, option lists, form parsing and
// validation for household and person edits, age bands and small copy rules.
// No server-only imports, so the forms, the actions and the tests share them.

import type { Enums } from "@/lib/database.types";

export type HouseholdRole = Enums<"person_role_in_household">;
export type Tier = Enums<"membership_tier">;

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "gu", label: "Gujarati" },
  { value: "hi", label: "Hindi" },
] as const;

/** Relationships staff can choose (the primary member is set by "Make primary", not by this chip). */
export const RELATIONSHIP_OPTIONS: { value: HouseholdRole; label: string }[] = [
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Son or daughter" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
];

const ROLES: readonly HouseholdRole[] = ["primary", "spouse", "child", "parent", "sibling", "other"];

export function isHouseholdRole(v: unknown): v is HouseholdRole {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function genderLabel(g: string | null | undefined): string {
  if (!g) return "—";
  const hit = GENDER_OPTIONS.find((o) => o.value === g.toLowerCase());
  return hit ? hit.label : g.charAt(0).toUpperCase() + g.slice(1);
}

/** Normalise stored gender strings ("F", "Female", "female") to an option value, or "" when unknown. */
export function genderValue(g: string | null | undefined): string {
  const v = (g ?? "").trim().toLowerCase();
  if (v === "f" || v === "female") return "female";
  if (v === "m" || v === "male") return "male";
  if (v === "prefer_not_to_say" || v === "prefer not to say") return "prefer_not_to_say";
  return "";
}

export function languageLabel(code: string | null | undefined): string {
  return LANGUAGE_OPTIONS.find((o) => o.value === code)?.label ?? (code || "—");
}

/** "Primary", "Spouse", "Son" / "Daughter" (child + gender), "Parent", "Sibling", "Other". */
export function relationshipLabel(role: string | null | undefined, gender?: string | null): string {
  switch (role) {
    case "primary":
      return "Primary";
    case "spouse":
      return "Spouse";
    case "child": {
      const g = genderValue(gender);
      return g === "female" ? "Daughter" : g === "male" ? "Son" : "Child";
    }
    case "parent":
      return "Parent";
    case "sibling":
      return "Sibling";
    case "other":
      return "Other";
    default:
      return "—";
  }
}

export function tierLabel(tier: string | null | undefined): string {
  if (!tier) return "None";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

/** Prototype colours: Life green, Yearly navy, Community grey. */
export function tierTone(tier: string | null | undefined): "success" | "navy" | "neutral" {
  return tier === "life" ? "success" : tier === "yearly" ? "navy" : "neutral";
}

const TIER_RANK: Record<string, number> = { life: 3, yearly: 2, community: 1 };
export function bestTier<T extends { tier: string }>(memberships: T[]): T | undefined {
  return [...memberships].sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0))[0];
}

/** "Save 2 changes" / "Save 1 change" / "No changes" (the prototype's dirty-state button). */
export function saveLabel(changes: number): string {
  if (changes <= 0) return "No changes";
  return `Save ${changes} change${changes === 1 ? "" : "s"}`;
}

/** US numbers shown as (713) 555-0142; anything else as stored. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

/** Household drawer sub-line: "Life members since 2012 · West zone · (713) 555-0142". */
export function householdSubline(h: { tier?: string | null; since?: string | null; zone?: string | null; phone?: string | null }): string {
  const parts: string[] = [];
  if (h.tier) parts.push(`${tierLabel(h.tier)} members${h.since ? ` since ${h.since.slice(0, 4)}` : ""}`);
  else parts.push("No active membership");
  if (h.zone) parts.push(`${h.zone} zone`);
  if (h.phone) parts.push(formatPhone(h.phone));
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Age bands (People list filter chips)
// ---------------------------------------------------------------------------
export const AGE_BANDS = [
  { key: "all", label: "All" },
  { key: "adults", label: "Adults" },
  { key: "minors", label: "Under 18" },
  { key: "seniors", label: "Seniors 65+" },
  { key: "roles", label: "On a team or role" },
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]["key"];

export function isAgeBand(v: unknown): v is AgeBand {
  return typeof v === "string" && AGE_BANDS.some((b) => b.key === v);
}

/** The same calendar day `years` years before `today` (YYYY-MM-DD); Feb 29 falls back to Feb 28. */
export function yearsBefore(today: string, years: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const year = y - years;
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/**
 * Date-of-birth bounds for a band. Adults: born on or before today-18y, or no
 * date of birth on file (the database treats unknown as adult). Minors: born
 * after today-18y. Seniors: born on or before today-65y.
 */
export function dobBounds(band: AgeBand, today: string): { onOrBefore?: string; after?: string; includeUnknown: boolean } {
  switch (band) {
    case "adults":
      return { onOrBefore: yearsBefore(today, 18), includeUnknown: true };
    case "minors":
      return { after: yearsBefore(today, 18), includeUnknown: false };
    case "seniors":
      return { onOrBefore: yearsBefore(today, 65), includeUnknown: false };
    default:
      return { includeUnknown: true };
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
/** Normalise a phone number to E.164. US 10-digit numbers get +1. Empty → null. */
export function normalizePhone(input: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) {
    if (digits.length >= 8 && digits.length <= 15) return { ok: true, value: `+${digits}` };
    return { ok: false, error: "The mobile number should have 8 to 15 digits after the +" };
  }
  if (digits.length === 10) return { ok: true, value: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith("1")) return { ok: true, value: `+${digits}` };
  return { ok: false, error: "Enter the mobile number with its area code, e.g. (713) 555-0142, or start with + and the country code" };
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Accepts YYYY-MM-DD or MM/DD/YYYY. Empty → null. */
export function parseDateInput(input: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const raw = input.trim();
  if (!raw) return { ok: true, value: null };
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [y, m, d] = [Number(us[3]), Number(us[1]), Number(us[2])];
  else return { ok: false, error: "Enter the date of birth as MM/DD/YYYY" };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900) {
    return { ok: false, error: "That date of birth is not a real date" };
  }
  return { ok: true, value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/** YYYY-MM-DD → MM/DD/YYYY for the form. */
export function toUsDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

type FieldMap = Record<string, string | undefined>;
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function text(v: string | undefined, max: number): string | null {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
}

export type PersonProfile = {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  profession: string | null;
  employer: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string;
  photo_opt_in: boolean;
  new_member_contact_opt_in: boolean;
  expertise_opt_in: boolean;
  expertise_headline: string | null;
};

export const PERSON_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "profession",
  "employer",
  "phone_e164",
  "email",
  "language",
  "photo_opt_in",
  "new_member_contact_opt_in",
  "expertise_opt_in",
  "expertise_headline",
] as const satisfies readonly (keyof PersonProfile)[];

/**
 * Read the person form. Fields the form did not send are left out, so a
 * minor's form (no contact fields) never blanks them. Booleans arrive as
 * "on" / "off" from hidden inputs.
 */
export function parsePersonForm(f: FieldMap, today: string): Parsed<Partial<PersonProfile>> {
  const out: Partial<PersonProfile> = {};
  if (f.first_name !== undefined) {
    const v = text(f.first_name, 80);
    if (!v) return { ok: false, error: "First name is required" };
    out.first_name = v;
  }
  if (f.last_name !== undefined) {
    const v = text(f.last_name, 80);
    if (!v) return { ok: false, error: "Last name is required" };
    out.last_name = v;
  }
  if (f.date_of_birth !== undefined) {
    const d = parseDateInput(f.date_of_birth);
    if (!d.ok) return d;
    if (d.value && d.value > today) return { ok: false, error: "The date of birth is in the future" };
    out.date_of_birth = d.value;
  }
  if (f.gender !== undefined) {
    const g = f.gender.trim();
    if (g && !GENDER_OPTIONS.some((o) => o.value === g)) return { ok: false, error: "Choose Female, Male or Prefer not to say" };
    out.gender = g || null;
  }
  if (f.profession !== undefined) out.profession = text(f.profession, 120);
  if (f.employer !== undefined) out.employer = text(f.employer, 120);
  if (f.phone_e164 !== undefined) {
    const p = normalizePhone(f.phone_e164);
    if (!p.ok) return p;
    out.phone_e164 = p.value;
  }
  if (f.email !== undefined) {
    const e = text(f.email, 200);
    if (e && !isEmail(e)) return { ok: false, error: "That email address does not look right" };
    out.email = e ? e.toLowerCase() : null;
  }
  if (f.language !== undefined) {
    if (!LANGUAGE_OPTIONS.some((o) => o.value === f.language)) return { ok: false, error: "Choose English, Gujarati or Hindi" };
    out.language = f.language;
  }
  for (const k of ["photo_opt_in", "new_member_contact_opt_in", "expertise_opt_in"] as const) {
    if (f[k] !== undefined) out[k] = f[k] === "on";
  }
  if (f.expertise_headline !== undefined) out.expertise_headline = text(f.expertise_headline, 200);
  return { ok: true, value: out };
}

export type HouseholdDetails = {
  display_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  zone_id: string | null;
  directory_opt_in: boolean;
  physical_mail_opt_in: boolean;
};

export const HOUSEHOLD_FIELDS = [
  "display_name",
  "address_line1",
  "address_line2",
  "city",
  "state_region",
  "postal_code",
  "zone_id",
  "directory_opt_in",
  "physical_mail_opt_in",
] as const satisfies readonly (keyof HouseholdDetails)[];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseHouseholdForm(f: FieldMap, zoneIds: readonly string[]): Parsed<Partial<HouseholdDetails>> {
  const out: Partial<HouseholdDetails> = {};
  if (f.display_name !== undefined) {
    const v = text(f.display_name, 120);
    if (!v) return { ok: false, error: "Household name is required" };
    out.display_name = v;
  }
  for (const k of ["address_line1", "address_line2", "city"] as const) {
    if (f[k] !== undefined) out[k] = text(f[k], 160);
  }
  if (f.state_region !== undefined) out.state_region = text(f.state_region, 40);
  if (f.postal_code !== undefined) {
    const z = text(f.postal_code, 20);
    if (z && !/^[0-9A-Za-z -]{3,10}$/.test(z)) return { ok: false, error: "The ZIP code does not look right" };
    out.postal_code = z;
  }
  if (f.zone_id !== undefined) {
    const z = f.zone_id.trim();
    if (z && (!UUID.test(z) || !zoneIds.includes(z))) return { ok: false, error: "Choose one of the center's zones" };
    out.zone_id = z || null;
  }
  for (const k of ["directory_opt_in", "physical_mail_opt_in"] as const) {
    if (f[k] !== undefined) out[k] = f[k] === "on";
  }
  return { ok: true, value: out };
}

/** Keys whose value differs (null, "" and undefined count as the same "empty"). */
export function changedKeys<T extends Record<string, unknown>>(original: T, edited: Partial<T>): (keyof T)[] {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return (Object.keys(edited) as (keyof T)[]).filter((k) => norm(edited[k]) !== norm(original[k]));
}

/** Plain-English list: "name, address and zone". */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const FIELD_LABELS: Record<string, string> = {
  first_name: "first name",
  last_name: "last name",
  date_of_birth: "date of birth",
  gender: "gender",
  profession: "profession",
  employer: "employer",
  phone_e164: "mobile",
  email: "email",
  language: "language",
  photo_opt_in: "photo consent",
  new_member_contact_opt_in: "open to new members",
  expertise_opt_in: "expertise listing",
  expertise_headline: "expertise",
  role: "relationship",
  display_name: "name",
  address_line1: "street address",
  address_line2: "address line 2",
  city: "city",
  state_region: "state",
  postal_code: "ZIP code",
  zone_id: "zone",
  directory_opt_in: "directory listing",
  physical_mail_opt_in: "physical mail",
  tier: "membership tier",
};
