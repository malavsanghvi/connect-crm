import "server-only";

import type { DbErrorLike } from "@/lib/errors";
import { householdIdsFromResolved, type ResolvedIdentifier } from "@/lib/identifiers";
import { safeFilterText } from "@/lib/search-params";
import type { AppSupabase } from "@/lib/supabase/server";

export type HouseholdSearch = {
  householdIds: string[];
  /** What the identifier resolver matched (Connect numbers, org IDs, CRM, QuickBooks, payer names…). */
  identifierMatches: ResolvedIdentifier[];
  error: DbErrorLike | null;
};

/**
 * Find households by name / household number / member name / email, and by
 * ANY identifier via app.resolve_identifier (which also pads org member IDs,
 * so "417" finds "0417"). RLS decides what comes back.
 */
export async function searchHouseholds(
  db: AppSupabase,
  centerId: string,
  rawQuery: string,
  { limit = 300 }: { limit?: number } = {},
): Promise<HouseholdSearch> {
  const q = rawQuery.trim();
  if (!q) return { householdIds: [], identifierMatches: [], error: null };
  const safe = safeFilterText(q);
  const tokens = safe.split(" ").filter(Boolean);

  const byName = safe
    ? db
        .from("households")
        .select("id")
        .eq("center_id", centerId)
        .is("merged_into_id", null)
        .or(`display_name.ilike.%${safe}%,household_number.ilike.%${safe}%`)
        .limit(limit)
    : null;

  const peopleQuery = db.from("people").select("id").eq("center_id", centerId).is("merged_into_id", null).limit(limit);
  const byPerson =
    tokens.length >= 2
      ? peopleQuery.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens[tokens.length - 1]}%`)
      : tokens.length === 1
        ? peopleQuery.or(
            `first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,preferred_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%`,
          )
        : null;

  const [nameRes, personRes, idRes] = await Promise.all([
    byName,
    byPerson,
    db.rpc("resolve_identifier", { p_center: centerId, p_value: q }),
  ]);

  const error = nameRes?.error ?? personRes?.error ?? idRes.error ?? null;
  const ids = new Set<string>();
  for (const h of nameRes?.data ?? []) ids.add(h.id);

  const identifierMatches: ResolvedIdentifier[] = (idRes.data ?? []).map((r) => ({
    kind: r.kind,
    system: r.system,
    value: r.value,
    person_id: r.person_id ?? null,
    household_id: r.household_id ?? null,
    display_name: r.display_name ?? null,
    household_name: r.household_name ?? null,
    household_number: r.household_number ?? null,
    org_household_id: r.org_household_id ?? null,
    members: r.members ?? null,
  }));
  for (const id of householdIdsFromResolved(identifierMatches)) ids.add(id);

  const personIds = (personRes?.data ?? []).map((p) => p.id);
  if (personIds.length > 0) {
    const links = await db
      .from("household_members")
      .select("household_id")
      .in("person_id", personIds.slice(0, 150))
      .is("left_at", null);
    if (links.error) return { householdIds: [...ids], identifierMatches, error: links.error };
    for (const l of links.data ?? []) ids.add(l.household_id);
  }

  return { householdIds: [...ids].slice(0, limit), identifierMatches, error };
}
