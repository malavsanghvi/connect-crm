import "server-only";

import { householdCards, peopleById } from "@/lib/data/lookups";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { isModuleEnabled } from "@/lib/modules";
import type { CrmSession } from "@/lib/session";

import type { FamilyModel, FamilyPerson } from "./family-model";
import {
  canChangeMemberships,
  householdCardLine,
  liveOf,
  type AssignContext,
  type MembershipRow,
  type MembershipTypeOption,
  type MembershipsData,
} from "./memberships";
import { detailHousehold, householdLine, part, type Part } from "./slideover";

// Reads the Memberships section of the person slide-over, as the signed-in person (the database's security decides what comes back):
// the memberships this person holds and the ones of the family the page is about, each with its type, holder and the family's card
// line; and, for a person who may change them (both people.approve and people.manage), what "Assign a membership" needs. Nothing here
// writes. A role that cannot read memberships gets "You don't have access to this area", never an empty list.

const LIMIT = 60;

type MembershipRecord = {
  id: string;
  household_id: string;
  person_id: string | null;
  membership_type_id: string;
  tier: string;
  status: string;
  starts_on: string;
  ends_on: string | null;
  notes: string | null;
  fee_pledge_id: string | null;
};

type TypeRecord = { id: string; name: string; tier: string; fee_cents: number; period_months: number | null; active: boolean };

const failed = (what: string, error: unknown): Part<never> => {
  console.error(`[slideover] the ${what} could not be read:`, error);
  return part.error(`Could not load ${what}: ${explainError(error)}`);
};

export async function loadMembershipsPanel(session: CrmSession, o: { person: FamilyPerson; model: FamilyModel }): Promise<Part<MembershipsData>> {
  if (!canAccess(session, "memberships")) return part.noAccess();
  const { db, center } = session;
  const { person, model } = o;
  const today = todayInTz(center.time_zone);
  const canChange = canChangeMemberships((p) => can(session, p));

  const [mem, types] = await Promise.all([
    db
      .from("memberships")
      .select("id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, notes, fee_pledge_id")
      .eq("center_id", center.id)
      .or(`person_id.eq.${person.id},household_id.eq.${model.id}`)
      .order("starts_on", { ascending: false })
      .limit(LIMIT + 1),
    db.from("membership_types").select("id, name, tier, fee_cents, period_months, active").eq("center_id", center.id).order("name"),
  ]);
  if (mem.error) return failed("the memberships", mem.error);
  if (types.error) return failed("the membership types", types.error);

  const records = (mem.data ?? []) as MembershipRecord[];
  const truncated = records.length > LIMIT;
  const shown = truncated ? records.slice(0, LIMIT) : records;
  const typeById = new Map((types.data as TypeRecord[]).map((t) => [t.id, t]));

  // Names: the family's own people are known; anyone else who holds a membership is looked up.
  const known = new Map<string, string>([...model.adults, ...model.children].map((p) => [p.id, p.name]));
  const unknownHolders = shown.map((m) => m.person_id).filter((id): id is string => Boolean(id) && !known.has(id as string));
  if (unknownHolders.length > 0) {
    const looked = await peopleById(db, unknownHolders);
    if (looked.error) console.error("[slideover] the holders' names could not be read; their rows say nobody is named:", looked.error);
    for (const [id, p] of looked.map) known.set(id, p.name);
  }

  // The family card line of every family on the list (never a name alone).
  const thisLine = householdLine(detailHousehold(model));
  const otherIds = [...new Set(shown.map((m) => m.household_id).filter((id) => id !== model.id))];
  const cardLines = new Map<string, string[]>();
  if (otherIds.length > 0) {
    const cards = await householdCards(db, otherIds);
    if (cards.error) console.error("[slideover] a household card for the memberships could not be read; those rows show no family:", cards.error);
    for (const [id, c] of cards.map) cardLines.set(id, householdCardLine(c));
  }

  const rows: MembershipRow[] = shown.map((m) => {
    const t = typeById.get(m.membership_type_id);
    return {
      id: m.id,
      householdId: m.household_id,
      tier: m.tier,
      typeName: t?.name ?? "Membership",
      status: m.status,
      startsOn: m.starts_on,
      endsOn: m.ends_on,
      notes: m.notes,
      holder: m.person_id && known.has(m.person_id) ? { id: m.person_id, name: known.get(m.person_id) as string } : null,
      household: m.household_id === model.id ? thisLine : (cardLines.get(m.household_id) ?? []),
      hasFeePledge: Boolean(m.fee_pledge_id),
      fixedTerm: t?.period_months != null,
    };
  });

  let assign: AssignContext | null = null;
  if (canChange && !model.mergedIntoId) {
    const money = (cents: number) => formatCents(cents, center.currency);
    const options: MembershipTypeOption[] = (types.data as TypeRecord[])
      .filter((t) => t.active)
      .map((t) => ({ id: t.id, name: t.name, tier: t.tier, feeCents: t.fee_cents, feeLabel: t.fee_cents > 0 ? money(t.fee_cents) : null, periodMonths: t.period_months }));
    const holders = model.adults.filter((a) => !a.deceased).map((a) => ({ id: a.id, name: a.name }));
    const defaultHolderId =
      holders.find((h) => h.id === person.id)?.id ?? model.adults.find((a) => a.isPrimary && !a.deceased)?.id ?? holders[0]?.id ?? null;
    const live = liveOf(rows, model.id, today);
    assign = {
      householdId: model.id,
      household: thisLine,
      types: options,
      holders,
      defaultHolderId,
      givingOn: isModuleEnabled(session, "giving"),
      live: live ? { id: live.id, tier: live.tier, typeName: live.typeName, endsOn: live.endsOn } : null,
    };
  }

  return part.ok({ rows, truncated, today, canChange, assign });
}
