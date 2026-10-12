import "server-only";

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority, isAdultMember } from "@/lib/commands/child-filter";
import { identifierRules } from "@/lib/center-rules";
import { loadCommunityLocale } from "@/lib/community-locale";
import { orgIds, personName } from "@/lib/data/lookups";
import { ageOn, todayInTz } from "@/lib/dates";
import { identifierKindLabel, isRetired } from "@/lib/identifiers";
import { isModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { IDENTIFIER_KINDS, can, canAccess, canViewIdentifierKind, type IdentifierKind } from "@/lib/permissions";
import { bestTier, personLanguageOptions } from "@/lib/people";
import type { CrmSession } from "@/lib/session";

import { householdValues, personValues, type FamilyId, type FamilyModel, type FamilyPerson } from "./family-model";

// Reads one household and the people in it as the signed-in person (the database's security decides what comes back), and works out
// the Family page's model. Nothing here writes. A read that fails is not hidden: the page says which part could not be read.

export type FamilyLoad =
  | { status: "ok"; model: FamilyModel; problems: string[] }
  | { status: "not_found" }
  | { status: "error"; error: unknown };

export async function loadFamily(session: CrmSession, id: string): Promise<FamilyLoad> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const majority = communityMajority(center);
  const rules = identifierRules(center.rules);
  const givingOn = isModuleEnabled(session, "giving");
  const seesGiving = givingOn && can(session, ["giving.view", "giving.manage", "giving.record_offline"]);
  const problems: string[] = [];

  const hh = await db
    .from("households")
    .select("id, display_name, household_number, zone_id, address_line1, address_line2, city, state_region, postal_code, merged_into_id, directory_opt_in, physical_mail_opt_in, notes")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (hh.error) return { status: "error", error: hh.error };
  if (!hh.data) return { status: "not_found" };
  const h = hh.data;

  const [links, zones, memberships, ext, community, cards] = await Promise.all([
    db.from("household_members").select("person_id, role, is_primary").eq("household_id", id).is("left_at", null),
    db.from("zones").select("id, name").eq("center_id", center.id).order("name"),
    db.from("memberships").select("tier, status, starts_on, ends_on").eq("household_id", id).eq("status", "active"),
    db.from("external_ids").select("id, kind, system, value, label, valid_to").eq("center_id", center.id).eq("household_id", id).order("kind"),
    loadCommunityLocale(db, center),
    adultHouseholdCards(db, [id], { today, currency: center.currency, majority }).catch((error: unknown) => {
      console.error("[family] could not read the household card; the open pledges and card line use what the page already has:", error);
      return null;
    }),
  ]);
  if (links.error) return { status: "error", error: links.error };
  if (zones.error) {
    console.error("[family] could not read the zones:", zones.error);
    problems.push("Could not load the list of zones, so the zone cannot be changed just now.");
  }
  if (memberships.error) {
    console.error("[family] could not read the memberships:", memberships.error);
    problems.push("Could not load the membership, so it is not shown just now.");
  }
  if (ext.error) {
    console.error("[family] could not read the identifiers:", ext.error);
    problems.push("Could not load the IDs just now.");
  }
  if (!cards) problems.push("Could not load the household card, so open pledges are not shown just now.");

  const personIds = (links.data ?? []).map((l) => l.person_id);
  const [people, logins, otherPrimary, org] = await Promise.all([
    personIds.length
      ? db
          .from("people")
          .select("id, first_name, last_name, preferred_name, member_number, gender, date_of_birth, profession, employer, phone_e164, email, language, is_deceased")
          .in("id", personIds)
      : null,
    personIds.length ? db.from("center_users").select("person_id").eq("center_id", center.id).in("person_id", personIds) : null,
    personIds.length ? db.from("household_members").select("person_id, household_id").in("person_id", personIds).eq("is_primary", true).is("left_at", null).neq("household_id", id) : null,
    orgIds(db, center.id, { personIds, householdIds: [id] }),
  ]);
  if (people?.error) return { status: "error", error: people.error };
  if (logins?.error) {
    console.error("[family] could not read who is on the app:", logins.error);
    problems.push("Could not tell who is on the app just now.");
  }
  if (org.error) console.error("[family] could not read the organization's ids:", org.error);

  const otherIds = [...new Set((otherPrimary?.data ?? []).map((o) => o.household_id))];
  const others = otherIds.length ? await db.from("households").select("id, household_number").in("id", otherIds) : null;
  const otherNumber = new Map((others?.data ?? []).map((o) => [o.id, o.household_number]));
  const primaryOf = new Map((otherPrimary?.data ?? []).map((o) => [o.person_id, { id: o.household_id, number: otherNumber.get(o.household_id) ?? null }]));
  const onApp = new Set((logins?.data ?? []).map((l) => l.person_id));
  const byPerson = new Map((people?.data ?? []).map((p) => [p.id, p]));

  const all: FamilyPerson[] = [];
  let hiddenPeople = 0;
  for (const l of links.data ?? []) {
    const p = byPerson.get(l.person_id);
    if (!p) {
      hiddenPeople += 1;
      continue;
    }
    all.push({
      id: p.id,
      name: personName(p),
      firstName: p.preferred_name || p.first_name,
      role: l.role,
      isPrimary: l.is_primary,
      isChild: !isAdultMember({ date_of_birth: p.date_of_birth, role: l.role }, today, majority),
      age: ageOn(p.date_of_birth, today),
      memberNumber: p.member_number,
      orgIds: org.byPerson.get(p.id) ?? [],
      onApp: onApp.has(p.id),
      deceased: p.is_deceased === true,
      alsoPrimaryOf: primaryOf.get(p.id) ?? null,
      values: personValues(p, l.role),
    });
  }
  const byAge = (a: FamilyPerson, b: FamilyPerson) => Number(b.isPrimary) - Number(a.isPrimary) || (b.age ?? 200) - (a.age ?? 200) || a.name.localeCompare(b.name);
  const adults = all.filter((p) => !p.isChild).sort(byAge);
  const children = all.filter((p) => p.isChild).sort(byAge);

  const active = bestTier(memberships.data ?? []);
  const zoneName = (zones.data ?? []).find((z) => z.id === h.zone_id)?.name ?? null;
  const card = cards?.cards[0];

  const ids: FamilyId[] = [];
  if (h.household_number) ids.push({ id: "number", kind: "connect_household", label: "Household number", value: h.household_number, system: null });
  for (const r of ext.data ?? []) {
    const kind = r.kind as IdentifierKind;
    if (!IDENTIFIER_KINDS.includes(kind) || !canViewIdentifierKind(session, kind) || isRetired(r.valid_to, today)) continue;
    ids.push({ id: r.id, kind, label: identifierKindLabel(kind, rules), value: r.value, system: r.system });
  }

  const merged = Boolean(h.merged_into_id);
  const model: FamilyModel = {
    id: h.id,
    name: h.display_name,
    number: h.household_number,
    orgLabel: rules.orgHouseholdLabel,
    orgMemberLabel: rules.orgMemberLabel,
    orgIds: org.byHousehold.get(id) ?? [],
    card: { number: h.household_number, orgIds: org.byHousehold.get(id) ?? [], adults: adults.map((a) => a.name), place: [h.city, zoneName].filter(Boolean).join(", ") || null },
    mergedIntoId: h.merged_into_id,
    membership: active ? { tier: active.tier, endsOn: active.ends_on } : null,
    openPledge: seesGiving && card && card.open_pledge_cents !== null ? { cents: card.open_pledge_cents, text: formatCents(card.open_pledge_cents, center.currency) } : null,
    adults,
    children,
    hiddenPeople,
    values: householdValues(h),
    zoneName,
    zones: zones.data ?? [],
    ids,
    canEdit: canAccess(session, "householdsEdit") && !merged,
    can: { recordPayment: givingOn && canAccess(session, "recordPayment") && !merged, seesGiving, seesIds: ids.length > 0 },
    check: { today, majority, languages: personLanguageOptions(community.languages), zoneIds: (zones.data ?? []).map((z) => z.id) },
  };
  return { status: "ok", model, problems };
}
