import "server-only";

import { describeAudit } from "@/lib/activity";
import { orgIds, personName } from "@/lib/data/lookups";
import { ageOn, todayInTz } from "@/lib/dates";
import type { DbErrorLike } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { bestTier, type HouseholdRole, type Tier } from "@/lib/people";
import type { CrmSession } from "@/lib/session";

// The household and person records behind the People drawers and the full
// record pages. Plain queries; RLS decides what comes back, and each section
// carries its own error so one failed read never blanks the whole view.

export type Activity = { at: string; what: string; detail: string };
export type Section<T> = { ok: true; data: T } | { ok: false; error: DbErrorLike | string };

export type HouseholdMember = {
  personId: string;
  name: string;
  memberNumber: string | null;
  role: HouseholdRole;
  gender: string | null;
  isPrimary: boolean;
  age: number | null;
  dateOfBirth: string | null;
  onApp: boolean;
  photoOptIn: boolean;
  /** Another household this person is primary of (adult child with their own household). */
  alsoPrimaryOf: { id: string; name: string; number: string | null } | null;
};

export type HouseholdRecord = {
  id: string;
  name: string;
  number: string | null;
  orgIds: string[];
  address: { line1: string | null; line2: string | null; city: string | null; state: string | null; postal: string | null };
  addressText: string;
  zoneId: string | null;
  zoneName: string | null;
  zones: { id: string; name: string }[];
  tier: Tier | null;
  since: string | null;
  phone: string | null;
  directoryOptIn: boolean;
  physicalMailOptIn: boolean;
  mergedIntoId: string | null;
  members: Section<HouseholdMember[]>;
  giving: Section<{ openCents: number; pledges: { id: string; label: string; paid: number; amount: number; closed: boolean; date: string }[] }> | null;
  activity: Section<Activity[]> | null;
  duplicates: Section<{ candidateId: string; otherId: string; otherName: string; score: number | null }[]> | null;
};

const AUDIT_LIMIT = 5;

async function recentActivity(session: CrmSession, filter: string): Promise<Section<Activity[]> | null> {
  if (!can(session, "audit.view")) return null;
  const res = await session.db
    .from("audit_log")
    .select("occurred_at, action, record_table, before, after")
    .eq("center_id", session.center.id)
    .or(filter)
    .order("occurred_at", { ascending: false })
    .limit(AUDIT_LIMIT);
  if (res.error) return { ok: false, error: res.error };
  return {
    ok: true,
    data: (res.data ?? []).map((r) => {
      const d = describeAudit(r);
      return { at: r.occurred_at, what: d.what, detail: d.detail };
    }),
  };
}

export async function loadHouseholdRecord(session: CrmSession, id: string): Promise<{ record: HouseholdRecord | null; error: DbErrorLike | null }> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const hh = await db
    .from("households")
    .select("id, display_name, household_number, zone_id, address_line1, address_line2, city, state_region, postal_code, directory_opt_in, physical_mail_opt_in, merged_into_id")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (hh.error) return { record: null, error: hh.error };
  if (!hh.data) return { record: null, error: null };
  const h = hh.data;
  const seesGiving = can(session, ["giving.view", "giving.manage", "giving.record_offline"]);

  const [zones, memberships, links, org, pledges, candidates] = await Promise.all([
    db.from("zones").select("id, name").eq("center_id", center.id).order("name"),
    db.from("memberships").select("tier, status, starts_on").eq("household_id", id).eq("status", "active"),
    db.from("household_members").select("person_id, role, is_primary, joined_at").eq("household_id", id).is("left_at", null),
    orgIds(db, center.id, { householdIds: [id] }),
    seesGiving
      ? db
          .from("pledges")
          .select("id, pledge_number, campaign_id, source, amount_cents, paid_cents, status, pledged_at")
          .eq("household_id", id)
          .in("status", ["open", "partially_paid", "paid"])
          .order("pledged_at", { ascending: false })
          .limit(50)
      : null,
    can(session, "people.manage")
      ? db.from("merge_candidates").select("id, left_id, right_id, score").eq("center_id", center.id).eq("kind", "household").eq("status", "open").or(`left_id.eq.${id},right_id.eq.${id}`)
      : null,
  ]);

  // Members, their on-app state and any household they are primary of.
  let members: Section<HouseholdMember[]>;
  if (links.error) members = { ok: false, error: links.error };
  else {
    const ids = (links.data ?? []).map((l) => l.person_id);
    const [people, logins, otherPrimary] = await Promise.all([
      ids.length
        ? db.from("people").select("id, first_name, last_name, preferred_name, member_number, gender, date_of_birth, photo_opt_in").in("id", ids)
        : null,
      ids.length ? db.from("center_users").select("person_id").eq("center_id", center.id).in("person_id", ids) : null,
      ids.length
        ? db.from("household_members").select("person_id, household_id").in("person_id", ids).eq("is_primary", true).is("left_at", null).neq("household_id", id)
        : null,
    ]);
    const err = people?.error ?? logins?.error ?? otherPrimary?.error;
    if (err) members = { ok: false, error: err };
    else {
      const otherIds = [...new Set((otherPrimary?.data ?? []).map((o) => o.household_id))];
      const others = otherIds.length ? await db.from("households").select("id, display_name, household_number").in("id", otherIds) : null;
      const otherBy = new Map((others?.data ?? []).map((o) => [o.id, o]));
      const primaryOf = new Map((otherPrimary?.data ?? []).map((o) => [o.person_id, otherBy.get(o.household_id)]));
      const onApp = new Set((logins?.data ?? []).map((l) => l.person_id));
      const peopleBy = new Map((people?.data ?? []).map((p) => [p.id, p]));
      const list: HouseholdMember[] = (links.data ?? []).map((l) => {
        const p = peopleBy.get(l.person_id);
        const other = primaryOf.get(l.person_id);
        return {
          personId: l.person_id,
          name: p ? personName(p) : "Not visible to you",
          memberNumber: p?.member_number ?? null,
          role: l.role,
          gender: p?.gender ?? null,
          isPrimary: l.is_primary,
          age: ageOn(p?.date_of_birth, today),
          dateOfBirth: p?.date_of_birth ?? null,
          onApp: onApp.has(l.person_id),
          photoOptIn: p?.photo_opt_in ?? false,
          alsoPrimaryOf: other ? { id: other.id, name: other.display_name, number: other.household_number } : null,
        };
      });
      list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (b.age ?? 200) - (a.age ?? 200));
      members = { ok: true, data: list };
    }
  }

  const active = bestTier(memberships.data ?? []);
  const since = (memberships.data ?? [])
    .filter((m) => m.tier === active?.tier)
    .map((m) => m.starts_on)
    .sort()[0];
  const primary = members.ok ? members.data.find((m) => m.isPrimary) : undefined;
  let phone: string | null = null;
  if (primary) {
    const pr = await db.from("people").select("phone_e164").eq("id", primary.personId).maybeSingle();
    if (pr.error) console.error("[people-records] primary member phone lookup failed; showing none:", pr.error);
    phone = pr.data?.phone_e164 ?? null;
  }

  // Giving summary: open balance plus the last six pledges.
  let giving: HouseholdRecord["giving"] = null;
  if (pledges) {
    if (pledges.error) giving = { ok: false, error: pledges.error };
    else {
      const rows = pledges.data ?? [];
      const campaignIds = [...new Set(rows.map((p) => p.campaign_id).filter((x): x is string => Boolean(x)))];
      const camps = campaignIds.length ? await db.from("campaigns").select("id, name").in("id", campaignIds) : null;
      if (camps?.error) console.error("[people-records] campaign names failed; showing pledge sources instead:", camps.error);
      const campBy = new Map((camps?.data ?? []).map((c) => [c.id, c.name]));
      giving = {
        ok: true,
        data: {
          openCents: rows.filter((p) => p.status !== "paid").reduce((a, p) => a + p.amount_cents - p.paid_cents, 0),
          pledges: rows.slice(0, 6).map((p) => ({
            id: p.id,
            label: (p.campaign_id ? campBy.get(p.campaign_id) : null) ?? p.pledge_number ?? String(p.source).replace(/_/g, " "),
            paid: p.paid_cents,
            amount: p.amount_cents,
            closed: p.status === "paid" || p.paid_cents >= p.amount_cents,
            date: p.pledged_at,
          })),
        },
      };
    }
  }

  let duplicates: HouseholdRecord["duplicates"] = null;
  if (candidates) {
    if (candidates.error) duplicates = { ok: false, error: candidates.error };
    else {
      const otherIds = (candidates.data ?? []).map((c) => (c.left_id === id ? c.right_id : c.left_id));
      const others = otherIds.length ? await db.from("households").select("id, display_name").in("id", otherIds).is("merged_into_id", null) : null;
      const byId = new Map((others?.data ?? []).map((o) => [o.id, o.display_name]));
      duplicates = {
        ok: true,
        data: (candidates.data ?? [])
          .map((c) => {
            const other = c.left_id === id ? c.right_id : c.left_id;
            return { candidateId: c.id, otherId: other, otherName: byId.get(other) ?? "", score: c.score };
          })
          .filter((d) => d.otherName),
      };
    }
  }

  const address = { line1: h.address_line1, line2: h.address_line2, city: h.city, state: h.state_region, postal: h.postal_code };
  return {
    record: {
      id: h.id,
      name: h.display_name,
      number: h.household_number,
      orgIds: org.byHousehold.get(id) ?? [],
      address,
      addressText: [h.address_line1, h.address_line2, h.city, [h.state_region, h.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      zoneId: h.zone_id,
      zoneName: (zones.data ?? []).find((z) => z.id === h.zone_id)?.name ?? null,
      zones: zones.data ?? [],
      tier: active?.tier ?? null,
      since: since ?? null,
      phone,
      directoryOptIn: h.directory_opt_in,
      physicalMailOptIn: h.physical_mail_opt_in !== false,
      mergedIntoId: h.merged_into_id,
      members,
      giving,
      activity: await recentActivity(session, `and(record_table.eq.households,record_id.eq.${id}),after->>household_id.eq.${id}`),
      duplicates,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------
export type PersonRecord = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  preferredName: string | null;
  memberNumber: string | null;
  orgIds: string[];
  dateOfBirth: string | null;
  age: number | null;
  isMinor: boolean;
  gender: string | null;
  email: string | null;
  phone: string | null;
  language: string;
  profession: string | null;
  employer: string | null;
  photoOptIn: boolean;
  newMemberContact: boolean;
  expertiseOptIn: boolean;
  expertiseHeadline: string | null;
  expertiseTags: string[];
  isVerified: boolean;
  isDeceased: boolean;
  mergedIntoId: string | null;
  childLoginAge: number;
  households: Section<{ id: string; name: string; number: string | null; role: HouseholdRole; isPrimary: boolean; directoryOptIn: boolean; physicalMail: boolean }[]>;
  account: Section<{ linkedAt: string | null }>;
  roles: Section<string[]> | null;
  waiver: Section<string> | null;
  backgroundCheck: Section<string> | null;
  activity: Section<Activity[]> | null;
  duplicates: Section<{ candidateId: string; otherId: string; otherName: string; score: number | null }[]> | null;
};

function childLoginAge(rules: unknown): number {
  const v = rules && typeof rules === "object" ? (rules as Record<string, unknown>).child_login_age : undefined;
  return typeof v === "number" && v > 0 && v < 19 ? v : 13;
}

export async function loadPersonRecord(session: CrmSession, id: string): Promise<{ record: PersonRecord | null; error: DbErrorLike | null }> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const res = await db
    .from("people")
    .select(
      "id, first_name, last_name, preferred_name, member_number, date_of_birth, gender, email, phone_e164, language, profession, employer, photo_opt_in, new_member_contact_opt_in, expertise_opt_in, expertise_headline, expertise_tags, is_verified, is_deceased, merged_into_id",
    )
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (res.error) return { record: null, error: res.error };
  if (!res.data) return { record: null, error: null };
  const p = res.data;
  const age = ageOn(p.date_of_birth, today);

  const [links, login, org, assignments, checks, candidates] = await Promise.all([
    db.from("household_members").select("household_id, role, is_primary").eq("person_id", id).is("left_at", null),
    db.from("center_users").select("user_id, created_at").eq("center_id", center.id).eq("person_id", id).maybeSingle(),
    orgIds(db, center.id, { personIds: [id] }),
    can(session, ["volunteers.view", "volunteers.manage"])
      ? db.from("volunteer_assignments").select("waiver_consent_id, created_at").eq("person_id", id).order("created_at", { ascending: false }).limit(20)
      : null,
    can(session, ["safety.view", "safety.manage"])
      ? db.from("background_checks").select("status, expires_on").eq("person_id", id).order("created_at", { ascending: false }).limit(1)
      : null,
    can(session, "people.manage")
      ? db.from("merge_candidates").select("id, left_id, right_id, score").eq("center_id", center.id).eq("kind", "person").eq("status", "open").or(`left_id.eq.${id},right_id.eq.${id}`)
      : null,
  ]);

  let households: PersonRecord["households"];
  if (links.error) households = { ok: false, error: links.error };
  else {
    const ids = (links.data ?? []).map((l) => l.household_id);
    const hh = ids.length ? await db.from("households").select("id, display_name, household_number, directory_opt_in, physical_mail_opt_in").in("id", ids) : null;
    if (hh?.error) households = { ok: false, error: hh.error };
    else {
      const by = new Map((hh?.data ?? []).map((h) => [h.id, h]));
      households = {
        ok: true,
        data: (links.data ?? [])
          .map((l) => {
            const h = by.get(l.household_id);
            return {
              id: l.household_id,
              name: h?.display_name ?? "Household",
              number: h?.household_number ?? null,
              role: l.role,
              isPrimary: l.is_primary,
              directoryOptIn: h?.directory_opt_in ?? false,
              physicalMail: h?.physical_mail_opt_in !== false,
            };
          })
          .sort((a, b) => Number(a.isPrimary) - Number(b.isPrimary)),
      };
    }
  }

  // Staff roles: only role managers can read other people's grants.
  let roles: PersonRecord["roles"] = null;
  if (login.data && can(session, "roles.manage")) {
    const g = await db.from("role_grants").select("role_key, scope_kind, ends_at, status").eq("center_id", center.id).eq("user_id", login.data.user_id).eq("status", "active");
    if (g.error) roles = { ok: false, error: g.error };
    else {
      const keys = [...new Set((g.data ?? []).filter((x) => !x.ends_at || x.ends_at > new Date().toISOString()).map((x) => x.role_key))];
      const names = keys.length ? await db.from("roles").select("key, name").in("key", keys) : null;
      const nameBy = new Map((names?.data ?? []).map((r) => [r.key, r.name]));
      roles = { ok: true, data: keys.map((k) => nameBy.get(k) ?? k) };
    }
  } else if (!login.error && !login.data) {
    roles = { ok: true, data: [] };
  }

  const waiver: PersonRecord["waiver"] = assignments
    ? assignments.error
      ? { ok: false, error: assignments.error }
      : {
          ok: true,
          data: (assignments.data ?? []).length === 0 ? "No volunteer shifts" : (assignments.data ?? []).some((a) => a.waiver_consent_id) ? "Signed" : "Not signed",
        }
    : null;
  const backgroundCheck: PersonRecord["backgroundCheck"] = checks
    ? checks.error
      ? { ok: false, error: checks.error }
      : {
          ok: true,
          data: checks.data?.[0]
            ? `${checks.data[0].status === "clear" ? "Clear" : checks.data[0].status[0].toUpperCase() + checks.data[0].status.slice(1)}${checks.data[0].expires_on ? ` · expires ${checks.data[0].expires_on}` : ""}`
            : "None on file",
        }
    : null;

  let duplicates: PersonRecord["duplicates"] = null;
  if (candidates) {
    if (candidates.error) duplicates = { ok: false, error: candidates.error };
    else {
      const otherIds = (candidates.data ?? []).map((c) => (c.left_id === id ? c.right_id : c.left_id));
      const others = otherIds.length ? await db.from("people").select("id, first_name, last_name, preferred_name").in("id", otherIds).is("merged_into_id", null) : null;
      const byId = new Map((others?.data ?? []).map((o) => [o.id, personName(o)]));
      duplicates = {
        ok: true,
        data: (candidates.data ?? [])
          .map((c) => {
            const other = c.left_id === id ? c.right_id : c.left_id;
            return { candidateId: c.id, otherId: other, otherName: byId.get(other) ?? "", score: c.score };
          })
          .filter((d) => d.otherName),
      };
    }
  }

  return {
    record: {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      name: personName(p),
      preferredName: p.preferred_name,
      memberNumber: p.member_number,
      orgIds: org.byPerson.get(id) ?? [],
      dateOfBirth: p.date_of_birth,
      age,
      isMinor: age !== null && age < 18,
      gender: p.gender,
      email: p.email,
      phone: p.phone_e164,
      language: p.language,
      profession: p.profession,
      employer: p.employer,
      photoOptIn: p.photo_opt_in,
      newMemberContact: p.new_member_contact_opt_in,
      expertiseOptIn: p.expertise_opt_in,
      expertiseHeadline: p.expertise_headline,
      expertiseTags: p.expertise_tags ?? [],
      isVerified: p.is_verified,
      isDeceased: p.is_deceased,
      mergedIntoId: p.merged_into_id,
      childLoginAge: childLoginAge(center.rules),
      households,
      account: login.error ? { ok: false, error: login.error } : { ok: true, data: { linkedAt: login.data?.created_at ?? null } },
      roles,
      waiver,
      backgroundCheck,
      activity: await recentActivity(session, `and(record_table.eq.people,record_id.eq.${id}),after->>person_id.eq.${id}`),
      duplicates,
    },
    error: null,
  };
}
