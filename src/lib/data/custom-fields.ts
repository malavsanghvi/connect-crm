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

/** One record's custom values (the row's `custom` column), read under the caller's RLS. */
export async function loadCustomValues(db: AppSupabase, table: string, id: string): Promise<{ custom: Record<string, unknown> | null; error: DbErrorLike | null }> {
  const { data, error } = await (db as unknown as AppSupabase).from(table as "people").select("custom").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[custom fields] could not load the values of ${table} ${id}:`, error);
    return { custom: null, error };
  }
  const c = (data as { custom?: unknown } | null)?.custom;
  return { custom: c && typeof c === "object" && !Array.isArray(c) ? (c as Record<string, unknown>) : {}, error: null };
}

/** The `custom` column of several rows (for a list column), read under the caller's RLS. */
export async function loadCustomColumn(db: AppSupabase, table: "people" | "households", ids: string[]): Promise<{ map: Map<string, Record<string, unknown>>; error: DbErrorLike | null }> {
  const map = new Map<string, Record<string, unknown>>();
  if (ids.length === 0) return { map, error: null };
  const { data, error } = await db.from(table).select("id, custom").in("id", ids.slice(0, 500));
  if (error) {
    console.error(`[custom fields] could not load the ${table} list column:`, error);
    return { map, error };
  }
  for (const r of (data ?? []) as { id: string; custom: unknown }[]) {
    map.set(r.id, r.custom && typeof r.custom === "object" && !Array.isArray(r.custom) ? (r.custom as Record<string, unknown>) : {});
  }
  return { map, error: null };
}
