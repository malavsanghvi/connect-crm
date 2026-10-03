// Calls to the access-level RPCs of migration 0586 (app.access_settings, app.set_feature_access,
// app.save_access_levels). The generated types (src/lib/database.types.ts) are regenerated from the database
// by CI and do not know them until that has run, so the calls go through ONE narrow cast here, the same way
// src/lib/modules-db.ts did for the module switches. Delete the cast, and use db.rpc(...) directly, once the
// generated types carry the three functions.
//
// Every call is defensive: a database that has not had 0586 applied yet answers "function does not exist"
// (PGRST202 / 42883), and the caller then says so in plain English instead of showing an empty page.

import { parseAccessSettings, type AccessSettings } from "@/lib/access";
import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";

type RpcError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

/** The same client, able to call the three access RPCs by name (the client itself is unchanged). */
export function accessRpc(db: object): RpcClient {
  return db as unknown as RpcClient;
}

/** The database refused because the caller lacks the permission (SQLSTATE 42501): the page then says "You don't have access to this area". */
export function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "42501";
}

export type LoadedAccessSettings =
  | { status: "ok"; settings: AccessSettings }
  /** The database does not have migration 0586 yet. */
  | { status: "missing" }
  /** The call failed (permission, network, …): the error is for the page's plain-English message. */
  | { status: "error"; error: unknown }
  /** The call worked but sent something this page cannot read. */
  | { status: "shape"; message: string };

/** app.access_settings(center): the levels, the areas and the membership types, for Settings › Access levels. */
export async function loadAccessSettings(db: object, centerId: string): Promise<LoadedAccessSettings> {
  try {
    const { data, error } = await accessRpc(db).rpc("access_settings", { p_center: centerId });
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.access_settings", error);
        return { status: "missing" };
      }
      console.error("[settings/access] could not load app.access_settings:", error);
      return { status: "error", error };
    }
    const parsed = parseAccessSettings(data);
    if (!parsed.ok) {
      console.error("[settings/access] app.access_settings sent an unexpected shape:", data);
      return { status: "shape", message: parsed.error };
    }
    return { status: "ok", settings: parsed.value };
  } catch (e) {
    console.error("[settings/access] app.access_settings threw:", e);
    return { status: "error", error: e };
  }
}
