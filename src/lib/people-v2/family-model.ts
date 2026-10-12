// What the Family page and the person slide-over draw: plain, serialisable data (it crosses from the server to the browser) and the
// small pure helpers that build it. No server imports: the loader (family-load.ts) reads the database and fills these in; the
// tests need no database. A child is a person under the community's age of majority (D2): the loader marks them, and the model
// never carries a child's contact details, because a child has none on the page ("contact via parents").

import { formatDate } from "@/lib/dates";
import { formatPhone, genderValue, relationshipLabel, tierLabel, type HouseholdRole } from "@/lib/people";

import type { CheckContext, Values } from "./inline-edit";

export type FamilyPerson = {
  id: string;
  /** How the person is called ("Samira Hassan"): the preferred first name when there is one. */
  name: string;
  firstName: string;
  role: HouseholdRole;
  isPrimary: boolean;
  /** Under the age of majority: shown compactly, never with contact fields, never to Niva. */
  isChild: boolean;
  age: number | null;
  memberNumber: string | null;
  /** The organization's own member ids (its label comes from the community's rules). */
  orgIds: string[];
  onApp: boolean;
  deceased: boolean;
  /** Another household this person is primary of (an adult child with a household of their own). */
  alsoPrimaryOf: { id: string; number: string | null } | null;
  /** The editable values as stored: first_name, last_name, date_of_birth, gender, profession, employer, phone_e164, email, language, role. */
  values: Values;
};

export type FamilyId = { id: string; kind: string; label: string; value: string; system: string | null };

export type FamilyModel = {
  id: string;
  name: string;
  number: string | null;
  /** The organization's own household id label, from its rules ("Organization household ID" unless it named one). */
  orgLabel: string;
  /** Likewise for its member ids. */
  orgMemberLabel: string;
  orgIds: string[];
  /** The household card line, in parts (never a name alone): number, the organization's id, the adults, the place. */
  card: { number: string | null; orgIds: string[]; adults: string[]; place: string | null };
  mergedIntoId: string | null;
  membership: { tier: string; endsOn: string | null } | null;
  /** Open pledges, formatted ("$300.00"); null when the viewer may not see money or Giving is off. */
  openPledge: { text: string; cents: number } | null;
  adults: FamilyPerson[];
  children: FamilyPerson[];
  /** People in the household this role cannot read (a count only, never a name). */
  hiddenPeople: number;
  /** Stored values of the household: display_name, address lines, zone_id, directory_opt_in, physical_mail_opt_in, notes. */
  values: Values;
  zoneName: string | null;
  zones: { id: string; name: string }[];
  ids: FamilyId[];
  canEdit: boolean;
  /** Which person-level things the viewer may use. */
  can: { recordPayment: boolean; seesGiving: boolean; seesIds: boolean };
  /** What the editors need to check a draft the same way the server does. */
  check: { today: string; majority: number; languages: { value: string; label: string }[]; zoneIds: string[] };
};

export type FamilyCheck = FamilyModel["check"];

/** The part of the page's check data the editors' rules use (the language list is a choice list; the server checks it again). */
export function toCheckContext(c: FamilyCheck): CheckContext {
  return { today: c.today, zoneIds: c.zoneIds };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/** Two letters for an avatar, from the first letters of the first and last name (any script; never splits a character). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export const AVATAR_TONES = ["teal", "sun", "indigo", "green", "lavender", "blue"] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** The same person always gets the same colour. */
export function avatarTone(id: string): AvatarTone {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** "Samira & Karim Hassan": the adults of a household, first names joined when they share a last name. Never includes a child. */
export function adultsLine(adults: readonly string[]): string {
  const split = adults.map((n) => {
    const parts = n.trim().split(/\s+/);
    return { first: parts.slice(0, -1).join(" ") || parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
  });
  if (split.length === 0) return "";
  if (split.length === 1) return adults[0];
  if (split.every((s) => s.last && s.last === split[0].last))
    return `${split
      .slice(0, -1)
      .map((s) => s.first)
      .join(", ")} & ${split[split.length - 1].first} ${split[0].last}`;
  return adults.slice(0, -1).join(", ") + " & " + adults[adults.length - 1];
}

/** How many adults are on the app: "On the app: 2 of 3 adults". */
export function onAppSummary(adults: readonly { onApp: boolean }[]): { on: number; of: number; text: string } {
  const on = adults.filter((a) => a.onApp).length;
  return { on, of: adults.length, text: `On the app: ${on} of ${adults.length} ${adults.length === 1 ? "adult" : "adults"}` };
}

/** The line under a person's name: "Spouse" or "Primary", "age 43". */
export function personSubline(p: Pick<FamilyPerson, "role" | "isPrimary" | "age" | "values">): string {
  const rel = relationshipLabel(p.isPrimary ? "primary" : p.role, p.values.gender || null);
  return [rel, p.age !== null ? `age ${p.age}` : null].filter(Boolean).join(" · ");
}

type PersonRow = {
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  profession: string | null;
  employer: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
};

/** The stored values the editors start from (a missing value is ""; a legacy "F" is "female"; an email is lower case). */
export function personValues(row: PersonRow, role: string): Values {
  return {
    first_name: row.first_name ?? "",
    last_name: row.last_name ?? "",
    date_of_birth: row.date_of_birth ?? "",
    gender: genderValue(row.gender) || (row.gender ?? ""),
    profession: row.profession ?? "",
    employer: row.employer ?? "",
    phone_e164: row.phone_e164 ?? "",
    email: (row.email ?? "").toLowerCase(),
    language: row.language ?? "",
    role,
  };
}

type HouseholdRow = {
  display_name: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state_region: string | null;
  postal_code: string | null;
  zone_id: string | null;
  directory_opt_in: boolean | null;
  physical_mail_opt_in: boolean | null;
  notes: string | null;
};

export function householdValues(row: HouseholdRow): Values {
  return {
    display_name: row.display_name ?? "",
    address_line1: row.address_line1 ?? "",
    address_line2: row.address_line2 ?? "",
    city: row.city ?? "",
    state_region: row.state_region ?? "",
    postal_code: row.postal_code ?? "",
    zone_id: row.zone_id ?? "",
    directory_opt_in: row.directory_opt_in ? "on" : "off",
    // A household that never answered gets the mail (the column's default is on).
    physical_mail_opt_in: row.physical_mail_opt_in === false ? "off" : "on",
    notes: row.notes ?? "",
  };
}

/** The address as it reads on the card: "14 Maple Court", "Riverside, TX 77030". One line per row; empty rows are left out. */
export function addressLines(v: Values): string[] {
  const place = [v.city, [v.state_region, v.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [v.address_line1, v.address_line2, place].filter((l): l is string => Boolean(l));
}

/** "(713) 555-0136" or "—", for a row that is not being edited. */
export function phoneText(stored: string): string {
  return stored ? formatPhone(stored) : "";
}

export type HeaderChip = { key: string; label: string; tone: "blue" | "green" | "grey" | "sun" };

/** The status chips under the household's name: membership and when it ends, open pledges (only with giving access), and who is on the app. */
export function familyChips(model: FamilyModel, timeZone: string): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (model.membership) {
    const m = model.membership;
    chips.push({ key: "membership", tone: "blue", label: `${tierLabel(m.tier)} membership${m.endsOn ? ` · ${formatDate(m.endsOn, timeZone)}` : ""}` });
  }
  if (model.openPledge && model.openPledge.cents > 0) chips.push({ key: "pledges", tone: "sun", label: `Open pledges ${model.openPledge.text}` });
  if (model.adults.length > 0) chips.push({ key: "app", tone: "grey", label: onAppSummary(model.adults).text });
  return chips;
}

/** The tab keys the Family page offers, in order, for what the viewer may see. Events appears only with the Events module. */
export type FamilyTabKey = "giving" | "memberships" | "events" | "history";

export function familyTabs(o: { giving: boolean; events: boolean; history: boolean }): { key: FamilyTabKey; label: string }[] {
  return [
    ...(o.giving ? [{ key: "giving" as const, label: "Giving" }] : []),
    { key: "memberships" as const, label: "Memberships" },
    ...(o.events ? [{ key: "events" as const, label: "Events" }] : []),
    ...(o.history ? [{ key: "history" as const, label: "History" }] : []),
  ];
}

/** Which tab is open: the one asked for when the viewer has it (the old pledges and payments tabs open Giving, audit opens History), else the first. */
export function pickFamilyTab(asked: string | null | undefined, tabs: readonly { key: FamilyTabKey }[]): FamilyTabKey {
  const alias: Record<string, FamilyTabKey> = { pledges: "giving", payments: "giving", audit: "history" };
  const want = asked ? (alias[asked] ?? asked) : null;
  return tabs.find((t) => t.key === want)?.key ?? tabs[0]?.key ?? "memberships";
}
