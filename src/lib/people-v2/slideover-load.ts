import "server-only";

import { communityMajority, isAdultMember } from "@/lib/commands/child-filter";
import { identifierRules } from "@/lib/center-rules";
import { loadCommunityLocale } from "@/lib/community-locale";
import { loadProfileDetails } from "@/lib/data/profile-details";
import { householdsById, orgIds, personName } from "@/lib/data/lookups";
import { ageOn, todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { identifierKindLabel } from "@/lib/identifiers";
import { IDENTIFIER_KINDS, can, canAccess, canManageIdentifierKind, canViewIdentifierKind } from "@/lib/permissions";
import { personLanguageOptions } from "@/lib/people";
import type { CrmSession } from "@/lib/session";

import { personValues, privacyValues, type FamilyModel, type FamilyPerson } from "./family-model";
import {
  addIdKinds,
  detailHousehold,
  part,
  shapeIdRows,
  type AccountFacts,
  type DetailHousehold,
  type IdsFacts,
  type MembershipHeld,
  type Part,
  type PersonDetailModel,
  type ProfileDetails,
} from "./slideover";

// Reads one person for the slide-over, as the signed-in person (the database's security decides what comes back), and works out the
// model. Nothing here writes. Every deep section is read on its own: one that fails, or that this role may not read, says so in its
// own place (never an empty table), and the rest still draw. On a family page the person and the household come from the page's own
// model (so nothing is read twice); on the person's own page (no household) the person is read here.

export type DetailLoad =
  | { status: "ok"; detail: PersonDetailModel }
  | { status: "not_found" }
  /** The address names a person who is not (any longer) in this household, or whom this role cannot see. */
  | { status: "not_here" }
  | { status: "error"; error: unknown };

const KIND_HINTS: Partial<Record<string, string>> = {
  crm: "An id from a system that was retired. Kept so old QR codes and imports still resolve.",
  accounting: "The accounting system's customer or donor id.",
  bank_payer: "How this person appears on a bank statement. Not unique: a matching hint.",
  payment_provider: "The payment provider's customer id.",
};

const PERSON_COLUMNS =
  "id, first_name, last_name, preferred_name, member_number, gender, date_of_birth, profession, employer, phone_e164, email, language, is_deceased, deceased_on, merged_into_id, interests, photo_opt_in, new_member_contact_opt_in, expertise_opt_in, expertise_headline";

function childLoginAge(rules: unknown): number {
  const v = rules && typeof rules === "object" ? (rules as Record<string, unknown>).child_login_age : undefined;
  return typeof v === "number" && v > 0 && v < 19 ? v : 13;
}

const failed = (what: string, error: unknown, log: string): Part<never> => {
  console.error(`[slideover] ${log}:`, error);
  return part.error(`Could not load ${what}: ${explainError(error)}`);
};

export async function loadPersonDetail(session: CrmSession, o: { personId: string; family: FamilyModel | null }): Promise<DetailLoad> {
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const majority = communityMajority(center);
  const rules = identifierRules(center.rules);

  const res = await db.from("people").select(PERSON_COLUMNS).eq("id", o.personId).eq("center_id", center.id).maybeSingle();
  if (res.error) return { status: "error", error: res.error };
  if (!res.data) return { status: o.family ? "not_here" : "not_found" };
  const p = res.data;

  // On a family page the person must be in that household: the page's own model says so (and gives the role and the primary flag).
  const inFamily = o.family ? [...o.family.adults, ...o.family.children].find((x) => x.id === p.id) : null;
  if (o.family && !inFamily) return { status: "not_here" };

  const [login, org, idRows, held, community] = await Promise.all([
    db.from("center_users").select("user_id, created_at").eq("center_id", center.id).eq("person_id", p.id).maybeSingle(),
    inFamily ? null : orgIds(db, center.id, { personIds: [p.id] }),
    db.from("external_ids").select("id, kind, system, value, valid_to").eq("center_id", center.id).eq("person_id", p.id).order("kind"),
    db.from("memberships").select("id, household_id, tier, status, starts_on, ends_on").eq("person_id", p.id).order("starts_on", { ascending: false }),
    o.family ? null : loadCommunityLocale(db, center),
  ]);

  const isChild = inFamily ? inFamily.isChild : !isAdultMember({ date_of_birth: p.date_of_birth, role: null }, today, majority);
  const age = ageOn(p.date_of_birth, today);
  const person: FamilyPerson =
    inFamily ?? {
      id: p.id,
      name: personName(p),
      firstName: p.preferred_name || p.first_name,
      role: "other",
      isPrimary: false,
      isChild,
      age,
      memberNumber: p.member_number,
      orgIds: org?.byPerson.get(p.id) ?? [],
      onApp: Boolean(login.data),
      deceased: p.is_deceased === true,
      alsoPrimaryOf: null,
      // D2: a child has no mobile or email on the page.
      values: personValues(isChild ? { ...p, phone_e164: null, email: null } : p, ""),
    };

  const account: Part<AccountFacts> = login.error
    ? failed("the app account", login.error, "app account")
    : part.ok({ linkedAt: login.data?.created_at ?? null, hasEmail: Boolean(p.email), hasMobile: Boolean(p.phone_e164), childLoginAge: childLoginAge(center.rules) });

  const [roles, waiver, background, profile, memberships] = await Promise.all([
    loadRoles(session, login.error ? null : (login.data?.user_id ?? null), Boolean(login.error)),
    loadWaiver(session, p.id),
    loadBackground(session, p.id),
    loadProfile(session, { id: p.id, interests: p.interests, isMinor: isChild }),
    loadMemberships(session, held),
  ]);

  const labelOf = (kind: string) => identifierKindLabel(kind, rules);
  const applicable = IDENTIFIER_KINDS.filter((k) => k !== "org_household");
  let ids: Part<IdsFacts>;
  if (idRows.error) ids = failed("the IDs", idRows.error, "external ids");
  else {
    ids = part.ok({
      rows: shapeIdRows({
        rows: idRows.data ?? [],
        memberNumber: p.member_number,
        today,
        labelOf,
        canView: (k) => (IDENTIFIER_KINDS as readonly string[]).includes(k) && canViewIdentifierKind(session, k as (typeof IDENTIFIER_KINDS)[number]),
        canManage: (k) => (IDENTIFIER_KINDS as readonly string[]).includes(k) && canManageIdentifierKind(session, k as (typeof IDENTIFIER_KINDS)[number]),
      }),
      addKinds: addIdKinds({
        canManage: (k) => (IDENTIFIER_KINDS as readonly string[]).includes(k) && canManageIdentifierKind(session, k as (typeof IDENTIFIER_KINDS)[number]),
        labelOf,
        rules,
        hints: KIND_HINTS,
      }),
      orgMemberDigits: rules.orgMemberDigits,
      hiddenKinds: applicable.filter((k) => !canViewIdentifierKind(session, k)).map(labelOf),
    });
  }

  const household: DetailHousehold | null = o.family ? detailHousehold(o.family) : null;
  const inHome = o.family ? { directory: o.family.values.directory_opt_in === "on", mail: o.family.values.physical_mail_opt_in !== "off" } : null;

  const check = o.family
    ? o.family.check
    : { today, majority, languages: personLanguageOptions(community?.languages ?? ["en"], p.language), zoneIds: [] as string[] };

  return {
    status: "ok",
    detail: {
      person,
      household,
      canEdit: canAccess(session, "householdsEdit") && !p.merged_into_id,
      mergedIntoId: p.merged_into_id,
      deceasedOn: p.deceased_on,
      timeZone: tz,
      check,
      account,
      roles: { roles, waiver, background },
      profileDetails: profile,
      privacy: {
        values: privacyValues(p),
        directory: inHome ? (inHome.directory ? "Listed with the household" : "Not listed") : null,
        mail: inHome ? (inHome.mail ? "Opted in (household)" : "Opted out (household)") : null,
      },
      ids,
      memberships,
      ownerLinks: { roles: canAccess(session, "roles") ? "/settings/team" : null },
    },
  };
}

// ---------------------------------------------------------------------------
// The deep sections, each on its own
// ---------------------------------------------------------------------------
/** Roles: only role managers can read other people's grants. A person with no sign-in has none. */
async function loadRoles(session: CrmSession, userId: string | null, loginFailed: boolean): Promise<Part<string[]>> {
  if (loginFailed) return part.error("Could not load the roles");
  if (!userId) return part.ok([]);
  if (!can(session, "roles.manage")) return part.noAccess();
  const { db, center } = session;
  const g = await db.from("role_grants").select("role_key, ends_at, status").eq("center_id", center.id).eq("user_id", userId).eq("status", "active");
  if (g.error) return failed("the roles", g.error, "role grants");
  const now = new Date().toISOString();
  const keys = [...new Set((g.data ?? []).filter((x) => !x.ends_at || x.ends_at > now).map((x) => x.role_key))];
  if (keys.length === 0) return part.ok([]);
  const names = await db.from("roles").select("key, name").in("key", keys);
  if (names.error) console.error("[slideover] role names could not be read; the keys are shown:", names.error);
  const by = new Map((names.data ?? []).map((r) => [r.key, r.name]));
  return part.ok(keys.map((k) => by.get(k) ?? k));
}

async function loadWaiver(session: CrmSession, personId: string): Promise<Part<string>> {
  if (!can(session, ["volunteers.view", "volunteers.manage"])) return part.noAccess();
  const a = await session.db.from("volunteer_assignments").select("waiver_consent_id, created_at").eq("person_id", personId).order("created_at", { ascending: false }).limit(20);
  if (a.error) return failed("the waiver", a.error, "volunteer assignments");
  const rows = a.data ?? [];
  return part.ok(rows.length === 0 ? "No volunteer shifts" : rows.some((r) => r.waiver_consent_id) ? "Signed" : "Not signed");
}

async function loadBackground(session: CrmSession, personId: string): Promise<Part<string>> {
  if (!can(session, ["safety.view", "safety.manage"])) return part.noAccess();
  const c = await session.db.from("background_checks").select("status, expires_on").eq("person_id", personId).order("created_at", { ascending: false }).limit(1);
  if (c.error) return failed("the background check", c.error, "background checks");
  const row = c.data?.[0];
  if (!row) return part.ok("None on file");
  const status = row.status === "clear" ? "Clear" : `${row.status[0].toUpperCase()}${row.status.slice(1)}`;
  return part.ok(`${status}${row.expires_on ? ` · expires ${row.expires_on}` : ""}`);
}

async function loadProfile(session: CrmSession, p: { id: string; interests: string[] | null; isMinor: boolean }): Promise<Part<ProfileDetails>> {
  const r = await loadProfileDetails(session, p);
  if (!r.ok) return failed("what this member gave in the app", r.error, "profile details");
  const d = r.data;
  return part.ok({
    anniversary: d.anniversary,
    dietary: d.dietary.map((x) => ({ label: x.label, retired: x.retired })),
    emergency: d.emergency,
    labelsNote: d.labelsNote,
    edit: { dietaryKeys: d.dietary.map((x) => x.key), dietaryOther: d.dietaryOther ?? "", options: d.options ?? [] },
  });
}

async function loadMemberships(
  session: CrmSession,
  held: { data: { id: string; household_id: string; tier: string; status: string; starts_on: string; ends_on: string | null }[] | null; error: unknown },
): Promise<Part<MembershipHeld[]>> {
  if (held.error) return failed("the memberships", held.error, "memberships");
  const rows = held.data ?? [];
  const { map, error } = await householdsById(session.db, rows.map((m) => m.household_id));
  if (error) console.error("[slideover] household names for memberships could not be read; the rows show no household:", error);
  return part.ok(
    rows.map((m) => {
      const h = map.get(m.household_id);
      return { id: m.id, tier: m.tier, status: m.status, startsOn: m.starts_on, endsOn: m.ends_on, household: h ? { name: h.display_name, number: h.household_number } : null };
    }),
  );
}
