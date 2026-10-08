// Which roles an organization's kind lists. Migration 0600 tags roles with the experiences that show them
// (roles.category_keys; empty = every experience, otherwise those named and everything that inherits from them: the kind's
// `lineage`). The tags decide what is LISTED, not what anyone may do: a role someone already holds is still named where it
// is held. Until the database has the tags (or the lineage) every role is listed, as before.
//
// Server use: pages call loadRoleFilter(db, kindKey) and filter the roles they offer. The test is pure (roleShown).

import type { SupabaseClient } from "@supabase/supabase-js";

import { isMissingObject } from "@/lib/modules-db";
import type { AppSupabase } from "@/lib/supabase/server";

/** True when a role tagged with `tags` is listed for a kind whose lineage is `lineage` (the kind's own key and its ancestors). */
export function roleShown(tags: readonly string[] | null | undefined, lineage: readonly string[]): boolean {
  if (!tags || tags.length === 0) return true;
  return tags.some((t) => lineage.includes(t));
}

type TagDb = {
  app: {
    Tables: {
      roles: { Row: { key: string; category_keys: string[] | null }; Insert: never; Update: never; Relationships: [] };
      organization_categories: { Row: { key: string; lineage: string[] | null }; Insert: never; Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** A function that says whether a role key is listed for this kind. Lists every role when the tags are not in the database. */
export async function loadRoleFilter(db: AppSupabase, kindKey: string): Promise<(roleKey: string) => boolean> {
  try {
    const client = db as unknown as SupabaseClient<TagDb, "app">;
    const [tags, kind] = await Promise.all([client.from("roles").select("key, category_keys"), client.from("organization_categories").select("key, lineage").eq("key", kindKey).maybeSingle()]);
    const error = tags.error ?? kind.error;
    if (error) {
      if (!isMissingObject(error)) console.error("[roles] could not read which roles this kind lists (listing every role):", error);
      return () => true;
    }
    const lineage = [...new Set([kindKey, ...(kind.data?.lineage ?? [])])];
    const byRole = new Map((tags.data ?? []).map((r) => [r.key, r.category_keys]));
    return (roleKey) => roleShown(byRole.get(roleKey), lineage);
  } catch (e) {
    console.error("[roles] reading the role tags threw (listing every role):", e);
    return () => true;
  }
}
