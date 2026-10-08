import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { failure } from "@/lib/errors";
import { FALLBACK_ORG_GROUPS, groupExperiences, parseExperiences, type OrgGroup } from "@/lib/org-choices";
import { newRequestId, traceHeaders } from "@/lib/supabase/trace";

export type OrgGroups = { groups: OrgGroup[]; source: "catalog" | "built_in" };

type Rpc = { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> };

/**
 * The kinds of organization the public Request access page offers, from app.list_experiences() (the experiences catalog, migrations
 * 0600-0605). The built-in list is used ONLY when the catalog cannot be read (the function is missing on this database, the call
 * fails, or it returns nothing), and the reason is always logged with failure(); it is never a silent fallback.
 *
 * The call goes through a loose type because src/lib/database.types.ts is generated and does not know the function until the
 * migration that adds it has been applied and the types regenerated; once it has, the cast can go.
 */
export async function loadOrgGroups(screen = "/request-access"): Promise<OrgGroups> {
  const env = readPublicEnv();
  if (!env.ok) return { groups: [...FALLBACK_ORG_GROUPS], source: "built_in" };
  const db = createClient<Database, "app">(env.env.supabaseUrl, env.env.supabaseAnonKey, {
    db: { schema: "app" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen }) },
  });
  try {
    const { data, error } = await (db as unknown as Rpc).rpc("list_experiences");
    if (error) {
      failure("Could not read the kinds of organization from the catalog (using the built-in list)", error);
      return { groups: [...FALLBACK_ORG_GROUPS], source: "built_in" };
    }
    const groups = groupExperiences(parseExperiences(data));
    if (!groups) {
      failure("The catalog of kinds of organization is empty (using the built-in list)", "list_experiences returned no active experiences");
      return { groups: [...FALLBACK_ORG_GROUPS], source: "built_in" };
    }
    return { groups, source: "catalog" };
  } catch (error) {
    failure("Could not read the kinds of organization from the catalog (using the built-in list)", error);
    return { groups: [...FALLBACK_ORG_GROUPS], source: "built_in" };
  }
}
