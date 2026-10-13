import "server-only";

import { identifierRules } from "@/lib/center-rules";
import { must, rpcJson } from "@/lib/commands/catalog/db";
import { loadAdults } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { communityFormat } from "@/lib/community-format";
import { chunk } from "@/lib/data/fetch-all";
import { loadPledgeDesignations } from "@/lib/data/record-pledge";
import { addDays, dateInTz, startOfDayInTz, todayInTz } from "@/lib/dates";
import { pledgeDueDays } from "@/lib/giving-due";
import { hitsFrom, type HouseholdHit } from "@/lib/giving-upload/households";
import type { ExistingPledge, PledgeLookups, PledgeTarget, UploadAdult } from "@/lib/giving-upload/pledges";
import { conventionsFor, type Conventions, type EarlierUpload } from "@/lib/giving-upload/sheet";
import { kindTerm } from "@/lib/kind";
import type { CrmSession } from "@/lib/session";

// Giving uploads (GV-U) on the server: what the review needs, read with the person's own access (row level security), and the
// list of earlier uploads. Nothing here writes: recording goes through app.record_pledge_upload (0776).

export type UploadSetting = {
  today: string;
  timeZone: string;
  currency: string;
  locale: string;
  conv: Conventions;
  dueDays: number;
  labels: { orgMemberLabel: string; orgHouseholdLabel: string };
  household: string;
};

export function uploadSetting(session: CrmSession): UploadSetting {
  const { center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  return {
    today: todayInTz(center.time_zone),
    timeZone: center.time_zone,
    currency: fmt.currency,
    locale: fmt.locale,
    conv: conventionsFor(fmt),
    dueDays: pledgeDueDays(center.rules),
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    household: kindTerm(session.kind, "household", "household"),
  };
}

type HitRow = Parameters<typeof hitsFrom>[0][number];

/** The households each value names (app.giving_upload_households, 0776): by any identifier, else by name (always a pick). */
export async function lookupHouseholds(session: CrmSession, values: readonly string[]): Promise<HouseholdHit[]> {
  const out: HouseholdHit[] = [];
  for (const part of chunk([...values], 400)) {
    const rows = (await rpcJson(session.db, "giving_upload_households", { p_center: session.center.id, p_values: part }, "look up the households")) as
      | HitRow[]
      | null;
    out.push(...hitsFrom(rows ?? []));
  }
  return out;
}

/** What a pledge can be for: the same choices as the Record pledge sheet (own-flow campaigns and full opportunities left out). */
export async function pledgeTargets(session: CrmSession): Promise<PledgeTarget[]> {
  const d = await loadPledgeDesignations(session);
  return [
    ...d.opportunities.map((o) => ({ kind: "opportunity" as const, id: o.id, name: o.name })),
    ...d.campaigns.map((c) => ({ kind: "campaign" as const, id: c.id, name: c.name })),
    ...d.funds.map((f) => ({ kind: "fund" as const, id: f.id, name: f.name })),
  ];
}

/** The adults of these households by the community's own age of majority, without anyone who has died. Never a child. */
export async function adultsOf(session: CrmSession, householdIds: readonly string[]): Promise<Record<string, UploadAdult[]>> {
  const ids = [...new Set(householdIds)];
  if (ids.length === 0) return {};
  const dir = await loadAdults(session.db, ids, todayInTz(session.center.time_zone), communityMajority(session.center));
  const all = [...dir.byHousehold.values()].flat().map((a) => a.id);
  const gone = new Set<string>();
  for (const part of chunk(all, 150)) {
    const rows = must(await session.db.from("people").select("id").in("id", part).eq("is_deceased", true), "read the households' adults") ?? [];
    for (const r of rows) gone.add(r.id);
  }
  const out: Record<string, UploadAdult[]> = {};
  for (const [hh, list] of dir.byHousehold) out[hh] = list.filter((a) => !gone.has(a.id)).map((a) => ({ id: a.id, name: a.name }));
  return out;
}

/** Pledges of these households made between two days (the community's days), for the repeat check. Cancelled ones are left out. */
export async function existingPledges(session: CrmSession, householdIds: readonly string[], from: string, to: string): Promise<ExistingPledge[]> {
  const { db, center } = session;
  const ids = [...new Set(householdIds)];
  if (ids.length === 0) return [];
  const tz = center.time_zone;
  const out: ExistingPledge[] = [];
  for (const part of chunk(ids, 100)) {
    const rows =
      must(
        await db
          .from("pledges")
          .select("pledge_number, household_id, amount_cents, campaign_id, fund_id, opportunity_id, pledged_at")
          .eq("center_id", center.id)
          .in("household_id", part)
          .neq("status", "cancelled")
          .gte("pledged_at", startOfDayInTz(from, tz))
          .lt("pledged_at", startOfDayInTz(addDays(to, 1), tz))
          .limit(5000),
        "read the households' pledges",
      ) ?? [];
    for (const r of rows) {
      out.push({
        number: r.pledge_number,
        householdId: r.household_id,
        amountCents: r.amount_cents,
        campaignId: r.campaign_id,
        fundId: r.fund_id,
        opportunityId: r.opportunity_id,
        pledgedOn: dateInTz(r.pledged_at, tz),
      });
    }
  }
  return out;
}

/** Everything the pledge review needs for these rows. */
export async function pledgeLookups(
  session: CrmSession,
  values: readonly string[],
  pledgedDays: readonly string[],
): Promise<PledgeLookups> {
  const s = uploadSetting(session);
  const [hits, targets] = await Promise.all([lookupHouseholds(session, values), pledgeTargets(session)]);
  const households = [...new Set(hits.map((h) => h.householdId))];
  const days = [...pledgedDays, s.today].sort();
  const [adults, existing] = await Promise.all([adultsOf(session, households), existingPledges(session, households, days[0], days[days.length - 1])]);
  return {
    today: s.today,
    dueDays: s.dueDays,
    currency: s.currency,
    locale: s.locale,
    labels: s.labels,
    household: s.household,
    hits,
    targets,
    adults,
    existing,
  };
}

export type UploadSummary = {
  id: string;
  kind: "pledges" | "payments";
  fileName: string | null;
  reason: string;
  rowCount: number;
  totalCents: number;
  createdAt: string;
  createdByMe: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
};

/** The latest uploads of one kind (row level security: Giving staff, or the person who made them). */
export async function recentUploads(session: CrmSession, kind: "pledges" | "payments", limit = 10): Promise<UploadSummary[]> {
  const rows =
    must(
      await session.db
        .from("giving_uploads")
        .select("id, kind, file_name, reason, row_count, total_cents, created_at, created_by, cancelled_at, cancel_reason")
        .eq("center_id", session.center.id)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .limit(limit),
      "read the earlier uploads",
    ) ?? [];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind === "payments" ? "payments" : "pledges",
    fileName: r.file_name,
    reason: r.reason,
    rowCount: r.row_count,
    totalCents: r.total_cents,
    createdAt: r.created_at,
    createdByMe: r.created_by === session.userId,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  }));
}

/** An earlier upload of the same file (by its fingerprint) that was not cancelled, to warn before it is recorded twice. */
export async function sameFileUpload(session: CrmSession, kind: "pledges" | "payments", sha256: string): Promise<{ createdAt: string; rowCount: number } | null> {
  const rows =
    must(
      await session.db
        .from("giving_uploads")
        .select("created_at, row_count")
        .eq("center_id", session.center.id)
        .eq("kind", kind)
        .eq("file_sha256", sha256)
        .is("cancelled_at", null)
        .order("created_at", { ascending: false })
        .limit(1),
      "read the earlier uploads",
    ) ?? [];
  return rows[0] ? { createdAt: rows[0].created_at, rowCount: rows[0].row_count } : null;
}

/**
 * The latest pledge uploads with whether each can still be cancelled: only while every pledge of it is open with nothing paid and no
 * write-off asked (app.cancel_pledge_upload checks the same again).
 */
export async function earlierPledgeUploads(session: CrmSession): Promise<EarlierUpload[]> {
  const list = await recentUploads(session, "pledges");
  return Promise.all(
    list.map(async (u) => {
      if (u.cancelledAt) return { ...u, cancellable: false, note: null };
      const rows =
        must(
          await session.db
            .from("pledges")
            .select("status, paid_cents, written_off_by")
            .eq("center_id", session.center.id)
            .like("idempotency_key", `upl:${u.id}:%`)
            .limit(600),
          "read the pledges of the earlier uploads",
        ) ?? [];
      const moved = rows.filter((r) => r.status !== "open" || r.paid_cents !== 0 || r.written_off_by !== null).length;
      return {
        ...u,
        cancellable: moved === 0 && rows.length > 0,
        note:
          moved > 0
            ? `${moved} of its pledges ${moved === 1 ? "has" : "have"} money applied or another status, so each pledge is handled on its own.`
            : null,
      };
    }),
  );
}
