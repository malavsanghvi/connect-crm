// The pure core of the editable "given by the member" rows in the person slide-over's Profile section (docs/PEOPLE_REDESIGN.md
// sections 4, 5 and 7): the wedding anniversary, dietary needs and the emergency contact. No server imports and no React: the same
// checks run in the browser (so a mistake shows under the field before anything is sent) and in the Server Action (which checks the
// shape again; the database function app.staff_save_profile_details, migration 0723, and its check trigger are the real gate), and
// the tests need no database.
//
//   - groups: which of the three a person has (a child has no anniversary), and the words for each
//   - values: the details as the edit machinery holds them (text by field name; the dietary choices as "key,key")
//   - edit units: each group as one click-to-edit thing with its own checks, so it runs through the same state machine as every
//     other value on the page (Enter saves, Esc cancels, Undo, conflict)
//   - the patch: what the browser's values become when sent to the database function (an absent key is left alone, null clears)
//   - the shape check, the comparison used for conflicts, and the sentences
//
// Built for every organization: the dietary choices are the community's own list (labels come from its data); nothing here names a
// community, a faith or a language. The checks repeat the database's own rules in the database's own words, so a mistake reads the
// same whether the browser or the database finds it.

import { formatPhone, normalizePhone, parseDateInput, toUsDate } from "@/lib/people";
import { dietaryChoices, emergencyContactLine, humanizeKey, type DietaryOptionRow } from "@/lib/profile-details";

import { agoText, type Checked, type EditUnit, type ProfileFieldKey, type Values } from "./inline-edit";

// ---------------------------------------------------------------------------
// The fields and the limits (the table's own: migration 0546)
// ---------------------------------------------------------------------------
export const PROFILE_KEYS = [
  "anniversary",
  "dietary",
  "dietary_other",
  "emergency_contact_name",
  "emergency_contact_relationship",
  "emergency_contact_phone",
] as const satisfies readonly ProfileFieldKey[];

export const NOTE_MAX = 200;
export const CONTACT_NAME_MAX = 120;
export const CONTACT_RELATIONSHIP_MAX = 60;
export const CHOICES_MAX = 20;
/** The longest value any request may carry for one field (a guard on the request, not a rule of the data). */
export const VALUE_CAP = 2000;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The database's own sentence for a half-filled contact, so the browser and the database say the same thing. */
export const PAIR_SENTENCE = "An emergency contact needs both a name and a mobile number. Fill in both, or leave the emergency contact blank.";

const charCount = (s: string) => [...s].length;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
export type ProfileGroup = "anniversary" | "dietary" | "emergency";

/** The groups a person has: an anniversary is for adults only, so a child has dietary needs and an emergency contact. */
export function profileGroups(isChild: boolean): ProfileGroup[] {
  return isChild ? ["dietary", "emergency"] : ["anniversary", "dietary", "emergency"];
}

/** The fields saved together as one group. */
export const GROUP_FIELDS: Record<ProfileGroup, readonly ProfileFieldKey[]> = {
  anniversary: ["anniversary"],
  dietary: ["dietary", "dietary_other"],
  emergency: ["emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone"],
};

export const GROUP_LABEL: Record<ProfileGroup, string> = { anniversary: "Anniversary", dietary: "Dietary needs", emergency: "Emergency contact" };
export const GROUP_PLACEHOLDER: Record<ProfileGroup, string> = {
  anniversary: "Add an anniversary",
  dietary: "Add dietary needs",
  emergency: "Add an emergency contact",
};
/** How each group reads in a sentence: "Saved Samira's dietary needs". */
export const GROUP_UNIT_LABEL: Record<ProfileGroup, string> = { anniversary: "wedding anniversary", dietary: "dietary needs", emergency: "emergency contact" };

export const PRIVATE_NOTE = "Dietary and emergency details are private: use them only for the event or emergency in hand.";

// ---------------------------------------------------------------------------
// What the loader hands the editor, and the values
// ---------------------------------------------------------------------------
export type DietaryOption = DietaryOptionRow;

/** What the editor needs beyond the read-only lines: the keys (not the labels) the person has, their note, and the community's list. */
export type ProfileEditFacts = { dietaryKeys: string[]; dietaryOther: string; options: DietaryOption[] };

export function csvKeys(csv: string | null | undefined): string[] {
  return [...new Set((csv ?? "").split(",").map((k) => k.trim()).filter(Boolean))];
}

export type ProfileSource = {
  anniversary: string | null;
  emergency: { name: string; relationship: string | null; phone: string } | null;
  edit: Pick<ProfileEditFacts, "dietaryKeys" | "dietaryOther">;
};

/** The person's details as the edit machinery holds them: text by field name, "" for nothing recorded, dietary as "key,key". */
export function profileValues(src: ProfileSource): Values {
  return {
    anniversary: src.anniversary ?? "",
    dietary: src.edit.dietaryKeys.join(","),
    dietary_other: src.edit.dietaryOther ?? "",
    emergency_contact_name: src.emergency?.name ?? "",
    emergency_contact_relationship: src.emergency?.relationship ?? "",
    emergency_contact_phone: src.emergency?.phone ?? "",
  };
}

/** A row of app.person_profile_details as the database returns it. */
export type ProfileRow = {
  anniversary?: string | null;
  dietary?: string[] | null;
  dietary_other?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_relationship?: string | null;
  emergency_contact_phone?: string | null;
};

/** The same values from the row itself (null: the person has none yet, so everything is empty). */
export function rowValues(row: ProfileRow | null | undefined): Values {
  return {
    anniversary: row?.anniversary ?? "",
    dietary: (row?.dietary ?? []).join(","),
    dietary_other: row?.dietary_other ?? "",
    emergency_contact_name: row?.emergency_contact_name ?? "",
    emergency_contact_relationship: row?.emergency_contact_relationship ?? "",
    emergency_contact_phone: row?.emergency_contact_phone ?? "",
  };
}

// ---------------------------------------------------------------------------
// The checks (each repeats the database's rule in the database's words)
// ---------------------------------------------------------------------------
export type CheckInput = {
  /** Today in the community's time zone, YYYY-MM-DD. */
  today: string;
  /** The person's birth date (YYYY-MM-DD) when known: an anniversary has to come after it. */
  birthDate: string | null;
  isChild: boolean;
  options: readonly DietaryOption[];
  /** The keys the person already has: a choice the community switched off since stays until it is taken away. */
  currentKeys: readonly string[];
};

const bad = (error: string): Checked => ({ ok: false, error });

export function checkAnniversary(raw: string, c: Pick<CheckInput, "today" | "birthDate" | "isChild">): Checked {
  const t = raw.trim();
  if (!t) return { ok: true, stored: { anniversary: "" } };
  if (c.isChild) return bad("A wedding anniversary can only be recorded for an adult.");
  const parsed = parseDateInput(t);
  if (!parsed.ok || !parsed.value) return bad("Enter the wedding anniversary as MM/DD/YYYY, for example 06/20/2009. It has to be a real date.");
  const iso = parsed.value;
  if (c.today && iso > c.today) return bad("The wedding anniversary cannot be in the future.");
  if (c.birthDate && iso <= c.birthDate) return bad("The wedding anniversary has to be after the birth date. Check the year.");
  return { ok: true, stored: { anniversary: iso } };
}

export function checkDietary(draft: Values, c: Pick<CheckInput, "options" | "currentKeys">): Checked {
  const keys = csvKeys(draft.dietary);
  if (keys.length > CHOICES_MAX) return bad(`Choose at most ${CHOICES_MAX} dietary needs.`);
  const offered = new Set(c.options.filter((o) => o.active).map((o) => o.key));
  const kept = new Set(c.currentKeys);
  if (keys.some((k) => !KEY_PATTERN.test(k) || !(offered.has(k) || kept.has(k)))) return bad("One of the choices is not on the community's list. Choose from the list.");
  const note = (draft.dietary_other ?? "").trim();
  if (note && !keys.includes("other")) return bad('Choose "Other" to add a note of your own.');
  if (charCount(note) > NOTE_MAX) return bad(`The note can be at most ${NOTE_MAX} characters.`);
  return { ok: true, stored: { dietary: keys.join(","), dietary_other: note } };
}

export function checkEmergency(draft: Values): Checked {
  const name = (draft.emergency_contact_name ?? "").trim();
  const relationship = (draft.emergency_contact_relationship ?? "").trim();
  const raw = (draft.emergency_contact_phone ?? "").trim();
  if (charCount(name) > CONTACT_NAME_MAX) return bad(`The name can be at most ${CONTACT_NAME_MAX} characters.`);
  if (charCount(relationship) > CONTACT_RELATIONSHIP_MAX) return bad(`How they are related can be at most ${CONTACT_RELATIONSHIP_MAX} characters.`);
  if (!name && !relationship && !raw) return { ok: true, stored: { emergency_contact_name: "", emergency_contact_relationship: "", emergency_contact_phone: "" } };
  if (!name || !raw) return bad(PAIR_SENTENCE);
  const phone = normalizePhone(raw);
  if (!phone.ok) return bad(phone.error);
  if (!phone.value || !E164.test(phone.value)) return bad("The mobile number must include the country code, for example +17135550142.");
  return { ok: true, stored: { emergency_contact_name: name, emergency_contact_relationship: relationship, emergency_contact_phone: phone.value } };
}

// ---------------------------------------------------------------------------
// The edit units
// ---------------------------------------------------------------------------
/** Each group as one click-to-edit thing. They are not columns of the person, so they bring their own checks (like a custom value). */
export function profileUnits(c: CheckInput): Record<ProfileGroup, EditUnit> {
  return {
    anniversary: {
      id: "profile-anniversary",
      label: GROUP_UNIT_LABEL.anniversary,
      fields: GROUP_FIELDS.anniversary,
      needsReason: false,
      draft: (stored) => toUsDate(stored),
      check: (draft) => checkAnniversary(draft.anniversary ?? "", c),
    },
    dietary: {
      id: "profile-dietary",
      label: GROUP_UNIT_LABEL.dietary,
      fields: GROUP_FIELDS.dietary,
      needsReason: false,
      check: (draft) => checkDietary(draft, c),
    },
    emergency: {
      id: "profile-emergency",
      label: GROUP_UNIT_LABEL.emergency,
      fields: GROUP_FIELDS.emergency,
      needsReason: false,
      // A US number is typed the way people write it; anything else as it is stored. (The same function serves the name fields, which never look like a number.)
      draft: (stored) => (E164.test(stored) ? formatPhone(stored) : stored),
      check: (draft) => checkEmergency(draft),
    },
  };
}

// ---------------------------------------------------------------------------
// Choosing dietary needs
// ---------------------------------------------------------------------------
export type DietaryChip = { key: string; label: string; selected: boolean; /** The community switched it off, or it is no longer in the list. */ retired: boolean };

/**
 * The chips of the editor: the community's offered choices in its own order, then any choice the person has (or has just picked)
 * that is no longer offered, so nothing they were given disappears and each can be taken away.
 */
export function dietaryChips(options: readonly DietaryOption[], currentKeys: readonly string[], draftCsv: string): DietaryChip[] {
  const picked = new Set(csvKeys(draftCsv));
  const offered = options.filter((o) => o.active);
  const chips: DietaryChip[] = offered.map((o) => ({ key: o.key, label: o.label, selected: picked.has(o.key), retired: false }));
  const shown = new Set(offered.map((o) => o.key));
  const labelOf = new Map(options.map((o) => [o.key, o.label]));
  for (const key of [...currentKeys, ...picked]) {
    if (shown.has(key)) continue;
    shown.add(key);
    chips.push({ key, label: labelOf.get(key) ?? humanizeKey(key), selected: picked.has(key), retired: true });
  }
  return chips;
}

/** Picking or dropping one choice. Dropping "Other" drops its note with it (a note needs "Other"). */
export function toggleChoice(v: { dietary: string; dietary_other: string }, key: string): { dietary: string; dietary_other: string } {
  const keys = csvKeys(v.dietary);
  if (keys.includes(key)) return { dietary: keys.filter((k) => k !== key).join(","), dietary_other: key === "other" ? "" : v.dietary_other };
  return { dietary: [...keys, key].join(","), dietary_other: v.dietary_other };
}

// ---------------------------------------------------------------------------
// The patch (what the database function receives)
// ---------------------------------------------------------------------------
export type ProfilePatch = Partial<Record<ProfileFieldKey, string | string[] | null>>;

/**
 * The browser's values as the function's patch: only the fields that were sent (a field that is absent is left alone), an empty one
 * as null (which clears it), the dietary choices as a list. Anything that is not one of the six fields is dropped.
 */
export function encodePatch(fields: Values): ProfilePatch {
  const out: ProfilePatch = {};
  for (const key of PROFILE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    const v = (fields[key] ?? "").trim();
    out[key] = key === "dietary" ? (v ? csvKeys(v) : null) : v === "" ? null : v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The shape of a request from the browser
// ---------------------------------------------------------------------------
export type ProfileRequest = { fields: Values; expect: Values; reason?: string | null; label: string };

/** A sentence for what is wrong with the shape of a request (it is checked again by the database), or null when it can be tried. */
export function profileShapeProblem(i: unknown): string | null {
  if (!i || typeof i !== "object") return "the request was not understood";
  const r = i as Partial<ProfileRequest>;
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  if (!text(r.label, 120)) return "the request was not understood";
  if (r.reason !== undefined && r.reason !== null && !text(r.reason, VALUE_CAP)) return "the reason is too long";
  for (const [name, bag] of [
    ["fields", r.fields],
    ["expect", r.expect],
  ] as const) {
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) return "the request was not understood";
    for (const [k, v] of Object.entries(bag)) {
      if (!(PROFILE_KEYS as readonly string[]).includes(k)) return `${name === "fields" ? "that detail" : "the value you saw"} (${k}) cannot be changed here`;
      if (!text(v, VALUE_CAP)) return "a value is too long";
    }
  }
  const fields = r.fields as Values;
  if (Object.keys(fields).length === 0) return "there was nothing to change";
  if (fields.anniversary && !ISO_DATE.test(fields.anniversary)) return "the date was not understood";
  if (fields.dietary && (csvKeys(fields.dietary).length > CHOICES_MAX || csvKeys(fields.dietary).some((k) => !KEY_PATTERN.test(k)))) return "a dietary choice was not understood";
  if (fields.emergency_contact_phone && !E164.test(fields.emergency_contact_phone)) return "the mobile number must include the country code, for example +17135550142";
  return null;
}

// ---------------------------------------------------------------------------
// Comparing (the conflict check)
// ---------------------------------------------------------------------------
/** Two stored values mean the same: nothing and "" are the same; the dietary choices are the same whatever order they are in. */
export function sameProfileValue(key: string, a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (key === "dietary") return csvKeys(x).sort().join(",") === csvKeys(y).sort().join(",");
  return x === y;
}

/** Of the fields about to change, the ones whose current value is no longer the value the person saw. Nothing seen: nothing to compare. */
export function profileConflictKeys(expect: Values | null | undefined, current: Values, changing: readonly string[]): string[] {
  if (!expect) return [];
  return changing.filter((k) => Object.prototype.hasOwnProperty.call(expect, k) && !sameProfileValue(k, current[k], expect[k]));
}

/** True when every field asked for is already what is there. */
export function nothingToChange(fields: Values, current: Values): boolean {
  return Object.keys(fields).every((k) => sameProfileValue(k, current[k], fields[k]));
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------
/** The group a field belongs to. */
export function groupOf(key: string): ProfileGroup | null {
  if (key === "anniversary") return "anniversary";
  if (key === "dietary" || key === "dietary_other") return "dietary";
  if (key.startsWith("emergency_contact_")) return "emergency";
  return null;
}

export function anniversaryText(stored: string): string {
  return stored ? toUsDate(stored) || stored : "";
}

/** "Vegetarian, Nut allergy", with the member's own words under Other and a switched-off choice marked. */
export function dietaryText(csv: string, other: string, options: readonly DietaryOption[]): string {
  return dietaryChoices(csvKeys(csv), options, other)
    .map((c) => (c.retired ? `${c.label} (no longer offered)` : c.label))
    .join(", ");
}

/** "Layla Haddad (sister) · (713) 555-0100". */
export function emergencyText(v: Values): string {
  const name = emergencyContactLine(v.emergency_contact_name, v.emergency_contact_relationship);
  if (!name) return "";
  const phone = formatPhone(v.emergency_contact_phone);
  return phone ? `${name} · ${phone}` : name;
}

/** A group's values as they read on the screen ("" when nothing is recorded). */
export function describeGroup(group: ProfileGroup, v: Values, options: readonly DietaryOption[]): string {
  switch (group) {
    case "anniversary":
      return anniversaryText(v.anniversary ?? "");
    case "dietary":
      return dietaryText(v.dietary ?? "", v.dietary_other ?? "", options);
    case "emergency":
      return emergencyText(v);
  }
}

/** "Ravi changed this a minute ago to Vegan. Your change was not saved." */
export function profileConflictLine(c: { who: string | null; at: string | null; theirs: string }, now: Date): string {
  return `${c.who ?? "Someone"} changed this ${agoText(c.at, now)} to ${c.theirs || "empty"}. Your change was not saved.`;
}
