import "server-only";

import { personName } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

// People › Directory & expertise. Direct queries for now; when
// app.directory_listing(p_center) lands, only loadDirectory() changes.

export type ExpertiseListing = {
  personId: string;
  name: string;
  household: string | null;
  areas: string[];
  headline: string | null;
  openToNewMembers: boolean;
  verified: boolean;
};

export type DirectoryData = {
  families: number | null;
  openToNew: number | null;
  listings: ExpertiseListing[];
  listingsTotal: number | null;
  error: DbErrorLike | null;
};

export async function loadDirectory(session: CrmSession): Promise<DirectoryData> {
  const { db, center } = session;
  const [families, openToNew, listings] = await Promise.all([
    db.from("households").select("id", { count: "exact", head: true }).eq("center_id", center.id).is("merged_into_id", null).eq("directory_opt_in", true),
    db
      .from("people")
      .select("id", { count: "exact", head: true })
      .eq("center_id", center.id)
      .is("merged_into_id", null)
      .eq("is_deceased", false)
      .eq("new_member_contact_opt_in", true),
    db
      .from("people")
      .select("id, first_name, last_name, preferred_name, expertise_tags, expertise_headline, new_member_contact_opt_in, is_verified", { count: "exact" })
      .eq("center_id", center.id)
      .is("merged_into_id", null)
      .eq("is_deceased", false)
      .eq("expertise_opt_in", true)
      .order("last_name")
      .limit(200),
  ]);
  const error = families.error ?? openToNew.error ?? listings.error ?? null;
  const rows = listings.data ?? [];
  const households = new Map<string, string>();
  if (rows.length) {
    const links = await db
      .from("household_members")
      .select("person_id, household_id, is_primary")
      .in(
        "person_id",
        rows.map((r) => r.id),
      )
      .is("left_at", null);
    if (links.error) console.error("[directory] household names failed; listings show without them:", links.error);
    const hhIds = [...new Set((links.data ?? []).map((l) => l.household_id))];
    const hh = hhIds.length ? await db.from("households").select("id, display_name").in("id", hhIds) : null;
    if (hh?.error) console.error("[directory] household names failed; listings show without them:", hh.error);
    const byId = new Map((hh?.data ?? []).map((h) => [h.id, h.display_name]));
    for (const l of links.data ?? []) if (!households.has(l.person_id) || l.is_primary) households.set(l.person_id, byId.get(l.household_id) ?? "");
  }
  return {
    families: families.count,
    openToNew: openToNew.count,
    listingsTotal: listings.count,
    listings: rows.map((r) => ({
      personId: r.id,
      name: personName(r),
      household: households.get(r.id) || null,
      areas: r.expertise_tags ?? [],
      headline: r.expertise_headline,
      openToNewMembers: r.new_member_contact_opt_in,
      verified: r.is_verified,
    })),
    error,
  };
}
