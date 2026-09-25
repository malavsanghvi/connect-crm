import "server-only";

import { asDef, type CustomFieldDef } from "@/lib/custom-fields";
import type { DbErrorLike } from "@/lib/errors";
import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";
import type { AppSupabase } from "@/lib/supabase/server";

export type LoadedDefs = { defs: CustomFieldDef[]; error: DbErrorLike | null; missing: boolean };

/** The center's custom field definitions (optionally for one kind of record), in order. */
export async function loadCustomFieldDefs(db: AppSupabase, centerId: string, entity?: string, includeArchived = false): Promise<LoadedDefs> {
  let q = db
    .from("custom_field_definitions")
    .select("id, entity, key, label, type, choices, sensitivity, searchable, source, source_import_run, status, sort")
    .eq("center_id", centerId)
    .order("entity")
    .order("sort")
    .order("label");
  if (entity) q = q.eq("entity", entity);
  if (!includeArchived) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) {
      warnMissingOnce("app.custom_field_definitions", error);
      return { defs: [], error: null, missing: true };
    }
    console.error("[custom fields] could not load definitions:", error);
    return { defs: [], error, missing: false };
  }
  return { defs: (data ?? []).map((r) => asDef(r as Record<string, unknown>)), error: null, missing: false };
}

type CustomMap = Map<string, Record<string, unknown>>;

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Several records' full custom values as the caller may see them (app.custom_values, 0401):
 * the record's own values plus, for staff who may read that kind of record, the staff-only
 * values the database keeps apart so members never receive them. Runs under the caller's RLS.
 */
export async function loadCustomMap(db: AppSupabase, entity: string, ids: string[]): Promise<{ map: CustomMap; error: DbErrorLike | null }> {
  const map: CustomMap = new Map();
  const want = [...new Set(ids)].slice(0, 1000);
  if (want.length === 0) return { map, error: null };
  const { data, error } = await db.rpc("custom_values", { p_entity: entity, p_ids: want });
  if (error) {
    console.error(`[custom fields] could not load the custom values of ${entity}:`, error);
    return { map, error };
  }
  for (const r of data ?? []) map.set(r.record_key, asObject(r.custom));
  return { map, error: null };
}

/** One record's custom values (every one the caller may see). */
export async function loadCustomValues(db: AppSupabase, table: string, id: string): Promise<{ custom: Record<string, unknown> | null; error: DbErrorLike | null }> {
  const { map, error } = await loadCustomMap(db, table, [id]);
  if (error) return { custom: null, error };
  return { custom: map.get(id) ?? {}, error: null };
}

/** The custom values of several rows (for a list column). */
export async function loadCustomColumn(db: AppSupabase, table: "people" | "households", ids: string[]): Promise<{ map: CustomMap; error: DbErrorLike | null }> {
  return loadCustomMap(db, table, ids.slice(0, 500));
}

/**
 * Rows read with their `custom` column, with the staff-only values added (for record tables
 * that show "More details" per row). On a failure the rows keep what they had and the error is
 * returned for the page to show.
 */
export async function withCustomValues<R extends { id: string; custom?: unknown }>(
  db: AppSupabase,
  entity: string,
  rows: R[],
): Promise<{ rows: R[]; error: DbErrorLike | null }> {
  if (rows.length === 0) return { rows, error: null };
  const { map, error } = await loadCustomMap(db, entity, rows.map((r) => r.id));
  if (error) return { rows, error };
  return { rows: rows.map((r) => ({ ...r, custom: map.get(r.id) ?? asObject(r.custom) })), error: null };
}
