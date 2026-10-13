// The pure core of custom fields on the Family page and the person slide-over (docs/PEOPLE_NOTES_AND_FIELDS.md part 1). No server
// imports and no React: the loader (custom-load.ts) reads the database and fills these in, the components draw them, and the tests
// need no database.
//
//   - access: who may read the community's custom fields, edit a value, add a field (the gates the Settings screen and the database use)
//   - rows: the active fields of one kind of record, in their order, with each value shown the way its type reads
//   - the edit unit: a custom value as one click-to-edit thing, with its type's checks and sentences, so it runs through the same
//     state machine (Enter saves, Esc cancels, Undo, conflict) as every other value on the page
//   - the Add a field sheet: what is typed, what is checked, what is sent, and the plain-words request an admin can be sent
//   - Manage: the list with Archive and Restore
//
// Built for every organization: labels and choices come from the community's own data; nothing here names one community.

import { foldName } from "@/lib/commands/name-fold";
import { customInputValue, formatCustomValue, readCustomInput, type CustomFieldDef } from "@/lib/custom-fields";
import { CUSTOM_TYPES, type CustomType } from "@/lib/import/mapping";
import { toUsDate } from "@/lib/people";

import { agoText, type Checked, type CustomFieldKey, type EditUnit, type Values } from "./inline-edit";

// ---------------------------------------------------------------------------
// Which kind of record
// ---------------------------------------------------------------------------
export type CustomEntity = "people" | "households";

/** What the plan calls them in sentences and titles. */
export const ENTITY_WORDS: Record<CustomEntity, { one: string; every: string; plural: string }> = {
  people: { one: "person", every: "every person", plural: "people" },
  households: { one: "household", every: "every household", plural: "households" },
};

export const fieldKeyOf = (key: string): CustomFieldKey => `cf:${key}`;
export const defKeyOf = (field: string): string => (field.startsWith("cf:") ? field.slice(3) : field);

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
/** The permissions that let a role read custom fields of people and households (the database's own read gate, 0190 and 0401). */
export const CUSTOM_READ_PERMISSIONS = ["people.view", "people.manage", "settings.manage"] as const;

export type CustomAccess = {
  /** May read the community's custom fields at all. Without it the group says "You don't have access to this area". */
  canRead: boolean;
  /** May change a value (people.manage, on a record that is not merged away). Without it every value is plain text. */
  canEdit: boolean;
  /** May add, archive and restore fields: the same permission as the Settings screen (settings.manage). */
  canDefine: boolean;
};

export function customAccess(who: { permissions: readonly string[]; isPlatformAdmin?: boolean }, opts: { canEdit: boolean }): CustomAccess {
  const has = (p: string) => who.isPlatformAdmin === true || who.permissions.includes(p);
  const canRead = CUSTOM_READ_PERMISSIONS.some(has);
  return { canRead, canEdit: canRead && opts.canEdit, canDefine: canRead && has("settings.manage") };
}

/** What the link at the end of a group does: add a field (settings holders), or explain who to ask (everyone else who can see the group). */
export type AddFieldMode = "add" | "ask";

export function addFieldMode(a: Pick<CustomAccess, "canDefine">): AddFieldMode {
  return a.canDefine ? "add" : "ask";
}

export const ADD_FIELD_TEXT: Record<AddFieldMode, string> = { add: "Add a field", ask: "Ask an admin" };

export const NO_CUSTOM_ACCESS = "You don't have access to this area";

// ---------------------------------------------------------------------------
// What the server hands the page
// ---------------------------------------------------------------------------
export type DefGroup = {
  /** Active fields, in the order they show. */
  active: CustomFieldDef[];
  /** Archived fields: only read for people who may manage fields (Manage lists them with Restore). */
  archived: CustomFieldDef[];
};

export type CustomFieldsPayload =
  | { state: "no-access" }
  | { state: "error"; message: string }
  | {
      state: "ok";
      /** The community's currency, for money fields. */
      currency: string;
      /** The community's name, for the request an admin is asked to act on. */
      community: string;
      /** The kind of organization (its key picks the suggested fields, its label is shown: "Suggested for Chamber of commerce"). */
      kind: { key: string; label: string; faithBased: boolean };
      access: Pick<CustomAccess, "canEdit" | "canDefine">;
      people: DefGroup;
      households: DefGroup;
      /** The custom values the viewer may read, by record id (a person's or a household's). */
      values: Record<string, Record<string, unknown>>;
      /** Where Settings › Custom fields is, for settings holders ("Change the order there"). */
      settingsHref: string | null;
    };

export type OkPayload = Extract<CustomFieldsPayload, { state: "ok" }>;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export type CustomRowModel = {
  key: string;
  fieldKey: CustomFieldKey;
  label: string;
  type: CustomType;
  choices: string[];
  visibility: CustomFieldDef["sensitivity"];
  /** A small "Members can see this" marker: only when the definition itself says members see it. */
  membersSee: boolean;
  searchable: boolean;
  /** The value as the database holds it, in text ("" for none): dates as 2026-03-14, money as 12.50, yes/no as Yes or No. */
  stored: string;
};

/** The active fields in the order they show: by their own order, then by name. */
export function orderedDefs(defs: readonly CustomFieldDef[]): CustomFieldDef[] {
  return defs.filter((d) => d.status === "active").sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
}

export function rowsFor(defs: readonly CustomFieldDef[], custom: Record<string, unknown> | undefined): CustomRowModel[] {
  return orderedDefs(defs).map((d) => ({
    key: d.key,
    fieldKey: fieldKeyOf(d.key),
    label: d.label,
    type: d.type,
    choices: d.choices,
    visibility: d.sensitivity,
    membersSee: d.sensitivity !== "staff",
    searchable: d.searchable,
    stored: customInputValue(d, custom?.[d.key]),
  }));
}

/** The record's values as the edit machinery holds them (by "cf:" key). */
export function valuesOf(rows: readonly Pick<CustomRowModel, "fieldKey" | "stored">[]): Values {
  return Object.fromEntries(rows.map((r) => [r.fieldKey, r.stored]));
}

/** A stored value as it reads on screen: dates as MM/DD/YYYY, money in the community's currency, yes/no as words. "" when none. */
export function customDisplay(def: Pick<CustomFieldDef, "type" | "choices" | "label">, stored: string, currency: string): string {
  if (!stored) return "";
  const read = readCustomInput(def, stored);
  return formatCustomValue(def, read.ok ? read.value : stored, currency);
}

/** What the input holds when editing starts: a date reads MM/DD/YYYY, everything else as stored. */
export function customDraft(def: Pick<CustomFieldDef, "type">, stored: string): string {
  return def.type === "date" ? toUsDate(stored) || stored : stored;
}

/** Which input a type uses: a list for choice and yes/no, a plain box (with the right keyboard) for the rest. */
export type InputShape = { control: "select" | "input"; inputMode?: "decimal" | "numeric" | "email" | "tel" | "url"; placeholder: string; options: { value: string; label: string }[] };

export function inputShape(def: Pick<CustomFieldDef, "type" | "choices">, currency: string): InputShape {
  switch (def.type) {
    case "boolean":
      return {
        control: "select",
        placeholder: "Choose",
        options: [
          { value: "Yes", label: "Yes" },
          { value: "No", label: "No" },
        ],
      };
    case "choice":
      return { control: "select", placeholder: "Choose", options: def.choices.map((c) => ({ value: c, label: c })) };
    case "date":
      return { control: "input", inputMode: "numeric", placeholder: "MM/DD/YYYY", options: [] };
    case "money":
      return { control: "input", inputMode: "decimal", placeholder: `Amount in ${currency}`, options: [] };
    case "number":
      return { control: "input", inputMode: "decimal", placeholder: "A number", options: [] };
    case "email":
      return { control: "input", inputMode: "email", placeholder: "name@example.org", options: [] };
    case "phone":
      return { control: "input", inputMode: "tel", placeholder: "(555) 555-0142", options: [] };
    case "url":
      return { control: "input", inputMode: "url", placeholder: "https://", options: [] };
    default:
      return { control: "input", placeholder: "", options: [] };
  }
}

/** The invitation on an empty value ("Add Shirt size"): the field's own name, in whatever script the community wrote it. */
export const addValueText = (label: string) => `Add ${label}`;

// ---------------------------------------------------------------------------
// One value as an edit unit
// ---------------------------------------------------------------------------
/** The sentence for something typed that the field's type cannot take, in words a person reads under the box. */
export function customProblem(def: Pick<CustomFieldDef, "type" | "choices" | "label">, rawError: string): string {
  const name = `“${def.label}”`;
  switch (def.type) {
    case "date":
      return `${name} takes a date as MM/DD/YYYY, like 03/14/2026`;
    case "number":
      return `${name} takes a number, like 12 or 3.5`;
    case "money":
      return `${name} takes an amount, like 25 or 25.50`;
    case "boolean":
      return `${name} takes Yes or No`;
    case "choice":
      return def.choices.length ? `${name} takes one of: ${def.choices.join(", ")}` : `${name} has no choices yet`;
    case "email":
      return `${name} takes an email address, like name@example.org`;
    case "url":
      return `${name} takes a web address that starts with http:// or https://`;
    case "phone":
      return `${name} takes a phone number with its area code, like (713) 555-0142`;
    default:
      return rawError.startsWith(def.label) ? rawError.replace(/\.$/, "") : `${name} ${rawError.replace(/\.$/, "")}`;
  }
}

/** What was typed, as the stored text, or the sentence for a mistake. The server reads it with the same function and checks again. */
export function checkCustomDraft(def: Pick<CustomFieldDef, "type" | "choices" | "label">, typed: string): { ok: true; stored: string } | { ok: false; error: string } {
  const read = readCustomInput(def, typed);
  if (!read.ok) return { ok: false, error: customProblem(def, read.error) };
  return { ok: true, stored: read.value === null ? "" : customInputValue(def, read.value) };
}

/** The edit unit of one custom value. `fields` is its "cf:" key, so a field named "email" never meets the email column. */
export function customUnit(def: Pick<CustomFieldDef, "key" | "type" | "choices" | "label">): EditUnit {
  const field = fieldKeyOf(def.key);
  return {
    id: `custom-${def.key}`,
    label: def.label,
    fields: [field],
    needsReason: false,
    draft: (stored) => customDraft(def, stored),
    check: (draft): Checked => {
      const r = checkCustomDraft(def, draft[field] ?? "");
      return r.ok ? { ok: true, stored: { [field]: r.stored } } : { ok: false, error: r.error };
    },
  };
}

/** Two stored texts of the same field mean the same value (the conflict check): compared as the typed values they read as. */
export function sameCustom(def: Pick<CustomFieldDef, "type" | "choices" | "label">, a: string, b: string): boolean {
  if (a === b) return true;
  const ra = readCustomInput(def, a);
  const rb = readCustomInput(def, b);
  if (!ra.ok || !rb.ok) return a.trim() === b.trim();
  return JSON.stringify(ra.value) === JSON.stringify(rb.value);
}

/** "Ravi changed this a minute ago to Catering. Your change was not saved." The new value reads the way the field shows values. */
export function customConflictLine(c: { who: string | null; at: string | null; theirs: string }, now: Date): string {
  return `${c.who ?? "Someone"} changed this ${agoText(c.at, now)} to ${c.theirs || "empty"}. Your change was not saved.`;
}

/** The sentence under a field when the viewer may only look. */
export const VIEW_ONLY_TEXT = "View only";

// ---------------------------------------------------------------------------
// Children (D2)
// ---------------------------------------------------------------------------
/** A custom value about anyone under 18 is staff only and never offered to Niva. Said wherever a child's fields are drawn. */
export const CHILD_CUSTOM_NOTE = "Staff only · never sent to Niva";

// ---------------------------------------------------------------------------
// Add a field
// ---------------------------------------------------------------------------
export const TYPE_OPTIONS: readonly { value: CustomType; label: string }[] = CUSTOM_TYPES;

export const VISIBILITY_OPTIONS: readonly { value: CustomFieldDef["sensitivity"]; title: string; detail: string }[] = [
  { value: "staff", title: "Staff only", detail: "Only staff who may see this kind of record. Never sent to the member app." },
  { value: "member_self", title: "The member can see their own", detail: "Staff, and the person or household it is about, in the member app." },
  { value: "directory", title: "Shown in the member directory", detail: "Staff, and every member in the directory." },
];

export const NAME_MAX = 120;
export const CHOICES_MAX = 100;

export type NewFieldInput = {
  entity: CustomEntity;
  label: string;
  type: CustomType;
  /** Choices as typed: separated by commas, semicolons or new lines. */
  choicesText: string;
  sensitivity: CustomFieldDef["sensitivity"];
  searchable: boolean;
};

export const emptyNewField = (entity: CustomEntity): NewFieldInput => ({ entity, label: "", type: "text", choicesText: "", sensitivity: "staff", searchable: false });

/** The choices of a list as the Settings screen reads them: commas, semicolons or lines, no blanks, no repeats, at most 100. */
export function parseChoices(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, CHOICES_MAX);
}

export type NewFieldCheck = { ok: true; label: string; choices: string[] } | { ok: false; error: string; on: "label" | "choices" | "type" };

/** The same rules as the Settings screen's action (and the database), said before anything is sent. A name already in use is refused here too. */
export function checkNewField(f: NewFieldInput, existing: readonly { label: string; archived?: boolean }[]): NewFieldCheck {
  const label = f.label.trim();
  if (!label) return { ok: false, on: "label", error: "Give the field a name." };
  if (label.length > NAME_MAX) return { ok: false, on: "label", error: `Keep the name under ${NAME_MAX} characters.` };
  if (!TYPE_OPTIONS.some((t) => t.value === f.type)) return { ok: false, on: "type", error: "Choose a type." };
  const folded = foldName(label);
  const clash = existing.find((e) => foldName(e.label) === folded);
  if (clash)
    return {
      ok: false,
      on: "label",
      error: clash.archived
        ? `There is an archived field called “${clash.label}”. Restore it from Manage, or give this one another name.`
        : `There is already a field called “${clash.label}”. Use that one, or give this one another name.`,
    };
  const choices = parseChoices(f.choicesText);
  if (f.type === "choice" && choices.length === 0) return { ok: false, on: "choices", error: "A choice list needs at least one choice. Separate them with commas." };
  return { ok: true, label, choices: f.type === "choice" ? choices : [] };
}

/** The form the Settings screen's action reads (defineCustomFieldAction), so the page adds a field through the very same action. */
export function newFieldFormData(f: NewFieldInput, label: string, choices: readonly string[]): FormData {
  const fd = new FormData();
  fd.set("entity", f.entity);
  fd.set("label", label);
  fd.set("type", f.type);
  fd.set("sensitivity", f.sensitivity);
  if (f.type === "choice") fd.set("choices", choices.join(", "));
  if (f.searchable) fd.set("searchable", "on");
  return fd;
}

/** A suggestion picked from the chips fills the sheet. */
export function applySuggestion(f: NewFieldInput, s: { label: string; type: CustomType; choices?: readonly string[]; sensitivity?: CustomFieldDef["sensitivity"]; searchable?: boolean }): NewFieldInput {
  return {
    ...f,
    label: s.label,
    type: s.type,
    choicesText: (s.choices ?? []).join(", "),
    sensitivity: s.sensitivity ?? "staff",
    searchable: s.searchable ?? false,
  };
}

export function typeLabel(type: CustomType): string {
  return TYPE_OPTIONS.find((t) => t.value === type)?.label ?? type;
}

export function visibilityTitle(v: CustomFieldDef["sensitivity"]): string {
  return VISIBILITY_OPTIONS.find((o) => o.value === v)?.title ?? v;
}

/** The sheet's title: "Add a field for every person". */
export const addFieldTitle = (entity: CustomEntity) => `Add a field for ${ENTITY_WORDS[entity].every}`;

/** The undo of adding a field: archiving it (nothing is ever deleted). */
export const addedSentence = (label: string) => `Added the field “${label}”`;
export const addedUndoneSentence = (label: string) => `Archived the field “${label}”: it keeps its values but takes no new ones`;

// ---------------------------------------------------------------------------
// Ask an admin
// ---------------------------------------------------------------------------
export const ASK_ADMIN_EXPLANATION =
  "Adding a field changes what the whole organization records, so it takes the permission to change Settings. Fill this in and copy the request for an admin who has it.";

/** The request an admin can act on, in plain words (no new messaging feature: it is copied and sent however the person likes). */
export function askAdminRequest(f: NewFieldInput, o: { community: string; label?: string }): string {
  const choices = parseChoices(f.choicesText);
  const name = (o.label ?? f.label).trim() || "(the name is still to be decided)";
  const lines = [
    `Please add a custom field in Settings › Custom fields for ${o.community}.`,
    `Applies to: ${ENTITY_WORDS[f.entity].every}`,
    `Name: ${name}`,
    `Type: ${typeLabel(f.type)}${f.type === "choice" && choices.length ? ` (${choices.join(", ")})` : ""}`,
    `Who can see it: ${visibilityTitle(f.sensitivity)}`,
    `Found by the one box and usable as a list filter: ${f.searchable ? "Yes" : "No"}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Manage
// ---------------------------------------------------------------------------
export type ManageRow = { id: string; label: string; detail: string; archived: boolean; visibility: CustomFieldDef["sensitivity"] };

/** The fields of one kind for the Manage sheet: active in their order, then archived (restorable). */
export function manageRows(group: DefGroup): ManageRow[] {
  const row = (d: CustomFieldDef, archived: boolean): ManageRow => ({
    id: d.id,
    label: d.label,
    detail: [typeLabel(d.type), d.searchable ? "searchable" : null, d.source === "import" ? "from an import" : null].filter(Boolean).join(" · "),
    archived,
    visibility: d.sensitivity,
  });
  return [...orderedDefs(group.active).map((d) => row(d, false)), ...group.archived.map((d) => row(d, true)).sort((a, b) => a.label.localeCompare(b.label))];
}

/**
 * The form the Settings screen's save action reads (updateCustomFieldAction) to archive or restore a field without changing anything else
 * about it: its name, who sees it and whether it is searchable are sent back as they are, and the choices are left out (the action
 * keeps them when none are sent, so a choice that contains a comma is never split).
 */
export function statusFormData(def: Pick<CustomFieldDef, "id" | "label" | "sensitivity" | "searchable">, status: "active" | "archived"): FormData {
  const fd = new FormData();
  fd.set("id", def.id);
  fd.set("label", def.label);
  fd.set("sensitivity", def.sensitivity);
  fd.set("status", status);
  if (def.searchable) fd.set("searchable", "on");
  return fd;
}
