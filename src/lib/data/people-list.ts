import "server-only";

import { chunk } from "@/lib/data/fetch-all";
import { orgIds, personName } from "@/lib/data/lookups";
import { ageOn, todayInTz } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { dobBounds, type AgeBand, type HouseholdRole } from "@/lib/people";
import { safeFilterText } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

// People › People list. Direct queries for now (people + household_members
// + households); when app.people_list(p_center, p_search, p_limit, p_offset)
// lands, only listPeople() changes.

export type PersonRow = {
  id: string;
  name: string;
  memberNumber: string | null;
  orgIds: string[];
  gender: string | null;
  role: HouseholdRole | null;
  isPrimary: boolean;
  household: { id: string; name: string; number: string | null } | null;
  age: number | null;
  onApp: boolean;
  email: string | null;
  phone: string | null;
};

export type PeopleList = {
  rows: PersonRow[];
  total: number | null;
  error: DbErrorLike | null;
  /** Something the viewer should know about the result (e.g. roles they cannot see). */
  note: string | null;
};

const NONE = "00000000-0000-0000-0000-000000000000";

/** People who hold a staff role or serve on a volunteer team or class, as far as the viewer can see. */
async function teamPersonIds(session: CrmSession): Promise<{ ids: string[]; error: DbErrorLike | null; partial: boolean }> {
  const { db, center } = session;
  const nowIso = new Date().toISOString();
  const [grants, interests, teachers] = await Promise.all([
    db
      .from("role_grants")
      .select("user_id")
      .eq("center_id", center.id)
      .eq("status", "active")
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .limit(2000),
    can(session, ["volunteers.view", "volunteers.manage"])
      ? db.from("volunteer_interests").select("person_id").eq("center_id", center.id).eq("status", "active").limit(5000)
      : null,
    can(session, ["pathshala.view", "pathshala.manage"])
      ? db.from("pathshala_teachers").select("person_id").eq("center_id", center.id).limit(2000)
      : null,
  ]);
  const error = grants.error ?? interests?.error ?? teachers?.error ?? null;
  const ids = new Set<string>();
  for (const r of interests?.data ?? []) ids.add(r.person_id);
  for (const r of teachers?.data ?? []) ids.add(r.person_id);
  const userIds = [...new Set((grants.data ?? []).map((g) => g.user_id))];
  for (const part of chunk(userIds)) {
    const links = await db.from("center_users").select("person_id").eq("center_id", center.id).in("user_id", part);
    if (links.error) return { ids: [...ids], error: links.error, partial: true };
    for (const l of links.data ?? []) if (l.person_id) ids.add(l.person_id);
  }
  const partial = !can(session, "roles.manage") || !can(session, ["volunteers.view", "volunteers.manage"]);
  return { ids: [...ids], error, partial };
}

export async function listPeople(
  session: CrmSession,
  { search, band, page, pageSize }: { search?: string; band: AgeBand; page: number; pageSize: number },
): Promise<PeopleList> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  let note: string | null = null;

  let query = db
    .from("people")
    .select("id, first_name, last_name, preferred_name, member_number, date_of_birth, gender, email, phone_e164", { count: "exact" })
    .eq("center_id", center.id)
    .is("merged_into_id", null)
    .eq("is_deceased", false);

  // Search: name, phone, email, Connect member number, or any org / legacy ID.
  const orParts: string[] = [];
  const q = (search ?? "").trim();
  if (q) {
    const safe = safeFilterText(q);
    const tokens = safe.split(" ").filter(Boolean);
    const digits = q.replace(/\D/g, "");
    const idHits = await db.rpc("resolve_identifier", { p_center: center.id, p_value: q });
    if (idHits.error) console.error("[people-list] identifier lookup failed; searching names only:", idHits.error);
    const idPeople = [...new Set((idHits.data ?? []).map((r) => r.person_id).filter((x): x is string => Boolean(x)))].slice(0, 100);
    const idClause = idPeople.length ? `,id.in.(${idPeople.join(",")})` : "";
    if (digits.length >= 7 && digits.length === q.replace(/[\s()+.-]/g, "").length) {
      orParts.push(`phone_e164.like.*${digits.slice(-10)}${idClause}`);
    } else if (safe.includes("@")) {
      orParts.push(`email.ilike.*${safe}*${idClause}`);
    } else if (tokens.length >= 2) {
      const [a, b] = [tokens[0], tokens[tokens.length - 1]];
      orParts.push(`and(first_name.ilike.${a}*,last_name.ilike.${b}*),and(preferred_name.ilike.${a}*,last_name.ilike.${b}*),member_number.ilike.*${safe}*${idClause}`);
    } else if (tokens.length === 1) {
      const t = tokens[0];
      orParts.push(`first_name.ilike.*${t}*,last_name.ilike.*${t}*,preferred_name.ilike.*${t}*,email.ilike.*${t}*,member_number.ilike.*${t}*${idClause}`);
    }
  }

  // Age band.
  const bounds = dobBounds(band, today);
  if (band === "adults") orParts.push(`date_of_birth.lte.${bounds.onOrBefore},date_of_birth.is.null`);
  else if (band === "minors" && bounds.after) query = query.gt("date_of_birth", bounds.after);
  else if (band === "seniors" && bounds.onOrBefore) query = query.lte("date_of_birth", bounds.onOrBefore);
  else if (band === "roles") {
    const team = await teamPersonIds(session);
    if (team.error) return { rows: [], total: null, error: team.error, note: null };
    if (team.partial) note = "Counts only the roles and teams your permissions let you see.";
    query = query.in("id", team.ids.length ? team.ids.slice(0, 1000) : [NONE]);
  }
  // One or() per request: two groups are joined with and(or(…),or(…)).
  if (orParts.length === 1) query = query.or(orParts[0]);
  else if (orParts.length === 2) query = query.or(`and(or(${orParts[0]}),or(${orParts[1]}))`);

  const from = (page - 1) * pageSize;
  const res = await query.order("last_name").order("first_name").range(from, from + pageSize - 1);
  if (res.error) return { rows: [], total: null, error: res.error, note };
  const people = res.data ?? [];
  const ids = people.map((p) => p.id);
  if (ids.length === 0) return { rows: [], total: res.count ?? 0, error: null, note };

  const [links, logins, org] = await Promise.all([
    db.from("household_members").select("household_id, person_id, role, is_primary, joined_at").in("person_id", ids).is("left_at", null),
    db.from("center_users").select("person_id").eq("center_id", center.id).in("person_id", ids),
    orgIds(db, center.id, { personIds: ids }),
  ]);
  const detailError = links.error ?? logins.error ?? org.error ?? null;
  // A person's household here is the one they are primary of, else the earliest joined.
  const linkBy = new Map<string, NonNullable<typeof links.data>[number]>();
  for (const l of links.data ?? []) {
    const cur = linkBy.get(l.person_id);
    if (!cur || (l.is_primary && !cur.is_primary) || (!cur.is_primary && (l.joined_at ?? "") < (cur.joined_at ?? ""))) linkBy.set(l.person_id, l);
  }
  const hhIds = [...new Set([...linkBy.values()].map((l) => l.household_id))];
  const hh = hhIds.length ? await db.from("households").select("id, display_name, household_number").in("id", hhIds) : null;
  const hhBy = new Map((hh?.data ?? []).map((h) => [h.id, h]));
  const onApp = new Set((logins.data ?? []).map((l) => l.person_id));

  const rows: PersonRow[] = people.map((p) => {
    const link = linkBy.get(p.id);
    const h = link ? hhBy.get(link.household_id) : undefined;
    return {
      id: p.id,
      name: personName(p),
      memberNumber: p.member_number,
      orgIds: org.byPerson.get(p.id) ?? [],
      gender: p.gender,
      role: link?.role ?? null,
      isPrimary: link?.is_primary ?? false,
      household: link ? { id: link.household_id, name: h?.display_name ?? "Household", number: h?.household_number ?? null } : null,
      age: ageOn(p.date_of_birth, today),
      onApp: onApp.has(p.id),
      email: p.email,
      phone: p.phone_e164,
    };
  });
  return { rows, total: res.count ?? null, error: detailError ?? hh?.error ?? null, note };
}

/** Totals for the tab sub-lines: "{people} people across {households} households". */
export async function peopleTotals(session: CrmSession): Promise<{ people: number | null; households: number | null; error: DbErrorLike | null }> {
  const { db, center } = session;
  const [people, households] = await Promise.all([
    db.from("people").select("id", { count: "exact", head: true }).eq("center_id", center.id).is("merged_into_id", null).eq("is_deceased", false),
    db.from("households").select("id", { count: "exact", head: true }).eq("center_id", center.id).is("merged_into_id", null),
  ]);
  return { people: people.count, households: households.count, error: people.error ?? households.error ?? null };
}
