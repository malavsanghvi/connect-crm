import "server-only";

// Giving › Pledges and Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3): what each list shows,
// read through the same tables and functions the classic screens read. Row-level security decides every row (a finance volunteer
// sees only the payments they recorded); this file only shapes them. Nothing here writes.
//
// Paging and speed: 50 rows a page with exact counts. Pledges: one read of the community's open pledges (a few columns, as the
// classic aging card already does) gives every chip count and the aging buckets, and the Open, Behind, Waiting and bucket views
// page through it; Closed and All page in the database. Payments page in the database. Search: see src/lib/giving-lists/search.ts.

import type { HouseholdCardData } from "@/components/household-card";
import { identifierRules } from "@/lib/center-rules";
import type { Enums } from "@/lib/database.types";
import { communityFormat } from "@/lib/community-format";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { campaignsForCenter, householdCards, userNames } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { LIST_WORDS, filterSentence } from "@/lib/giving-export/csv";
import { paymentExportFilter, pledgeExportFilter } from "@/lib/giving-export/filters";
import { writeOffPostingText, type WriteOffPosting } from "@/lib/giving";
import { recordPaymentHref } from "@/lib/giving-lists/links";
import { PAGE_SIZE, exportHref, exportOffer, pager, switchedOff, type ListBody, type PaymentsModel, type PledgesModel } from "@/lib/giving-lists/model";
import {
  GRANT_KINDS,
  RECURRING_CHIPS,
  flaggedRow,
  grantRow,
  methodChips,
  paymentRow,
  paymentQuery,
  paymentViewChips,
  paymentViewFromParam,
  recurringChipFromParam,
  recurringRow,
  sourceChips,
  type FlaggedIn,
  type PaymentViewKey,
  type PaymentQuery,
  type ViewState,
  yearChips,
} from "@/lib/giving-lists/payments";
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  bucketChips,
  bucketFromParam,
  pledgeChipFromParam,
  pledgeChips,
  pledgeRow,
  selectOpen,
  summarizeOpen,
  type OpenPledgeLite,
} from "@/lib/giving-lists/pledges";
import { MAX_FAMILIES, matchedBy, matchedByText, readListSearch, searchFilter, type ListSearch } from "@/lib/giving-lists/search";
import type { ListContext, ListRow } from "@/lib/giving-lists/types";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import { GIVING_ADDONS, givingTabs } from "@/lib/giving-today/tabs";
import { readRecordPrefill, type RecordPrefill } from "@/lib/giving-workspace/view";
import { isModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";
import { workspaceLabel } from "@/lib/workspaces";

/** PayPal connected by its Business email only: its refunds are made in PayPal and recorded here by hand (#7). */
export async function readPaypalEmailOnly(session: CrmSession): Promise<boolean> {
  const r = await session.db.rpc("paypal_email_only", { p_center: session.center.id });
  if (r.error) {
    console.error("[giving] paypal_email_only failed; PayPal refunds are offered through PayPal:", r.error);
    return false;
  }
  return r.data === true;
}

function listContext(session: CrmSession, paypalEmailOnly: boolean): ListContext {
  const { center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  return {
    me: session.userId,
    can: {
      manage: canAccess(session, "givingManage"),
      approve: canAccess(session, "givingApprove"),
      record: canAccess(session, "recordPayment"),
      allocate: canAccess(session, "allocatePayment"),
      bankConfirm: canAccess(session, "bankConfirm"),
    },
    currency: fmt.currency,
    locale: fmt.locale,
    timeZone: center.time_zone,
    today: todayInTz(center.time_zone),
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    paypalEmailOnly,
  };
}

type Searched = { search: ListSearch | null; householdIds: string[]; problem: string | null };

export async function runSearch(session: CrmSession, q: string, currency: string): Promise<Searched> {
  const search = readListSearch(q, currency);
  if (!search?.familyText) return { search, householdIds: [], problem: null };
  const found = await searchHouseholds(session.db, session.center.id, search.familyText, { limit: MAX_FAMILIES });
  return {
    search,
    householdIds: found.householdIds.slice(0, MAX_FAMILIES),
    problem: found.error ? failure("Could not search every family; the list may miss some", found.error).error : null,
  };
}

async function familiesOf(session: CrmSession, ids: (string | null | undefined)[]): Promise<{ map: Map<string, Family>; problem: string | null }> {
  const cards = await householdCards(session.db, ids);
  const map = new Map<string, Family>();
  for (const [id, c] of cards.map) map.set(id, familyFrom(c));
  return {
    map,
    problem: cards.error ? failure("Could not read some families' details; those rows show the number only", cards.error).error : null,
  };
}

function common(session: CrmSession, ctx: ListContext, q: string, searchLabel: string, searchBase: string) {
  return {
    title: workspaceLabel("giving", session.kind),
    tabs: givingTabs(session),
    currency: ctx.currency,
    locale: ctx.locale,
    timeZone: ctx.timeZone,
    today: ctx.today,
    labels: ctx.labels,
    q,
    searchLabel,
    searchBase,
    pager: null,
    expandSingle: false,
    problems: [] as string[],
    note: null as string | null,
    recordHref: ctx.can.record ? recordPaymentHref() : null,
  };
}

const err = (e: string, retry: string): ListBody => ({ state: "error", error: e, retry });

// ---------------------------------------------------------------------------- Pledges

const PLEDGE_COLUMNS =
  "id, pledge_number, household_id, campaign_id, amount_cents, paid_cents, status, pledged_at, due_on, written_off_by, written_off_second_approver, write_off_reason, written_off_by_name, updated_at";

export async function loadPledgesList(session: CrmSession, sp: RawSearchParams): Promise<PledgesModel> {
  const { db, center } = session;
  const ctx = listContext(session, false);
  const q = param(sp, "q") ?? "";
  const base = common(session, ctx, q, "Find a pledge by family, pledge number or amount", hrefWith("/giving/pledges", sp, { q: undefined, page: undefined }));
  if (!canAccess(session, "pledges")) {
    return { ...base, body: { state: "no_access", area: "Pledges", access: "pledges" }, chips: [], buckets: [], summary: null };
  }
  const chip = pledgeChipFromParam(param(sp, "status"));
  const bucket = bucketFromParam(param(sp, "age"));
  const page = pageParam(sp);
  const retry = hrefWith("/giving/pledges", sp, {});
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const problems: string[] = [];

  const searched = await runSearch(session, q, ctx.currency);
  if (searched.problem) problems.push(searched.problem);
  const { search, householdIds } = searched;
  const filter = search ? searchFilter(search, { numberColumn: "pledge_number", householdIds }) : null;
  const nothing = search !== null && filter === null;

  const [openRes, closedRes] = nothing
    ? [{ data: [] as OpenPledgeLite[], error: null, truncated: false }, { count: 0, error: null }]
    : await Promise.all([
        openPledgesLite(session, filter),
        (() => {
          let x = db.from("pledges").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", [...CLOSED_STATUSES]);
          if (filter) x = x.or(filter);
          return x;
        })(),
      ]);
  if (openRes.error) problems.push(failure("Could not count the open pledges", openRes.error).error);
  if (closedRes.error) problems.push(failure("Could not count the closed pledges", closedRes.error).error);
  const summary = openRes.error ? null : summarizeOpen(openRes.data, ctx.today, ctx.timeZone);

  const chips = pledgeChips(summary, closedRes.error ? null : (closedRes.count ?? 0), chip, bucket, (k) =>
    hrefWith("/giving/pledges", sp, { status: k === "open" ? undefined : k, age: undefined, page: undefined }),
  );
  const buckets = bucketChips(summary, bucket, money, (b) => hrefWith("/giving/pledges", sp, { age: bucket === b ? undefined : b, status: undefined, page: undefined }));
  const summaryText = summary
    ? `${money(summary.open.cents)} open across ${summary.open.count.toLocaleString("en-US")} ${summary.open.count === 1 ? "pledge" : "pledges"}` +
      (summary.behind.count > 0 ? ` · ${money(summary.behind.cents)} of it behind` : "") +
      (openRes.truncated ? " · the first 50,000 only" : "")
    : null;

  // The page of rows: from the open pledges for Open, Behind, Waiting and the buckets; from the database for Closed and All.
  const from = (page - 1) * PAGE_SIZE;
  let total = 0;
  let rows: Awaited<ReturnType<typeof readPledges>>["data"] = [];
  let rowsError: string | null = null;
  if (nothing) {
    total = 0;
  } else if (bucket || chip === "open" || chip === "behind" || chip === "waiting") {
    if (openRes.error) rowsError = failure("Could not read the pledges", openRes.error).error;
    else {
      const list = selectOpen(openRes.data, chip === "closed" || chip === "all" ? "open" : chip, bucket, ctx.today, ctx.timeZone);
      total = list.length;
      const ids = list.slice(from, from + PAGE_SIZE).map((p) => p.id);
      const res = await readPledges(session, ids);
      if (res.error) rowsError = failure("Could not read the pledges", res.error).error;
      const at = new Map(ids.map((id, i) => [id, i]));
      rows = [...res.data].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0));
    }
  } else {
    const res = await pledgesInDb(session, chip === "closed" ? "closed" : "all", filter, true).range(from, from + PAGE_SIZE - 1);
    if (res.error) rowsError = failure("Could not read the pledges", res.error).error;
    rows = res.data ?? [];
    total = res.count ?? rows.length;
  }

  const [families, campaigns, names, postings] = await Promise.all([
    familiesOf(session, rows.map((r) => r.household_id)),
    campaignsForCenter(db, center.id),
    userNames(db, center.id, rows.map((r) => r.written_off_by)),
    (async () => {
      const ids = rows.filter((r) => r.status === "written_off").map((r) => r.id);
      if (ids.length === 0) return { map: {} as Record<string, WriteOffPosting>, problem: null as string | null };
      const r = await db.rpc("pledge_writeoff_postings", { p_pledges: ids });
      return r.error
        ? { map: {}, problem: failure("Could not read the QuickBooks status of written-off pledges", r.error).error }
        : { map: (r.data ?? {}) as Record<string, WriteOffPosting>, problem: null };
    })(),
  ]);
  if (families.problem) problems.push(families.problem);
  if (campaigns.error) problems.push(failure("Could not read the campaign names", campaigns.error).error);
  if (postings.problem) problems.push(postings.problem);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const idSet = new Set(householdIds);

  const listRows: ListRow[] = rows.map((r) => {
    const posting = writeOffPostingText(postings.map[r.id]);
    return pledgeRow(
      {
        id: r.id,
        number: r.pledge_number,
        householdId: r.household_id,
        campaign: r.campaign_id ? (campaignName.get(r.campaign_id) ?? "Campaign") : null,
        amountCents: r.amount_cents,
        paidCents: r.paid_cents,
        status: r.status,
        pledgedAt: r.pledged_at,
        dueOn: r.due_on,
        writeOffBy: r.written_off_by,
        writeOffByName: r.written_off_by ? (names.get(r.written_off_by)?.name ?? null) : null,
        writeOffSecond: r.written_off_second_approver,
        writeOffReason: r.write_off_reason,
        writeOffSince: r.written_off_by ? r.updated_at : null,
        importedWriteOffBy: r.written_off_by_name,
        posting: posting ? { tone: posting.tone, label: posting.label } : null,
      },
      families.map.get(r.household_id) ?? null,
      ctx,
      matchedByText(matchedBy(search, { number: r.pledge_number, amountCents: r.amount_cents, householdId: r.household_id }, idSet), "pledge number"),
    );
  });

  return {
    ...base,
    body: rowsError
      ? err(rowsError, retry)
      : { state: "ok", rows: listRows, empty: search ? `No pledge matches “${search.text}”.` : bucket ? "No pledge is behind by that many days." : "No pledges here." },
    pager: pager(page, total, (n) => hrefWith("/giving/pledges", sp, { page: n })),
    expandSingle: search !== null && total === 1,
    problems,
    exportOffer: rowsError
      ? null
      : exportOffer(
          session,
          "pledges",
          exportHref("pledges", sp),
          total,
          filterSentence(pledgeExportFilter(chip, bucket, search ? q : null), LIST_WORDS.pledges.whole),
          param(sp, "export") === "1",
        ),
    chips,
    buckets,
    summary: summaryText,
  };
}

/** The community's open pledges, a few columns: every chip count, the aging buckets, and the Open, Behind and Waiting views and their export. */
export function openPledgesLite(session: CrmSession, filter: string | null) {
  const { db, center } = session;
  return fetchAll((f, t) => {
    let x = db
      .from("pledges")
      .select("id, amount_cents, paid_cents, status, pledged_at, due_on, written_off_by")
      .eq("center_id", center.id)
      .in("status", [...OPEN_STATUSES]);
    if (filter) x = x.or(filter);
    return x.order("id").range(f, t);
  }).then((r) => ({
    ...r,
    data: r.data.map(
      (p): OpenPledgeLite => ({
        id: p.id,
        amountCents: p.amount_cents,
        paidCents: p.paid_cents,
        status: p.status,
        pledgedAt: p.pledged_at,
        dueOn: p.due_on,
        writeOffBy: p.written_off_by,
      }),
    ),
  }));
}

/** Closed or All pledges, newest first, read in the database: the list pages them, the export reads them all. */
export function pledgesInDb(session: CrmSession, chip: "closed" | "all", filter: string | null, count: boolean) {
  let x = session.db.from("pledges").select(PLEDGE_COLUMNS, { count: count ? "exact" : undefined }).eq("center_id", session.center.id);
  if (chip === "closed") x = x.in("status", [...CLOSED_STATUSES]);
  if (filter) x = x.or(filter);
  return x.order("pledged_at", { ascending: false }).order("id", { ascending: false });
}

export async function readPledges(session: CrmSession, ids: string[]) {
  if (ids.length === 0) return { data: [] as PledgeRowDb[], error: null };
  const r = await session.db.from("pledges").select(PLEDGE_COLUMNS).eq("center_id", session.center.id).in("id", ids);
  return { data: (r.data ?? []) as PledgeRowDb[], error: r.error };
}

export type PledgeRowDb = {
  id: string;
  pledge_number: string | null;
  household_id: string;
  campaign_id: string | null;
  amount_cents: number;
  paid_cents: number;
  status: "open" | "partially_paid" | "paid" | "written_off" | "cancelled";
  pledged_at: string;
  due_on: string | null;
  written_off_by: string | null;
  written_off_second_approver: string | null;
  write_off_reason: string | null;
  written_off_by_name: string | null;
  updated_at: string;
};

// ---------------------------------------------------------------------------- Payments

const PAYMENT_COLUMNS =
  "id, receipt_number, household_id, received_on, method, amount_cents, status, provider, check_number, envelope_number, recorded_by, refunded_cents, refund_approved_by, refund_second_approver, refund_reason, refund_requested_cents, updated_at, deposit_bank_transaction_id, is_opening_balance";

export type PaymentRowDb = {
  id: string;
  receipt_number: string | null;
  household_id: string;
  received_on: string;
  method: string;
  amount_cents: number;
  status: string;
  provider: string | null;
  check_number: string | null;
  envelope_number: string | null;
  recorded_by: string | null;
  refunded_cents: number;
  refund_approved_by: string | null;
  refund_second_approver: string | null;
  refund_reason: string | null;
  refund_requested_cents: number | null;
  updated_at: string;
  deposit_bank_transaction_id: string | null;
  is_opening_balance: boolean;
};

/** All payments or Refund requests, in the list's order: the list pages them, the export reads them all. */
export function paymentsInDb(session: CrmSession, q: PaymentQuery, filter: string | null, count: boolean) {
  let x = session.db.from("payments").select(PAYMENT_COLUMNS, { count: count ? "exact" : undefined }).eq("center_id", session.center.id);
  if (q.view === "refunds") x = x.not("refund_approved_by", "is", null);
  if (q.method) x = x.in("method", [...q.method.methods] as Enums<"payment_method">[]);
  if (q.source?.key === "offline" || q.source?.key === "bank") x = x.eq("provider", q.source.key);
  if (q.source?.key === "online") x = x.not("provider", "in", "(offline,bank)");
  if (q.year !== null) x = x.gte("received_on", `${q.year}-01-01`).lt("received_on", `${q.year + 1}-01-01`);
  if (filter) x = x.or(filter);
  const ordered =
    q.view === "refunds"
      ? x.order("refunded_cents", { ascending: true }).order("updated_at", { ascending: false })
      : x.order("received_on", { ascending: false }).order("created_at", { ascending: false });
  return ordered.order("id", { ascending: false });
}

export type RecordSlot = { household: HouseholdCardData | null; values: RecordPrefill | null; canAllocate: boolean; bankOn: boolean };

export type PaymentsPage = PaymentsModel & { record: RecordSlot | null };

export async function loadPaymentsList(session: CrmSession, sp: RawSearchParams): Promise<PaymentsPage> {
  const { db, center } = session;
  const seesAll = canAccess(session, "paymentsAll");
  const ctx0 = listContext(session, false);
  const q = param(sp, "q") ?? "";
  const view = paymentViewFromParam(param(sp, "view"));
  const base = {
    ...common(session, ctx0, q, "", hrefWith("/giving/payments", sp, { q: undefined, page: undefined })),
    view,
    views: [],
    methods: [],
    sources: [],
    years: [],
    statuses: [],
    flagged: [],
    record: null,
  };
  if (!canAccess(session, "payments")) return { ...base, body: { state: "no_access", area: "Payments", access: "payments" } };

  const bankOn = isModuleEnabled(session, GIVING_ADDONS.bank);
  const states: Record<Exclude<PaymentViewKey, "all">, ViewState> = {
    refunds: seesAll || ctx0.can.manage || ctx0.can.approve ? "on" : "no_access",
    grants: !bankOn ? "off" : canAccess(session, "bank") ? "on" : "no_access",
    recurring: !isModuleEnabled(session, GIVING_ADDONS.recurring) ? "off" : canAccess(session, "recurring") ? "on" : "no_access",
  };
  const needsPaypal = ctx0.can.manage && (view === "all" || view === "refunds");
  const [paypalEmailOnly, plugins] = await Promise.all([
    needsPaypal ? readPaypalEmailOnly(session) : Promise.resolve(false),
    view === "all" ? enabledPaymentPlugins(session) : Promise.resolve(null),
  ]);
  const ctx: ListContext = { ...ctx0, paypalEmailOnly };
  const page = pageParam(sp);
  const from = (page - 1) * PAGE_SIZE;
  const retry = hrefWith("/giving/payments", sp, {});
  const problems: string[] = [];
  const pageHref = (n: number) => hrefWith("/giving/payments", sp, { page: n });

  // Record payment until slice 2's sheet: today's form above the list.
  let record: RecordSlot | null = null;
  const prefillId = param(sp, "household");
  const values = ctx.can.record ? readRecordPrefill(sp, ctx.today) : null;
  if (ctx.can.record && (param(sp, "record") === "1" || isUuid(prefillId) || values)) {
    let household: HouseholdCardData | null = null;
    if (isUuid(prefillId)) {
      const cards = await householdCards(db, [prefillId]);
      if (cards.error) problems.push(failure("Could not read the family to record for; choose it in the form", cards.error).error);
      household = cards.map.get(prefillId) ?? null;
    }
    record = { household, values, canAllocate: ctx.can.allocate, bankOn };
  }

  // The counts on the view chips: refunds waiting for someone, grants still to match.
  const [refundCount, flaggedRes, grantCount] = await Promise.all([
    states.refunds === "on" && seesAll
      ? db.from("payments").select("id", { count: "exact", head: true }).eq("center_id", center.id).not("refund_approved_by", "is", null).eq("refunded_cents", 0)
      : Promise.resolve(null),
    states.refunds === "on" ? db.rpc("flagged_refunds", { p_center: center.id }) : Promise.resolve(null),
    states.grants === "on"
      ? db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("originator_kind", [...GRANT_KINDS]).gt("amount_cents", 0).in("status", ["unmatched", "suggested"])
      : Promise.resolve(null),
  ]);
  if (refundCount?.error) console.error("[payments] counting refund requests failed:", refundCount.error);
  if (grantCount?.error) console.error("[payments] counting grants to match failed:", grantCount.error);
  const flaggedList = ((flaggedRes?.data ?? []) as unknown as RawFlagged[]).map(toFlagged);
  const views = paymentViewChips(
    states,
    {
      refunds: (refundCount?.count ?? 0) + flaggedList.length || null,
      grants: grantCount?.count || null,
    },
    view,
    (v) => hrefWith("/giving/payments", {}, { view: v === "all" ? undefined : v }),
  );
  const note = !can(session, ["giving.view", "giving.manage"])
    ? "Limited view: you see the payments you recorded yourself. The rest are for the treasurer."
    : null;
  const shell = { ...base, views, record, note, problems };

  if (view !== "all" && states[view] !== "on") {
    const body: ListBody =
      states[view] === "off"
        ? switchedOff(session.kind, view === "grants" ? "giving_bank" : "giving_recurring", center.short_name || center.name)
        : {
            state: "no_access",
            area: view === "refunds" ? "Refunds" : view === "grants" ? "Grants to match" : "Recurring gifts",
            access: view === "refunds" ? "paymentsAll" : view === "grants" ? "bank" : "recurring",
          };
    return { ...shell, body };
  }

  const searched = await runSearch(session, q, ctx.currency);
  if (searched.problem) problems.push(searched.problem);
  const { search, householdIds } = searched;
  const idSet = new Set(householdIds);

  // ------------------------------------------------------------------ All payments and Refunds: the same row
  if (view === "all" || view === "refunds") {
    const filter = search ? searchFilter(search, { numberColumn: "receipt_number", householdIds }) : null;
    const nothing = search !== null && filter === null;
    const query = paymentQuery(view, (k) => param(sp, k), ctx.today);
    const { method, source, year } = query;
    let rows: PaymentRowDb[] = [];
    let total = 0;
    let rowsError: string | null = null;
    if (!nothing && (view === "all" || seesAll)) {
      const res = await paymentsInDb(session, query, filter, true).range(from, from + PAGE_SIZE - 1);
      if (res.error) rowsError = failure(view === "refunds" ? "Could not read the refund requests" : "Could not read the payments", res.error).error;
      rows = (res.data ?? []) as PaymentRowDb[];
      total = res.count ?? rows.length;
    }

    // What each payment is applied to: readable by giving staff only (payment_allocations), never guessed for anyone else.
    const applied = new Map<string, number>();
    let appliedOk = seesAll && view === "all";
    if (appliedOk) {
      for (const part of chunk(rows.map((r) => r.id))) {
        const a = await db.from("payment_allocations").select("payment_id, amount_cents").in("payment_id", part);
        if (a.error) {
          problems.push(failure("Could not read what the payments are applied to", a.error).error);
          appliedOk = false;
          break;
        }
        for (const r of a.data ?? []) applied.set(r.payment_id, (applied.get(r.payment_id) ?? 0) + r.amount_cents);
      }
    }
    const flaggedRows = view === "refunds" ? flaggedList : [];
    const [families, names] = await Promise.all([
      familiesOf(session, [...rows.map((r) => r.household_id), ...flaggedRows.map((f) => f.householdId)]),
      userNames(db, center.id, [...rows.map((r) => r.recorded_by), ...rows.map((r) => r.refund_approved_by)]),
    ]);
    if (families.problem) problems.push(families.problem);
    if (flaggedRes?.error) problems.push(failure("Could not read the refunds made in a card provider's dashboard", flaggedRes.error).error);

    const listRows = rows.map((r) =>
      paymentRow(
        {
          id: r.id,
          receipt: r.receipt_number,
          householdId: r.household_id,
          receivedOn: r.received_on,
          method: r.method,
          amountCents: r.amount_cents,
          status: r.status,
          provider: r.provider,
          checkNumber: r.check_number,
          envelopeNumber: r.envelope_number,
          recordedBy: r.recorded_by,
          recordedByName: r.recorded_by ? (names.get(r.recorded_by)?.name ?? null) : null,
          refundedCents: r.refunded_cents,
          refundBy: r.refund_approved_by,
          refundByName: r.refund_approved_by ? (names.get(r.refund_approved_by)?.name ?? null) : null,
          refundSecond: r.refund_second_approver,
          refundReason: r.refund_reason,
          refundRequestedCents: r.refund_requested_cents,
          refundSince: r.refund_approved_by ? r.updated_at : null,
          deposited: r.provider === "offline" && (r.method === "check" || r.method === "cash") ? r.deposit_bank_transaction_id !== null : null,
          openingBalance: r.is_opening_balance,
          appliedCents: appliedOk ? (applied.get(r.id) ?? 0) : null,
        },
        families.map.get(r.household_id) ?? null,
        ctx,
        matchedByText(matchedBy(search, { number: r.receipt_number, amountCents: r.amount_cents, householdId: r.household_id }, idSet), "receipt number"),
      ),
    );
    const chipHref = (key: string, value: string | null) => hrefWith("/giving/payments", sp, { [key]: value ?? undefined, page: undefined });
    return {
      ...shell,
      searchLabel: view === "refunds" ? "Find a refund by family, receipt number or amount" : "Find a payment by family, receipt number or amount",
      methods: view === "all" ? methodChips(method?.key ?? null, ctx.locale, plugins ?? [], (k) => chipHref("method", k)) : [],
      sources: view === "all" ? sourceChips(source?.key ?? null, bankOn, (k) => chipHref("source", k)) : [],
      years: view === "all" ? yearChips(year, ctx.today, (k) => chipHref("year", k)) : [],
      flagged: flaggedRows.map((f) => flaggedRow(f, families.map.get(f.householdId) ?? null, ctx)),
      body: rowsError
        ? err(rowsError, retry)
        : view === "refunds" && !seesAll
          ? { state: "ok", rows: [], empty: "Refund requests are listed for people who see every payment." }
          : {
              state: "ok",
              rows: listRows,
              empty: search
                ? `No ${view === "refunds" ? "refund request" : "payment"} matches “${search.text}”.`
                : view === "refunds"
                  ? "No refund requests. Ask for one from a payment's menu (⋯) in All payments."
                  : "No payments match.",
            },
      pager: pager(page, total, pageHref),
      expandSingle: search !== null && total === 1,
      exportOffer:
        rowsError || (view === "refunds" && !seesAll)
          ? null
          : exportOffer(
              session,
              "payments",
              exportHref("payments", sp),
              total,
              filterSentence(paymentExportFilter(query, search ? q : null, ctx.locale), LIST_WORDS.payments.whole),
              param(sp, "export") === "1",
            ),
    };
  }

  // ------------------------------------------------------------------ Grants to match
  if (view === "grants") {
    const parts: string[] = [];
    if (search?.amountCents != null) parts.push(`amount_cents.eq.${search.amountCents}`);
    const text = search ? search.text.replace(/[%*,()"\\:]/g, " ").trim() : "";
    if (text.length >= 2) parts.push(`payer_name.ilike.*${text}*`, `description.ilike.*${text}*`, `reference.ilike.*${text}*`);
    let x = db
      .from("bank_transactions")
      .select("id, posted_on, amount_cents, description, payer_name, reference, check_or_slip, originator_kind, status, matched_household_id", { count: "exact" })
      .eq("center_id", center.id)
      .in("originator_kind", [...GRANT_KINDS])
      .gt("amount_cents", 0)
      .in("status", ["unmatched", "suggested", "matched"]);
    if (parts.length > 0) x = x.or(parts.join(","));
    const res = await x.order("status", { ascending: false }).order("posted_on", { ascending: false }).range(from, from + PAGE_SIZE - 1);
    const rows = res.data ?? [];
    const families = await familiesOf(session, rows.map((r) => r.matched_household_id));
    if (families.problem) problems.push(families.problem);
    return {
      ...shell,
      searchLabel: "Find a grant by sender, memo or amount",
      body: res.error
        ? err(failure("Could not read the grants to match", res.error).error, retry)
        : {
            state: "ok",
            rows: rows.map((g) =>
              grantRow(
                {
                  id: g.id,
                  postedOn: g.posted_on,
                  amountCents: g.amount_cents,
                  description: g.description,
                  payerName: g.payer_name,
                  reference: g.reference,
                  checkOrSlip: g.check_or_slip,
                  kind: g.originator_kind,
                  status: g.status,
                  matchedFamily: g.matched_household_id ? (families.map.get(g.matched_household_id) ?? null) : null,
                },
                ctx,
              ),
            ),
            empty: search ? `No grant matches “${search.text}”.` : "No fund grants or matching gifts to match. They appear here after a bank statement is imported.",
          },
      pager: pager(page, res.count ?? rows.length, pageHref),
      expandSingle: search !== null && (res.count ?? 0) === 1,
    };
  }

  // ------------------------------------------------------------------ Recurring (read-only)
  // Recurring (read-only): the last view (the counts have their own tab since slice 5).
  const status = recurringChipFromParam(param(sp, "rstatus"));
  const filter = search ? searchFilter(search, { numberColumn: null, householdIds }) : null;
  const nothing = search !== null && filter === null;
  let x = db
    .from("recurring_gifts")
    .select("id, household_id, campaign_id, fund_id, amount_cents, frequency, method, next_charge_on, status, links_to_pledges, special_day_id", { count: "exact" })
    .eq("center_id", center.id);
  if (status !== "all") x = x.eq("status", status);
  if (filter) x = x.or(filter);
  const res = nothing ? { data: [], count: 0, error: null } : await x.order("next_charge_on", { ascending: true, nullsFirst: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const fundIds = [...new Set(rows.map((r) => r.fund_id).filter((v): v is string => Boolean(v)))];
  const [families, campaigns, funds] = await Promise.all([
    familiesOf(session, rows.map((r) => r.household_id)),
    campaignsForCenter(db, center.id),
    fundIds.length ? db.from("funds").select("id, name").in("id", fundIds) : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (families.problem) problems.push(families.problem);
  if (campaigns.error || funds.error) problems.push(failure("Could not read some campaign or fund names", campaigns.error ?? funds.error).error);
  const campaignName = new Map(campaigns.data.map((c) => [c.id, c.name]));
  const fundName = new Map((funds.data ?? []).map((f) => [f.id, f.name]));
  return {
    ...shell,
    searchLabel: "Find a recurring gift by family or amount",
    statuses: RECURRING_CHIPS.map((c) => ({
      key: c.key,
      label: c.label,
      href: hrefWith("/giving/payments", sp, { rstatus: c.key === "all" ? undefined : c.key, page: undefined }),
      count: null,
      on: c.key === status,
    })),
    body: res.error
      ? err(failure("Could not read the recurring gifts", res.error).error, retry)
      : {
          state: "ok",
          rows: rows.map((r) =>
            recurringRow(
              {
                id: r.id,
                householdId: r.household_id,
                amountCents: r.amount_cents,
                frequency: r.frequency,
                method: r.method,
                nextChargeOn: r.next_charge_on,
                status: r.status,
                cause: r.campaign_id
                  ? (campaignName.get(r.campaign_id) ?? "Campaign")
                  : r.fund_id
                    ? (fundName.get(r.fund_id) ?? "Fund")
                    : r.special_day_id
                      ? "A special day"
                      : "General fund",
                linksToPledges: Boolean(r.links_to_pledges),
              },
              families.map.get(r.household_id) ?? null,
              ctx,
            ),
          ),
          empty: search ? `No recurring gift matches “${search.text}”.` : "No recurring gifts here. Members set them up in the member app.",
        },
    pager: pager(page, res.count ?? rows.length, pageHref),
  };
}

type RawFlagged = {
  id: string;
  provider: string;
  amount_cents: number;
  refunded_on: string | null;
  provider_ref: string;
  first_approver: string | null;
  first_approver_name: string | null;
  receipt_number: string | null;
  household_id: string;
  payment_amount_cents: number;
};

function toFlagged(f: RawFlagged): FlaggedIn {
  return {
    id: f.id,
    provider: f.provider,
    amountCents: f.amount_cents,
    refundedOn: f.refunded_on,
    providerRef: f.provider_ref,
    firstApprover: f.first_approver,
    firstApproverName: f.first_approver_name,
    receipt: f.receipt_number,
    householdId: f.household_id,
    paymentAmountCents: f.payment_amount_cents,
  };
}
