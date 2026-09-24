// Record history (WAVE2 contract): turn app.record_history rows into a
// field-by-field "before → after" list a person can read. Pure and tested.
//
// Masking: app.audit_mask replaces date_of_birth with "***" and removes
// provider/secret references entirely, so those show as "hidden", never as
// a value and never as "removed".

import type { Json } from "@/lib/database.types";
import type { HistoryRow } from "@/lib/modules-db";
import { formatCents } from "@/lib/money";

export const MASK = "***";
/** Fields app.audit_mask removes or hides (0011_functions.sql). */
export const MASKED_FIELDS = new Set(["date_of_birth", "provider_ref", "fee_authorization_ref", "secret_ref"]);
/** Bookkeeping columns that say nothing to a reader. */
const SKIP = new Set(["id", "center_id", "created_at", "updated_at"]);

export type FieldChange = { field: string; label: string; before: string; after: string; hidden: boolean };

/** Reference columns whose ids are shown as the referenced record's name (table, name column). */
export const REFERENCE_TABLES: Record<string, { table: string; name: string }> = {
  zone_id: { table: "zones", name: "name" },
  household_id: { table: "households", name: "display_name" },
  person_id: { table: "people", name: "first_name,last_name" },
  fund_id: { table: "funds", name: "name" },
  campaign_id: { table: "campaigns", name: "name" },
  event_id: { table: "events", name: "name" },
  opportunity_id: { table: "opportunities", name: "name" },
  boli_id: { table: "bolis", name: "name" },
  class_id: { table: "pathshala_classes", name: "name" },
  term_id: { table: "pathshala_terms", name: "name" },
  inbox_id: { table: "inboxes", name: "name" },
  membership_type_id: { table: "membership_types", name: "name" },
  store_item_id: { table: "store_items", name: "name" },
  item_id: { table: "store_items", name: "name" },
  category_id: { table: "store_categories", name: "name" },
  group_id: { table: "volunteer_groups", name: "name" },
  album_id: { table: "photo_albums", name: "title" },
  goal_id: { table: "gyan_goals", name: "name" },
  layer_id: { table: "calendar_layers", name: "name" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids to look up, grouped by table, from every before/after image of the given rows. */
export function referencedIds(rows: { before: Json | null; after: Json | null }[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    for (const img of [asObject(r.before), asObject(r.after)]) {
      if (!img) continue;
      for (const [field, v] of Object.entries(img)) {
        const ref = REFERENCE_TABLES[field];
        if (!ref || typeof v !== "string" || !UUID.test(v)) continue;
        if (!out.has(ref.table)) out.set(ref.table, new Set());
        out.get(ref.table)!.add(v);
      }
    }
  }
  return out;
}

type Obj = Record<string, Json | undefined>;
function asObject(j: Json | null | undefined): Obj | null {
  return j && typeof j === "object" && !Array.isArray(j) ? (j as Obj) : null;
}

/** "write_off_reason" → "Write off reason", "amount_cents" → "Amount", "household_id" → "Household". */
export function fieldLabel(field: string): string {
  const base = field.replace(/_(cents|id)$/, "").replace(/_/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : field;
}

/** One value as plain text ("—" for empty, Yes/No, money for *_cents, compact JSON for objects). */
export function formatValue(value: Json | undefined, field = "", currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value === MASK) return "hidden";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return field.endsWith("_cents") ? formatCents(value, currency) : String(value);
  if (typeof value === "string") return value;
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/**
 * Field-by-field changes between two row images. An insert (no before) lists
 * the fields it set; a delete (no after) lists what was removed. Unchanged
 * fields and bookkeeping columns are left out.
 */
export function diffRecord(before: Json | null, after: Json | null, currency = "USD", names: Record<string, string> = {}): FieldChange[] {
  const b = asObject(before);
  const a = asObject(after);
  if (!b && !a) return [];
  const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})]);
  const out: FieldChange[] = [];
  for (const field of [...keys].sort()) {
    if (SKIP.has(field)) continue;
    const bv = b?.[field] ?? null;
    const av = a?.[field] ?? null;
    if (JSON.stringify(bv) === JSON.stringify(av)) {
      // A masked value can change without the audit log being able to show it; say nothing then.
      continue;
    }
    // Inserts: skip fields left empty. Deletes: skip fields that were empty.
    if (!b && (av === null || av === "")) continue;
    if (!a && (bv === null || bv === "")) continue;
    const hidden = MASKED_FIELDS.has(field) || bv === MASK || av === MASK;
    const show = (v: Json) =>
      v === null || v === "" ? "—" : hidden ? "hidden" : typeof v === "string" && names[v] ? names[v] : formatValue(v, field, currency);
    out.push({ field, label: fieldLabel(field), before: show(bv), after: show(av), hidden });
  }
  return out;
}

/** "payments.update" → "Changed"; function actions ("refund.approve") read as words. */
export function historyVerb(action: string): string {
  const op = action.slice(action.lastIndexOf(".") + 1);
  if (op === "insert") return "Created";
  if (op === "update") return "Changed";
  if (op === "delete") return "Deleted";
  const words = action.replace(/[._]/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : action;
}

const APPS: Record<string, string> = { portal: "Portal", member: "Member app", kiosk: "Volunteer kiosk", job: "Scheduled job" };

/** "Portal · /giving/pledges", "Member app", or null when the change carried no app. */
export function clientLabel(app: string | null | undefined, screen: string | null | undefined): string | null {
  const a = app ? (APPS[app] ?? app) : null;
  if (a && screen) return `${a} · ${screen}`;
  return a ?? (screen || null);
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Tolerant reading of app.record_history's result (the RPC may return fewer columns than the contract lists). */
export function normalizeHistoryRows(data: unknown): HistoryRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r, i) => ({
      id: typeof r.id === "number" ? r.id : Number(r.id ?? i),
      occurred_at: str(r.occurred_at) ?? "",
      actor_user_id: str(r.actor_user_id),
      actor_name: str(r.actor_name) ?? str(r.actor_display_name),
      actor_role: str(r.actor_role),
      action: str(r.action) ?? "",
      record_table: str(r.record_table),
      record_id: str(r.record_id),
      before: (r.before ?? null) as Json | null,
      after: (r.after ?? null) as Json | null,
      reason: str(r.reason),
      correlation_id: str(r.correlation_id),
      module: str(r.module),
      client_app: str(r.client_app),
      client_screen: str(r.client_screen),
    }))
    .sort((x, y) => (x.occurred_at < y.occurred_at ? 1 : x.occurred_at > y.occurred_at ? -1 : y.id - x.id));
}
