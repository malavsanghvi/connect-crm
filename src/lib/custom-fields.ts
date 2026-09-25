// Custom fields (ONBOARDING_PLAN "Extra columns become custom fields"): the
// definition shape, how a value reads on screen and in exports, and how a
// typed value is read back. Pure — usable from client and server.

import { formatCents } from "@/lib/money";
import { convertCustom, DEFAULT_OPTIONS, type CustomType } from "@/lib/import/mapping";

export type CustomFieldDef = {
  id: string;
  entity: string;
  key: string;
  label: string;
  type: CustomType;
  choices: string[];
  sensitivity: "staff" | "member_self" | "directory";
  searchable: boolean;
  source: "manual" | "import";
  source_import_run: string | null;
  status: "active" | "archived";
  sort: number;
};

/** Kinds of record that carry custom fields, as staff name them. */
export const CUSTOM_ENTITY_LABELS: Record<string, string> = {
  people: "People",
  households: "Households",
  memberships: "Memberships",
  pledges: "Pledges",
  payments: "Payments",
  store_items: "Store items",
  events: "Events",
  pathshala_classes: "Pathshala classes",
  campaigns: "Campaigns",
  funds: "Funds",
  membership_types: "Membership types",
  recurring_gifts: "Recurring gifts",
  pathshala_enrollments: "Pathshala enrollments",
  volunteer_interests: "Volunteer interests",
  special_days: "Special days",
  bolis: "Bolis",
  boli_entries: "Boli results",
  attendees: "Event attendance",
};

export const SENSITIVITY_LABELS: Record<CustomFieldDef["sensitivity"], string> = {
  staff: "Staff only (never sent to members)",
  member_self: "Staff and the member themselves",
  directory: "Also in the member directory",
};

export function entityLabel(entity: string): string {
  return CUSTOM_ENTITY_LABELS[entity] ?? entity.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function asDef(row: Record<string, unknown>): CustomFieldDef {
  return {
    id: String(row.id),
    entity: String(row.entity),
    key: String(row.key),
    label: String(row.label),
    type: String(row.type) as CustomType,
    choices: Array.isArray(row.choices) ? (row.choices as unknown[]).map(String) : [],
    sensitivity: (row.sensitivity as CustomFieldDef["sensitivity"]) ?? "staff",
    searchable: Boolean(row.searchable),
    source: (row.source as CustomFieldDef["source"]) ?? "manual",
    source_import_run: (row.source_import_run as string | null) ?? null,
    status: (row.status as CustomFieldDef["status"]) ?? "active",
    sort: Number(row.sort ?? 0),
  };
}

/** A value as it reads on screen and in exports ("" when there is none). */
export function formatCustomValue(def: Pick<CustomFieldDef, "type">, value: unknown, currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "";
  switch (def.type) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "money":
      return typeof value === "number" ? formatCents(value, currency) : String(value);
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      return m ? `${m[2]}/${m[3]}/${m[1]}` : String(value);
    }
    default:
      return String(value);
  }
}

/** What an edit box holds for a value (the inverse of readCustomInput). */
export function customInputValue(def: Pick<CustomFieldDef, "type">, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (def.type === "money" && typeof value === "number") return (value / 100).toFixed(2);
  if (def.type === "boolean") return value === true ? "Yes" : value === false ? "No" : "";
  return String(value);
}

/** Read what someone typed into a typed value; blank clears. */
export function readCustomInput(def: Pick<CustomFieldDef, "type" | "choices" | "label">, input: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!input.trim()) return { ok: true, value: null };
  const res = convertCustom(def.type, input, def.choices, DEFAULT_OPTIONS);
  if (res === null) return { ok: true, value: null };
  return res.ok ? { ok: true, value: res.value } : { ok: false, error: `${def.label} ${res.error}.` };
}

/** Custom values from a row's `custom` column, in definition order, with their labels. */
export function customRows(defs: readonly CustomFieldDef[], custom: unknown): { def: CustomFieldDef; value: unknown }[] {
  const c = custom && typeof custom === "object" && !Array.isArray(custom) ? (custom as Record<string, unknown>) : {};
  return defs.filter((d) => d.status === "active" || c[d.key] !== undefined).map((def) => ({ def, value: c[def.key] }));
}
