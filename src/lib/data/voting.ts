import "server-only";

import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { personName } from "@/lib/data/lookups";
import { ageOn, todayInTz } from "@/lib/dates";
import type { Json } from "@/lib/database.types";
import type { DbErrorLike } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { votingRules, householdVotingStatus, tenureMet, type VoterState } from "@/lib/voting";
import type { CrmSession } from "@/lib/session";

// People › Voting eligibility: life-member households with the rule checks,
// and every person's latest eligibility snapshot (computed nightly) with the
// two-person override flow.

export type VoterRow = {
  snapshotId: string;
  personId: string;
  name: string;
  householdName: string | null;
  computedAt: string;
  canVote: boolean;
  effective: boolean;
  reasons: string[];
  override: {
    requestedBy: string | null;
    requestedValue: boolean | null;
    reason: string | null;
    secondApprover: string | null;
    applied: boolean | null;
  };
};

export type LifeHouseholdRow = {
  id: string;
  name: string;
  number: string | null;
  since: string;
  priorYearOpen: boolean | null;
  tenureOk: boolean;
  status: VoterState;
};

export type VotingData = {
  waitDays: number;
  ballotCutoff: string | null;
  households: LifeHouseholdRow[];
  voters: VoterRow[];
  eligible: number;
  notEligible: number;
  canBecome: number | null;
  seesGiving: boolean;
  error: DbErrorLike | null;
};

function reasonList(j: Json): string[] {
  return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : typeof j === "string" ? [j] : [];
}

export async function loadVoting(session: CrmSession): Promise<VotingData> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const { waitDays, ballotCutoff } = votingRules(center.rules);
  const seesGiving = can(session, ["giving.view", "giving.manage"]);
  let error: DbErrorLike | null = null;

  const [life, snaps] = await Promise.all([
    fetchAll((f, t) => db.from("memberships").select("id, household_id, starts_on").eq("center_id", center.id).eq("tier", "life").eq("status", "active").order("id").range(f, t)),
    fetchAll((f, t) =>
      db
        .from("eligibility_snapshots")
        .select("id, person_id, computed_at, can_vote, reasons, override_by, override_reason, override_requested_value, override_second_approver, override_can_vote")
        .eq("center_id", center.id)
        .order("computed_at", { ascending: false })
        .order("id")
        .range(f, t),
    ),
  ]);
  error = life.error ?? snaps.error ?? null;

  // Latest snapshot per person.
  const latest = new Map<string, (typeof snaps.data)[number]>();
  for (const s of snaps.data) if (!latest.has(s.person_id)) latest.set(s.person_id, s);

  const since = new Map<string, string>();
  for (const m of life.data) {
    const cur = since.get(m.household_id);
    if (!cur || m.starts_on < cur) since.set(m.household_id, m.starts_on);
  }
  const hhIds = [...since.keys()];

  // Households, their adults, and prior-year open pledges.
  const hhRows: { id: string; display_name: string; household_number: string | null }[] = [];
  const adultsBy = new Map<string, string[]>();
  const personHousehold = new Map<string, string>();
  const priorOpen = new Set<string>();
  for (const part of chunk(hhIds)) {
    const [hh, links, pledges] = await Promise.all([
      db.from("households").select("id, display_name, household_number").in("id", part).is("merged_into_id", null),
      db.from("household_members").select("household_id, person_id").in("household_id", part).is("left_at", null),
      seesGiving
        ? db.from("pledges").select("household_id").in("household_id", part).in("status", ["open", "partially_paid"]).lt("pledged_at", yearStart)
        : null,
    ]);
    error ??= hh.error ?? links.error ?? pledges?.error ?? null;
    hhRows.push(...(hh.data ?? []));
    for (const p of pledges?.data ?? []) priorOpen.add(p.household_id);
    const ids = (links.data ?? []).map((l) => l.person_id);
    const people = ids.length ? await db.from("people").select("id, date_of_birth").in("id", ids) : null;
    error ??= people?.error ?? null;
    const dob = new Map((people?.data ?? []).map((p) => [p.id, p.date_of_birth]));
    for (const l of links.data ?? []) {
      personHousehold.set(l.person_id, l.household_id);
      const age = ageOn(dob.get(l.person_id), today);
      if (age === null || age >= 18) adultsBy.set(l.household_id, [...(adultsBy.get(l.household_id) ?? []), l.person_id]);
    }
  }

  const effective = (s: (typeof snaps.data)[number]) => s.override_can_vote ?? s.can_vote;
  const households: LifeHouseholdRow[] = hhRows
    .map((h) => {
      const s = since.get(h.id) ?? today;
      const adultSnaps = (adultsBy.get(h.id) ?? []).map((p) => latest.get(p)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      return {
        id: h.id,
        name: h.display_name,
        number: h.household_number,
        since: s,
        priorYearOpen: seesGiving ? priorOpen.has(h.id) : null,
        tenureOk: tenureMet(s, waitDays, today),
        status: householdVotingStatus(adultSnaps.map(effective)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Everyone with a snapshot, with names.
  const personIds = [...latest.keys()];
  const names = new Map<string, string>();
  for (const part of chunk(personIds)) {
    const r = await db.from("people").select("id, first_name, last_name, preferred_name").in("id", part);
    error ??= r.error ?? null;
    for (const p of r.data ?? []) names.set(p.id, personName(p));
  }
  const missingHh = personIds.filter((id) => !personHousehold.has(id));
  const extraNames = new Map<string, string>();
  for (const part of chunk(missingHh)) {
    const links = await db.from("household_members").select("person_id, household_id").in("person_id", part).is("left_at", null);
    error ??= links.error ?? null;
    const ids = [...new Set((links.data ?? []).map((l) => l.household_id))];
    const hh = ids.length ? await db.from("households").select("id, display_name").in("id", ids) : null;
    const by = new Map((hh?.data ?? []).map((h) => [h.id, h.display_name]));
    for (const l of links.data ?? []) if (!extraNames.has(l.person_id)) extraNames.set(l.person_id, by.get(l.household_id) ?? "");
  }
  const hhName = new Map(hhRows.map((h) => [h.id, h.display_name]));

  const voters: VoterRow[] = [...latest.values()]
    .map((s) => {
      const hid = personHousehold.get(s.person_id);
      return {
        snapshotId: s.id,
        personId: s.person_id,
        name: names.get(s.person_id) ?? "Not visible to you",
        householdName: (hid ? hhName.get(hid) : extraNames.get(s.person_id)) || null,
        computedAt: s.computed_at,
        canVote: s.can_vote,
        effective: effective(s),
        reasons: reasonList(s.reasons),
        override: {
          requestedBy: s.override_by,
          requestedValue: s.override_requested_value,
          reason: s.override_reason,
          secondApprover: s.override_second_approver,
          applied: s.override_can_vote,
        },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const notEligible = voters.filter((v) => !v.effective);
  let canBecome: number | null = null;
  if (seesGiving) {
    canBecome = notEligible.filter((v) => {
      const hid = personHousehold.get(v.personId);
      const row = hid ? households.find((h) => h.id === hid) : undefined;
      return row ? row.tenureOk && row.priorYearOpen === true : false;
    }).length;
  }

  return {
    waitDays,
    ballotCutoff,
    households,
    voters,
    eligible: voters.length - notEligible.length,
    notEligible: notEligible.length,
    canBecome,
    seesGiving,
    error,
  };
}
