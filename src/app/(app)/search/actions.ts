"use server";

import { identifierRules } from "@/lib/center-rules";
import { failure, type ActionResult } from "@/lib/errors";
import {
  GLOBAL_SEARCH_LIMIT,
  mapGlobalSearch,
  normalizeSearchQuery,
  type GlobalSearchResult,
  type PersonHouseholdRow,
  type PersonSearchRow,
} from "@/lib/global-search";
import { can } from "@/lib/permissions";
import { safeFilterText } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

/**
 * Top-bar search: households (app.staff_household_search — name, household
 * number, member name, org IDs) and people (name, email, member number).
 * RLS and the function's own checks decide what comes back.
 */
export async function globalSearchAction(rawQuery: string): Promise<ActionResult<GlobalSearchResult[]>> {
  const auth = await authorizeAction("households", "search");
  if (!auth.ok) return auth;
  const q = normalizeSearchQuery(typeof rawQuery === "string" ? rawQuery : "");
  if (!q) return { ok: true, data: [] };
  const { db, center } = auth.session;
  const safe = safeFilterText(q);
  const tokens = safe.split(" ").filter(Boolean);
  const seesPeople = can(auth.session, ["people.view", "people.manage"]);

  try {
    const peopleBase = db
      .from("people")
      .select("id, first_name, last_name, preferred_name, member_number")
      .eq("center_id", center.id)
      .is("merged_into_id", null)
      .order("last_name")
      .limit(GLOBAL_SEARCH_LIMIT);
    const peopleQuery = !seesPeople
      ? null
      : tokens.length >= 2
        ? peopleBase.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens[tokens.length - 1]}%`)
        : tokens.length === 1
          ? peopleBase.or(
              `first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,preferred_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%,member_number.ilike.%${tokens[0]}%`,
            )
          : null;

    const [hhRes, peopleRes] = await Promise.all([
      db.rpc("staff_household_search", { p_center: center.id, p_query: q }),
      peopleQuery,
    ]);
    if (hhRes.error) return failure("Could not search households", hhRes.error);
    if (peopleRes?.error) return failure("Could not search people", peopleRes.error);

    const people: PersonSearchRow[] = peopleRes?.data ?? [];
    let personHouseholds: PersonHouseholdRow[] = [];
    if (people.length > 0) {
      const names = await db.rpc("staff_person_names", { p_center: center.id, p_ids: people.map((p) => p.id) });
      if (names.error) return failure("Could not look up the households of the people found", names.error);
      personHouseholds = (names.data ?? []).map((r) => ({ person_id: r.person_id, household_name: r.household_name }));
    }

    const labels = identifierRules(center.rules);
    return { ok: true, data: mapGlobalSearch(hhRes.data ?? [], people, personHouseholds, labels.orgHouseholdLabel) };
  } catch (error) {
    return failure("Could not search", error);
  }
}
