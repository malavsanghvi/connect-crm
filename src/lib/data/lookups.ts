import "server-only";

import type { HouseholdCardData } from "@/components/household-card";
import { chunk } from "@/lib/data/fetch-all";
import type { DbErrorLike } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

// The generated types carry no relationship metadata, so the console joins
// in code: fetch the page of rows, then look up names for the ids on it.

export type HouseholdRef = { id: string; display_name: string; household_number: string | null };
export type PersonRef = { id: string; name: string; member_number: string | null };

function uniq(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

export async function householdsById(
  db: AppSupabase,
  ids: Array<string | null | undefined>,
): Promise<{ map: Map<string, HouseholdRef>; error: DbErrorLike | null }> {
  const map = new Map<string, HouseholdRef>();
  const wanted = uniq(ids);
  for (const part of chunk(wanted)) {
    const { data, error } = await db.from("households").select("id, display_name, household_number").in("id", part);
    if (error) return { map, error };
    for (const h of data ?? []) map.set(h.id, h);
  }
  // Finance volunteers (giving.record_offline) cannot read households under RLS
  // but may see the household card, so names still show on their lists.
  const hidden = wanted.filter((id) => !map.has(id)).slice(0, 60);
  if (hidden.length > 0) {
    const cards = await householdCards(db, hidden);
    if (cards.error) console.error("[lookups] household_card fallback failed; some names stay hidden:", cards.error);
    for (const [id, c] of cards.map) {
      map.set(id, { id, display_name: c.household_name ?? "Household", household_number: c.household_number });
    }
  }
  return { map, error: null };
}

export function personName(p: { first_name: string; last_name: string; preferred_name?: string | null }): string {
  return `${p.preferred_name || p.first_name} ${p.last_name}`;
}

export async function peopleById(
  db: AppSupabase,
  ids: Array<string | null | undefined>,
): Promise<{ map: Map<string, PersonRef>; error: DbErrorLike | null }> {
  const map = new Map<string, PersonRef>();
  for (const part of chunk(uniq(ids))) {
    const { data, error } = await db
      .from("people")
      .select("id, first_name, last_name, preferred_name, member_number")
      .in("id", part);
    if (error) return { map, error };
    for (const p of data ?? []) map.set(p.id, { id: p.id, name: personName(p), member_number: p.member_number });
  }
  return { map, error: null };
}

/**
 * Names for auth user ids (actors, approvers, granters) via center_users → people.
 * Needs people.view or roles.manage; without it the caller shows a short id.
 */
export async function userNames(
  db: AppSupabase,
  centerId: string,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, PersonRef & { user_id: string }>> {
  const out = new Map<string, PersonRef & { user_id: string }>();
  const ids = uniq(userIds);
  if (ids.length === 0) return out;
  const links: { user_id: string; person_id: string }[] = [];
  for (const part of chunk(ids)) {
    const { data, error } = await db
      .from("center_users")
      .select("user_id, person_id")
      .eq("center_id", centerId)
      .in("user_id", part);
    if (error) {
      console.error("[lookups] center_users lookup failed; showing ids instead of names:", error);
      return out;
    }
    links.push(...(data ?? []));
  }
  const { map, error } = await peopleById(
    db,
    links.map((l) => l.person_id),
  );
  if (error) {
    console.error("[lookups] people lookup for user names failed; showing ids instead:", error);
    return out;
  }
  for (const l of links) {
    const p = map.get(l.person_id);
    if (p) out.set(l.user_id, { ...p, user_id: l.user_id });
  }
  return out;
}

export async function campaignsForCenter(
  db: AppSupabase,
  centerId: string,
): Promise<{ data: { id: string; name: string; status: string; kind: string }[]; error: DbErrorLike | null }> {
  const { data, error } = await db
    .from("campaigns")
    .select("id, name, status, kind")
    .eq("center_id", centerId)
    .order("name");
  return { data: data ?? [], error };
}

/**
 * app.household_card() for each id — the disambiguation card every picker,
 * search result and suggestion shows. Rows the user cannot see are absent.
 */
export async function householdCards(
  db: AppSupabase,
  ids: Array<string | null | undefined>,
): Promise<{ map: Map<string, HouseholdCardData>; error: DbErrorLike | null }> {
  const map = new Map<string, HouseholdCardData>();
  const list = uniq(ids);
  const results = await Promise.all(list.map((id) => db.rpc("household_card", { p_household: id })));
  let firstError: DbErrorLike | null = null;
  results.forEach((res, i) => {
    if (res.error) {
      firstError ??= res.error;
      return;
    }
    const row = res.data?.[0];
    if (row) map.set(list[i], toCard(row));
  });
  return { map, error: firstError };
}

/** Normalise a household_card-shaped row (fields may be null despite the generated types). */
export function toCard(row: {
  household_id: string;
  household_name?: string | null;
  household_number?: string | null;
  org_household_id?: string | null;
  members?: string | null;
  primary_member?: string | null;
  primary_org_member_id?: string | null;
  zone?: string | null;
  city?: string | null;
  last_gift_on?: string | null;
  open_pledge_cents?: number | null;
}): HouseholdCardData {
  return {
    household_id: row.household_id,
    household_name: row.household_name ?? null,
    household_number: row.household_number ?? null,
    org_household_id: row.org_household_id ?? null,
    members: row.members ?? null,
    primary_member: row.primary_member ?? null,
    primary_org_member_id: row.primary_org_member_id === undefined ? undefined : (row.primary_org_member_id ?? null),
    zone: row.zone ?? null,
    city: row.city ?? null,
    last_gift_on: row.last_gift_on ?? null,
    open_pledge_cents: row.open_pledge_cents ?? null,
  };
}

/**
 * Live org ids keyed by owner: the org's PERSON ids (kind org_member) by
 * person, and its HOUSEHOLD ids (kind org_household) by household.
 */
export async function orgIds(
  db: AppSupabase,
  centerId: string,
  { personIds = [], householdIds = [] }: { personIds?: string[]; householdIds?: string[] },
): Promise<{ byPerson: Map<string, string[]>; byHousehold: Map<string, string[]>; error: DbErrorLike | null }> {
  const byPerson = new Map<string, string[]>();
  const byHousehold = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string | null, v: string) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.includes(v)) m.set(k, [...list, v]);
  };
  for (const part of chunk(uniq(personIds))) {
    const { data, error } = await db
      .from("external_ids")
      .select("person_id, value")
      .eq("center_id", centerId)
      .eq("kind", "org_member")
      .is("valid_to", null)
      .in("person_id", part);
    if (error) return { byPerson, byHousehold, error };
    for (const r of data ?? []) add(byPerson, r.person_id, r.value);
  }
  for (const part of chunk(uniq(householdIds))) {
    const { data, error } = await db
      .from("external_ids")
      .select("household_id, value")
      .eq("center_id", centerId)
      .eq("kind", "org_household")
      .is("valid_to", null)
      .in("household_id", part);
    if (error) return { byPerson, byHousehold, error };
    for (const r of data ?? []) add(byHousehold, r.household_id, r.value);
  }
  return { byPerson, byHousehold, error: null };
}
