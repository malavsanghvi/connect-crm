import "server-only";

// The rows of a Giving export (slice 9): every row of the list as it is filtered, read through the SAME queries the list pages
// (src/lib/data/giving-lists.ts: paymentsInDb, pledgesInDb, openPledgesLite, readPledges, runSearch), so the file is the list.
// Row-level security decides every row, as on the list. Nothing here writes; the route records the export once the rows are read.
// A part that cannot be read stops the export with a sentence: a file is never silently partial.

import { identifierRules } from "@/lib/center-rules";
import { communityFormat } from "@/lib/community-format";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { openPledgesLite, paymentsInDb, pledgesInDb, readPledges, runSearch, type PaymentRowDb, type PledgeRowDb } from "@/lib/data/giving-lists";
import { campaignsForCenter } from "@/lib/data/lookups";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import {
  MAX_EXPORT_ROWS,
  paymentExportHeader,
  paymentExportLines,
  pledgeExportHeader,
  pledgeExportLines,
  type ExportFilter,
  type ExportHousehold,
  type GivingExportList,
  type PaymentExportRow,
  type PledgeExportRow,
} from "@/lib/giving-export/csv";
import { methodWord, paymentExportFilter, pledgeExportFilter, sourceWord } from "@/lib/giving-export/filters";
import { paymentQuery, paymentViewFromParam } from "@/lib/giving-lists/payments";
import { bucketFromParam, isOpenStatus, pledgeChipFromParam, selectOpen } from "@/lib/giving-lists/pledges";
import { searchFilter } from "@/lib/giving-lists/search";
import { loadExportCards } from "@/lib/people-v2/gap-load";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

export type ExportRead =
  | { ok: true; header: string[]; lines: string[][]; filter: ExportFilter; count: number }
  | { ok: false; status: number; error: string };

const fail = (status: number, error: string): ExportRead => ({ ok: false, status, error: `Could not export the list — ${error}` });
const unread = (what: string, error: unknown) => {
  console.error(`[giving export] ${what} could not be read:`, error);
  return fail(500, `${what} could not be read: ${explainError(error)}. Nothing was exported; try again.`);
};
const tooMany = (word: string) => fail(400, `it has more than ${MAX_EXPORT_ROWS.toLocaleString("en-US")} ${word}. Narrow it with a chip, a year or a search first.`);

export async function readGivingExport(session: CrmSession, list: GivingExportList, sp: RawSearchParams): Promise<ExportRead> {
  return list === "payments" ? readPayments(session, sp) : readPledgesExport(session, sp);
}

/** Household number, community household ID and the adults' household name for each family (never a child's name). */
async function households(session: CrmSession, ids: string[]): Promise<{ map: Map<string, ExportHousehold>; error: unknown }> {
  const cards = await loadExportCards(session, ids);
  const map = new Map<string, ExportHousehold>();
  for (const [id, c] of cards.cards) map.set(id, { number: c.number, orgId: c.orgId, name: c.name });
  return { map, error: cards.error };
}

function householdIdLabel(session: CrmSession): string {
  return identifierRules(session.center.rules).orgHouseholdLabel || "Community household ID";
}

// ---------------------------------------------------------------------------------------------------------------------------- Payments

async function readPayments(session: CrmSession, sp: RawSearchParams): Promise<ExportRead> {
  const { db, center } = session;
  if (!canAccess(session, "payments")) return fail(403, "you don't have access to this area.");
  const viewKey = paymentViewFromParam(param(sp, "view"));
  if (viewKey !== "all" && viewKey !== "refunds") return fail(400, "this view has no export. Export All payments or Refunds.");
  if (viewKey === "refunds" && !canAccess(session, "paymentsAll")) return fail(403, "refund requests are exported by the people who see every payment.");
  const fmt = communityFormat(center);
  const today = todayInTz(center.time_zone);
  const query = paymentQuery(viewKey, (k) => param(sp, k), today);
  const q = param(sp, "q") ?? "";

  const searched = await runSearch(session, q, fmt.currency);
  if (searched.problem) return fail(500, `${searched.problem} Nothing was exported; try again.`);
  const { search, householdIds } = searched;
  const filterText = search ? searchFilter(search, { numberColumn: "receipt_number", householdIds }) : null;
  const filter = paymentExportFilter(query, search ? q : null, fmt.locale);
  if (search !== null && filterText === null) return { ok: true, header: paymentExportHeader(householdIdLabel(session)), lines: [], filter, count: 0 };

  const read = await fetchAll((f, t) => paymentsInDb(session, query, filterText, false).range(f, t), { max: MAX_EXPORT_ROWS });
  if (read.error) return unread("The payments", read.error);
  if (read.truncated) return tooMany("payments");
  const rows = read.data as PaymentRowDb[];

  // What each payment was applied to: pledge numbers and campaign names (payment_allocations, readable by giving staff).
  const allocations = new Map<string, string[]>();
  const pledgeIdsOf = new Map<string, string[]>();
  for (const part of chunk(rows.map((r) => r.id))) {
    const a = await db.from("payment_allocations").select("payment_id, pledge_id").in("payment_id", part);
    if (a.error) return unread("What the payments are applied to", a.error);
    for (const x of a.data ?? []) pledgeIdsOf.set(x.payment_id, [...(pledgeIdsOf.get(x.payment_id) ?? []), x.pledge_id]);
  }
  const pledgeIds = [...new Set([...pledgeIdsOf.values()].flat())];
  const pledgeWord = new Map<string, string>();
  if (pledgeIds.length > 0) {
    const campaigns = await campaignsForCenter(db, center.id);
    if (campaigns.error) return unread("The campaign names", campaigns.error);
    const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
    for (const part of chunk(pledgeIds)) {
      const p = await db.from("pledges").select("id, pledge_number, campaign_id").in("id", part);
      if (p.error) return unread("The pledges the payments are applied to", p.error);
      for (const x of p.data ?? []) {
        const campaign = x.campaign_id ? campaignName.get(x.campaign_id) : null;
        pledgeWord.set(x.id, `${x.pledge_number ?? "Pledge"}${campaign ? ` (${campaign})` : ""}`);
      }
    }
  }
  for (const [paymentId, ids] of pledgeIdsOf) allocations.set(paymentId, ids.map((id) => pledgeWord.get(id) ?? "Pledge"));

  const fams = await households(session, rows.map((r) => r.household_id));
  if (fams.error) return unread("The household cards", fams.error);

  const exportRows: PaymentExportRow[] = rows.map((r) => ({
    receipt: r.receipt_number,
    receivedOn: r.received_on,
    householdId: r.household_id,
    method: r.method,
    checkNumber: r.check_number,
    source: sourceWord(r.provider),
    status: r.status,
    amountCents: r.amount_cents,
    refundedCents: r.refunded_cents,
    appliedTo: allocations.get(r.id) ?? [],
    openingBalance: r.is_opening_balance,
  }));
  return {
    ok: true,
    header: paymentExportHeader(householdIdLabel(session)),
    lines: paymentExportLines(exportRows, fams.map, { currency: fmt.currency, methodWord: methodWord(fmt.locale) }),
    filter,
    count: exportRows.length,
  };
}

// ----------------------------------------------------------------------------------------------------------------------------- Pledges

async function readPledgesExport(session: CrmSession, sp: RawSearchParams): Promise<ExportRead> {
  const { db, center } = session;
  if (!canAccess(session, "pledges")) return fail(403, "you don't have access to this area.");
  const fmt = communityFormat(center);
  const today = todayInTz(center.time_zone);
  const chip = pledgeChipFromParam(param(sp, "status"));
  const bucket = bucketFromParam(param(sp, "age"));
  const q = param(sp, "q") ?? "";

  const searched = await runSearch(session, q, fmt.currency);
  if (searched.problem) return fail(500, `${searched.problem} Nothing was exported; try again.`);
  const { search, householdIds } = searched;
  const filterText = search ? searchFilter(search, { numberColumn: "pledge_number", householdIds }) : null;
  const filter = pledgeExportFilter(chip, bucket, search ? q : null);
  const header = pledgeExportHeader(householdIdLabel(session));
  if (search !== null && filterText === null) return { ok: true, header, lines: [], filter, count: 0 };

  let rows: PledgeRowDb[] = [];
  if (bucket || chip === "open" || chip === "behind" || chip === "waiting") {
    const open = await openPledgesLite(session, filterText);
    if (open.error) return unread("The pledges", open.error);
    if (open.truncated) return tooMany("pledges");
    const ids = selectOpen(open.data, chip === "closed" || chip === "all" ? "open" : chip, bucket, today, center.time_zone).map((p) => p.id);
    const at = new Map(ids.map((id, i) => [id, i]));
    for (const part of chunk(ids)) {
      const res = await readPledges(session, part);
      if (res.error) return unread("The pledges", res.error);
      rows.push(...res.data);
    }
    rows = rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  } else {
    const read = await fetchAll((f, t) => pledgesInDb(session, chip === "closed" ? "closed" : "all", filterText, false).range(f, t), { max: MAX_EXPORT_ROWS });
    if (read.error) return unread("The pledges", read.error);
    if (read.truncated) return tooMany("pledges");
    rows = read.data as PledgeRowDb[];
  }

  const campaigns = await campaignsForCenter(db, center.id);
  if (campaigns.error) return unread("The campaign names", campaigns.error);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const fams = await households(session, rows.map((r) => r.household_id));
  if (fams.error) return unread("The household cards", fams.error);

  const exportRows: PledgeExportRow[] = rows.map((r) => ({
    number: r.pledge_number,
    pledgedOn: r.pledged_at,
    dueOn: r.due_on,
    householdId: r.household_id,
    campaign: r.campaign_id ? (campaignName.get(r.campaign_id) ?? "Campaign") : null,
    status: r.status,
    amountCents: r.amount_cents,
    paidCents: r.paid_cents,
    writeOffWaiting: isOpenStatus(r.status) && r.written_off_by !== null,
  }));
  return { ok: true, header, lines: pledgeExportLines(exportRows, fams.map, { currency: fmt.currency }), filter, count: exportRows.length };
}
