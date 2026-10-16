import "server-only";

// The rows of a Giving export (slice 9): every row of the list as it is filtered, read through the SAME queries the list pages
// (src/lib/data/giving-lists.ts: paymentsInDb, pledgesInDb, openPledgesLite, readPledges, runSearch; src/lib/data/giving-bank.ts:
// bankLinesQuery; src/lib/data/giving-statements.ts: loadYearEndReview), so the file is the list.
// Row-level security decides every row, as on the list. Nothing here writes; the route records the export once the rows are read.
// A part that cannot be read stops the export with a sentence: a file is never silently partial.

import { identifierRules } from "@/lib/center-rules";
import { communityFormat } from "@/lib/community-format";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { bankLinesOrdered, bankLinesQuery } from "@/lib/data/giving-bank";
import { openPledgesLite, paymentsInDb, pledgesInDb, readPledges, runSearch, type PaymentRowDb, type PledgeRowDb } from "@/lib/data/giving-lists";
import { loadYearEndReview } from "@/lib/data/giving-statements";
import { campaignsForCenter } from "@/lib/data/lookups";
import { addDays, todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import {
  MAX_EXPORT_ROWS,
  bankLineExportHeader,
  bankLineExportLines,
  paymentExportHeader,
  paymentExportLines,
  pledgeExportHeader,
  pledgeExportLines,
  yearEndExportHeader,
  yearEndExportLines,
  type BankLineExportRow,
  type ExportFilter,
  type ExportHousehold,
  type GivingExportList,
  type PaymentExportRow,
  type PledgeExportRow,
  type YearEndExportRow,
} from "@/lib/giving-export/csv";
import {
  bankExportFilter,
  bankLineKey,
  methodWord,
  paymentExportFilter,
  pledgeExportFilter,
  sourceWord,
  yearEndExportFilter,
} from "@/lib/giving-export/filters";
import { PAYOUT_LOOKBACK_DAYS, bankViewFromParam, providerName } from "@/lib/giving-bank/views";
import { paymentQuery, paymentViewFromParam } from "@/lib/giving-lists/payments";
import { bucketFromParam, isOpenStatus, pledgeChipFromParam, selectOpen } from "@/lib/giving-lists/pledges";
import { searchFilter } from "@/lib/giving-lists/search";
import { chosenStatementYear, matchesFilter, parseFilter, type Delivery } from "@/lib/giving-statements/review";
import { isModuleEnabled } from "@/lib/modules";
import { loadExportCards } from "@/lib/people-v2/gap-load";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
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
  if (list === "payments") return readPayments(session, sp);
  if (list === "pledges") return readPledgesExport(session, sp);
  if (list === "bank_lines") return readBankLines(session, sp);
  return readYearEnd(session, sp);
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
    const ids = selectOpen(open.data, chip === "closed" || chip === "all" || chip === "soft" ? "open" : chip, bucket, today, center.time_zone).map((p) => p.id);
    const at = new Map(ids.map((id, i) => [id, i]));
    for (const part of chunk(ids)) {
      const res = await readPledges(session, part);
      if (res.error) return unread("The pledges", res.error);
      rows.push(...res.data);
    }
    rows = rows.sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
  } else {
    const read = await fetchAll((f, t) => pledgesInDb(session, chip === "closed" ? "closed" : chip === "soft" ? "soft" : "all", filterText, false).range(f, t), { max: MAX_EXPORT_ROWS });
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
    softCreditCents: r.soft_credit_cents,
    bankReconciled: r.status === "paid" && r.reconciled_at !== null,
  }));
  return { ok: true, header, lines: pledgeExportLines(exportRows, fams.map, { currency: fmt.currency }), filter, count: exportRows.length };
}

// -------------------------------------------------------------------------------------------------------------------------- Bank lines

type BankLineDb = {
  id: string;
  posted_on: string;
  amount_cents: number;
  description: string;
  payer_name: string | null;
  status: string;
  is_batch_deposit: boolean;
  matched_household_id: string | null;
  payment_id: string | null;
  payout_id: string | null;
  channel: string | null;
  reference: string | null;
};

async function readBankLines(session: CrmSession, sp: RawSearchParams): Promise<ExportRead> {
  const { db, center } = session;
  if (!canAccess(session, "bank") && !canAccess(session, "bankConfirm")) return fail(403, "you don't have access to this area.");
  const accountId = param(sp, "account");
  if (!isUuid(accountId)) return fail(400, "choose the bank account first.");
  const acct = await db.from("bank_accounts").select("id, name, last4").eq("center_id", center.id).eq("id", accountId).maybeSingle();
  if (acct.error) return unread("The bank account", acct.error);
  if (!acct.data) return fail(400, "that bank account was not found.");
  const account = acct.data;
  const { view, history } = bankViewFromParam(param(sp, "view"), param(sp, "show"), { zelle: true, payouts: isModuleEnabled(session, "accounting") });
  const key = bankLineKey(view, history);
  if (!key) return fail(400, "this view lists the members' reports, not bank lines. Export another view.");
  const label = `${account.name}${account.last4 ? ` ··${account.last4}` : ""}`;
  const filter = bankExportFilter(key, label);
  const fmt = communityFormat(center);
  const since = key === "payouts" ? addDays(todayInTz(center.time_zone), -PAYOUT_LOOKBACK_DAYS) : undefined;

  const read = await fetchAll((f, t) => bankLinesOrdered(bankLinesQuery(session, account.id, key, { count: false, since }), key).range(f, t), { max: MAX_EXPORT_ROWS });
  if (read.error) return unread("The bank lines", read.error);
  if (read.truncated) return tooMany("bank lines");
  const rows = read.data as unknown as BankLineDb[];

  // The receipt a matched line became, and the card payout a payout line is paired with.
  const receipts = new Map<string, string | null>();
  for (const part of chunk([...new Set(rows.flatMap((r) => (r.payment_id ? [r.payment_id] : [])))])) {
    const p = await db.from("payments").select("id, receipt_number").in("id", part);
    if (p.error) return unread("The receipts of the matched lines", p.error);
    for (const x of p.data ?? []) receipts.set(x.id, x.receipt_number);
  }
  const payouts = new Map<string, string>();
  for (const part of chunk([...new Set(rows.flatMap((r) => (r.payout_id ? [r.payout_id] : [])))])) {
    const p = await db.from("payouts").select("id, provider, provider_ref").in("id", part);
    if (p.error) return unread("The card payouts", p.error);
    for (const x of p.data ?? []) payouts.set(x.id, `${providerName(x.provider)} ${x.provider_ref}`);
  }
  const fams = await households(session, rows.flatMap((r) => (r.matched_household_id ? [r.matched_household_id] : [])));
  if (fams.error) return unread("The household cards", fams.error);

  const exportRows: BankLineExportRow[] = rows.map((r) => ({
    postedOn: r.posted_on,
    account: label,
    amountCents: r.amount_cents,
    channel: r.channel,
    description: r.description,
    payerName: r.payer_name,
    reference: r.reference,
    status: r.status,
    householdId: r.matched_household_id,
    receipt: r.payment_id ? (receipts.get(r.payment_id) ?? null) : null,
    payout: r.payout_id ? (payouts.get(r.payout_id) ?? null) : null,
    deposit: r.is_batch_deposit,
  }));
  return {
    ok: true,
    header: bankLineExportHeader(householdIdLabel(session)),
    lines: bankLineExportLines(exportRows, fams.map, { currency: fmt.currency }),
    filter,
    count: exportRows.length,
  };
}

// --------------------------------------------------------------------------------------------------------------------- Year-end totals

const DELIVERY_WORD: Record<Delivery, string> = { post: "By post", email: "By email", app: "In the member app", none: "Needs a fix" };

async function readYearEnd(session: CrmSession, sp: RawSearchParams): Promise<ExportRead> {
  const { center } = session;
  if (!canAccess(session, "statements")) return fail(403, "you don't have access to this area.");
  const year = chosenStatementYear(param(sp, "year"), todayInTz(center.time_zone));
  const show = parseFilter(param(sp, "show"));
  const review = await loadYearEndReview(session, year);
  if (review.state === "off") return fail(403, "the Statements module is switched off for this community.");
  if (review.state === "no_access") return fail(403, "you don't have access to this area.");
  if (review.state === "error") return { ok: false, status: 500, error: `${review.message} Nothing was exported; try again.` };
  const rows = review.rows.filter((r) => matchesFilter(r, show));
  const fams = await households(session, rows.map((r) => r.householdId));
  if (fams.error) return unread("The household cards", fams.error);
  const exportRows: YearEndExportRow[] = rows.map((r) => ({
    year,
    householdId: r.householdId,
    adults: r.adults.map((a) => a.name),
    gifts: r.giftCount,
    givenCents: r.givenCents,
    refundedCents: r.refundedCents,
    openingCents: r.openingCents,
    delivery: r.problems.length > 0 ? "Needs a fix" : DELIVERY_WORD[r.delivery],
  }));
  return {
    ok: true,
    header: yearEndExportHeader(householdIdLabel(session)),
    lines: yearEndExportLines(exportRows, fams.map, { currency: communityFormat(center).currency }),
    filter: yearEndExportFilter(year, show),
    count: exportRows.length,
  };
}
