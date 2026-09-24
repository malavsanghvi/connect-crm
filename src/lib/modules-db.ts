// Hand-written types for the WAVE2 module + traceability database surface
// (app.modules, app.center_modules, app.my_modules, app.set_module_enabled,
// app.record_history and the new audit_log columns). They are added by the
// s-core migrations (0100–0109); until those land and database.types.ts is
// regenerated, this file is the portal's view of them. Delete it once the
// generated types carry the same names.
//
// Every call here is defensive: when the database does not have the function
// yet (PGRST202 / 42883) or the table/column (42P01 / 42703 / PGRST204 /
// PGRST205), the caller gets `missing: true`, logs once, and falls back to
// "every module is on" / "history is not available yet". Nothing crashes and
// nothing pretends.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Json } from "@/lib/database.types";

export type MyModuleRow = { key: string; label: string; enabled: boolean; core: boolean };
export type ModuleCatalogRow = { key: string; label: string; description: string | null; core: boolean; depends_on: string[] | null; sort: number | null };
export type CenterModuleRow = { center_id: string; module_key: string; enabled: boolean; changed_by: string | null; changed_at: string | null; reason: string | null };

export type HistoryRow = {
  id: number;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  record_table: string | null;
  record_id: string | null;
  before: Json | null;
  after: Json | null;
  reason: string | null;
  correlation_id: string | null;
  module: string | null;
  client_app: string | null;
  client_screen: string | null;
};

type Table<R> = { Row: R; Insert: Partial<R>; Update: Partial<R>; Relationships: [] };

/** Minimal schema covering only the contract's new objects. */
export type ModulesDatabase = {
  app: {
    Tables: {
      modules: Table<ModuleCatalogRow>;
      center_modules: Table<CenterModuleRow>;
    };
    Views: Record<string, never>;
    Functions: {
      my_modules: { Args: { p_center: string }; Returns: MyModuleRow[] };
      module_enabled: { Args: { p_center: string; p_module: string }; Returns: boolean };
      set_module_enabled: { Args: { p_center: string; p_module: string; p_enabled: boolean; p_reason: string }; Returns: undefined };
      record_history: { Args: { p_table: string; p_record: string }; Returns: HistoryRow[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type ModulesSupabase = SupabaseClient<ModulesDatabase, "app">;

/** The same client, typed for the new objects (the client itself is unchanged). */
export function modulesDb(db: object): ModulesSupabase {
  return db as unknown as ModulesSupabase;
}

type ErrLike = { code?: string | null; message?: string | null } | null | undefined;

/** The database does not have this function / table / column yet (s-core not applied). */
export function isMissingObject(error: ErrLike): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["PGRST202", "42883", "42P01", "42703", "PGRST204", "PGRST205"].includes(code)) return true;
  return /could not find the function|function .* does not exist|relation .* does not exist|column .* does not exist/i.test(error.message ?? "");
}

const warned = new Set<string>();
/** Log a "not applied yet" fallback once per process, not on every request. */
export function warnMissingOnce(what: string, error: ErrLike): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[modules] ${what} is not in the database yet (s-core migrations not applied) — falling back: ${error?.code ?? ""} ${error?.message ?? ""}`.trim());
}

export type LoadedModules =
  | { status: "ok"; rows: MyModuleRow[] }
  | { status: "missing" }
  | { status: "error"; error: ErrLike };

/** app.my_modules(center) — once per request (called from loadSession). */
export async function loadMyModules(db: object, centerId: string): Promise<LoadedModules> {
  try {
    const { data, error } = await modulesDb(db).rpc("my_modules", { p_center: centerId });
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.my_modules", error);
        return { status: "missing" };
      }
      console.error("[modules] could not load app.my_modules — treating every module as on:", error);
      return { status: "error", error };
    }
    return { status: "ok", rows: Array.isArray(data) ? data : [] };
  } catch (e) {
    console.error("[modules] app.my_modules threw — treating every module as on:", e);
    return { status: "error", error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Keys switched off, from my_modules rows (core modules are never off). */
export function modulesOffFrom(rows: readonly MyModuleRow[]): string[] {
  return rows.filter((r) => r.enabled === false && !r.core).map((r) => r.key).sort();
}
