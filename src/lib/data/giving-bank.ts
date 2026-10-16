import "server-only";

// Giving › Bank in the New look (docs/GIVING_REDESIGN.md slice 4): reads what the classic Bank screen reads, through the same
// readers Today uses for its bank rows (giftLinesIn, depositLinesIn, loadExact), and hands the pure core (src/lib/giving-bank/views.ts)
// what one view needs. Nothing here writes. A part that cannot be read says so at the top; the rest of the page still works.

import { identifierRules } from "@/lib/center-rules";
import { communityFormat } from "@/lib/community-format";
import { countsForBankLines } from "@/lib/data/giving-counts";
import { loadUnbanked, unbankedCount } from "@/lib/data/giving-reconcile";
import { depositLinesIn, giftLinesIn, loadExact } from "@/lib/data/giving-today";
import { householdCards, userNames } from "@/lib/data/lookups";
import { chunk } from "@/lib/data/fetch-all";
import { addDays, todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { LIST_WORDS, filterSentence } from "@/lib/giving-export/csv";
import { bankExportFilter, bankLineKey, type BankLineKey } from "@/lib/giving-export/filters";
import {
  BANK_PAGE_SIZE,
  PAYOUT_LOOKBACK_DAYS,
  READ_ONLY_NOTE,
  bankPager,
  bankViewChips,
  bankViewFromParam,
  depositRows,
  emptyText,
  historyChips,
  historyRowView,
  matchRows,
  pairPayouts,
  payoutRowView,
  zelleRows,
  type BankModel,
  type BankViewKey,
  type BankViewsOn,
  type HistoryKey,
  type HistoryLineIn,
  type LearnedView,
  type PayoutPair,
} from "@/lib/giving-bank/views";
import { exportHref, exportOffer, switchedOff } from "@/lib/giving-lists/model";
import { familyFrom, type ExactPairIn, type Family } from "@/lib/giving-today/queue";
import { GIVING_ADDONS, givingTabs } from "@/lib/giving-today/tabs";
import { pluginName } from "@/lib/kind-samples";
import { isModuleEnabled } from "@/lib/modules";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import { parseReportQueue, type ReportQueue } from "@/lib/payments/zelle";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";
import { workspaceLabel } from "@/lib/workspaces";

const BASE = "/giving/payments/bank";
const LINE_COLUMNS =
  "id, posted_on, amount_cents, description, payer_name, originator_kind, status, is_batch_deposit, matched_household_id, payment_id, payout_id, matched_by, matched_at, notes, channel, reference";

/**
 * The lines one Bank view lists for one account: the tab pages them (with their count), the export reads them all (slice 9), so
 * the file is the view. Card payout lines go back PAYOUT_LOOKBACK_DAYS from `since`.
 */
export function bankLinesQuery(session: CrmSession, accountId: string, key: BankLineKey, o: { count: boolean; since?: string }) {
  const q = session.db
    .from("bank_transactions")
    .select(LINE_COLUMNS, { count: o.count ? "exact" : undefined })
    .eq("center_id", session.center.id)
    .eq("bank_account_id", accountId);
  switch (key) {
    case "match":
      return q.in("status", ["unmatched", "suggested"]).gt("amount_cents", 0).eq("is_batch_deposit", false);
    case "deposits":
      return q.in("status", ["unmatched", "suggested"]).gt("amount_cents", 0).eq("is_batch_deposit", true);
    case "out":
      return q.in("status", ["unmatched", "suggested"]).lte("amount_cents", 0);
    case "matched":
      return q.eq("status", "matched");
    case "ignored":
      return q.eq("status", "ignored");
    case "payouts":
      return o.since ? q.eq("status", "payout").gte("posted_on", o.since) : q.eq("status", "payout");
  }
}

/** The order a view lists its lines in: waiting lines oldest first, the rest newest first. */
export function bankLinesOrdered(query: ReturnType<typeof bankLinesQuery>, key: BankLineKey) {
  return key === "match" || key === "deposits" ? query.order("posted_on", { ascending: true }).order("id") : query.order("posted_on", { ascending: false }).order("id");
}

export async function loadBankTab(session: CrmSession, sp: RawSearchParams): Promise<BankModel> {
  const { db, center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  const today = todayInTz(center.time_zone);
  const zelleWord = pluginName("zelle");
  const ctx = { currency: fmt.currency, locale: fmt.locale, timeZone: center.time_zone, today, zelleWord };
  const canConfirm = canAccess(session, "bankConfirm");
  const canIgnore = canAccess(session, "bankIgnore");
  const problems: string[] = [];
  const base: BankModel = {
    title: workspaceLabel("giving", session.kind),
    tabs: givingTabs(session),
    currency: fmt.currency,
    locale: fmt.locale,
    timeZone: center.time_zone,
    today,
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    zelleWord,
    view: "match",
    views: [],
    history: "matched",
    historyChips: [],
    body: { state: "ok" },
    accounts: [],
    account: null,
    zelleAccounts: [],
    rows: [],
    zelle: null,
    payouts: [],
    historyRows: [],
    learned: { state: "ok", rows: [] },
    pager: null,
    problems,
    note: null,
    empty: "",
    can: {
      confirm: canConfirm,
      ignore: canIgnore,
      import: canAccess(session, "bankImport"),
      configureZelle: can(session, ["giving.manage", "integrations.manage"]),
      pairPayouts: canAccess(session, "payoutPair"),
      undoMatch: canAccess(session, "givingManage"),
    },
  };
  if (!canAccess(session, "bank") && !canConfirm) return { ...base, body: { state: "no_access", area: "Bank reconciliation", access: "bank" } };
  if (!isModuleEnabled(session, GIVING_ADDONS.bank)) return { ...base, body: switchedOff(session.kind, GIVING_ADDONS.bank, center.short_name || center.name) };
  const retry = hrefWith(BASE, sp, {});

  const accountsRes = await db.from("bank_accounts").select("id, name, last4, statement_format, active").eq("center_id", center.id).order("name");
  if (accountsRes.error) return { ...base, body: { state: "error", error: failure("Could not read the bank accounts", accountsRes.error).error, retry } };
  const accounts = accountsRes.data ?? [];
  const accountParam = param(sp, "account");
  const account = accounts.find((a) => a.id === accountParam) ?? accounts.find((a) => a.active) ?? accounts[0] ?? null;
  const zelleAccounts = accounts.map((a) => ({ id: a.id, name: a.name, last4: a.last4, active: a.active }));
  if (!account) return { ...base, zelleAccounts, body: { state: "no_account", canAdd: canAccess(session, "qboManage") } };

  // Zelle shows with the Zelle payment method, or while reports are waiting; Card payouts with the Accounting module (it owns payouts).
  const [plugins, zelleCounts] = await Promise.all([
    enabledPaymentPlugins(session),
    db.rpc("payment_report_counts", { p_center: center.id }).then((r) => {
      if (r.error) {
        problems.push(failure(`Could not count the ${zelleWord} reports`, r.error).error);
        return null;
      }
      const c = r.data as { reported?: unknown; unmatched?: unknown } | null;
      return (Number(c?.reported) || 0) + (Number(c?.unmatched) || 0);
    }),
  ]);
  const on: BankViewsOn = {
    zelle: (Array.isArray(plugins) && plugins.includes("zelle")) || (zelleCounts ?? 0) > 0,
    payouts: isModuleEnabled(session, "accounting"),
  };
  const { view, history } = bankViewFromParam(param(sp, "view"), param(sp, "show"), on);
  const page = pageParam(sp);
  const from = (page - 1) * BANK_PAGE_SIZE;
  const hrefView = (v: BankViewKey) => hrefWith(BASE, {}, { account: account.id, view: v === "match" ? undefined : v });
  const hrefHistory = (h: HistoryKey) => hrefWith(BASE, {}, { account: account.id, view: "history", show: h === "matched" ? undefined : h });

  const lists = {
    match: () => bankLinesQuery(session, account.id, "match", { count: true }),
    deposits: () => bankLinesQuery(session, account.id, "deposits", { count: true }),
    out: () => bankLinesQuery(session, account.id, "out", { count: true }),
    matched: () => bankLinesQuery(session, account.id, "matched", { count: true }),
    ignored: () => bankLinesQuery(session, account.id, "ignored", { count: true }),
  };
  const count = async (q: () => ReturnType<typeof bankLinesQuery>, what: string) => {
    const r = await q().range(0, 0);
    if (r.error) {
      problems.push(failure(`Could not count ${what}`, r.error).error);
      return null;
    }
    return r.count ?? 0;
  };

  const payoutsSince = addDays(today, -PAYOUT_LOOKBACK_DAYS);
  const exportKey = bankLineKey(view, history);
  const [matchN, depositsN, outN, matchedN, ignoredN, payoutPairs, learned, payoutLinesN, unbankedN] = await Promise.all([
    count(lists.match, "the gift lines"),
    count(lists.deposits, "the deposits"),
    count(lists.out, "the money out"),
    count(lists.matched, "the matched lines"),
    count(lists.ignored, "the ignored lines"),
    on.payouts ? loadPayoutPairs(session, account.id, payoutsSince) : Promise.resolve(null),
    loadLearned(session),
    exportKey === "payouts" ? count(() => bankLinesQuery(session, account.id, "payouts", { count: true, since: payoutsSince }), "the card payout lines") : Promise.resolve(null),
    unbankedCount(session),
  ]);
  // Export this view's lines (slice 9): the count the view shows, the account and the view in words.
  const exportCount = exportKey ? { match: matchN, deposits: depositsN, out: outN, matched: matchedN, ignored: ignoredN, payouts: payoutLinesN }[exportKey] : null;
  const accountLabel = `${account.name}${account.last4 ? ` ··${account.last4}` : ""}`;
  const payoutViews = payoutPairs && "pairs" in payoutPairs ? payoutPairs.pairs.map((p) => payoutRowView(p, ctx)) : [];
  if (payoutPairs && "error" in payoutPairs) problems.push(payoutPairs.error);

  const model: BankModel = {
    ...base,
    view,
    history,
    views: bankViewChips(
      on,
      {
        match: matchN,
        deposits: depositsN,
        zelle: zelleCounts,
        payouts: payoutPairs && "pairs" in payoutPairs ? payoutViews.filter((p) => p.attention).length : null,
        unbanked: unbankedN ? unbankedN.total : null,
      },
      view,
      zelleWord,
      hrefView,
    ),
    historyChips: view === "history" ? historyChips({ matched: matchedN, ignored: ignoredN, out: outN }, history, hrefHistory) : [],
    accounts:
      accounts.length > 1
        ? accounts.map((a) => ({
            id: a.id,
            label: `${a.name}${a.last4 ? ` ··${a.last4}` : ""}${a.active ? "" : " (inactive)"}`,
            href: hrefWith(BASE, {}, { account: a.id, view: view === "match" ? undefined : view }),
            on: a.id === account.id,
          }))
        : [],
    account: { id: account.id, name: account.name, last4: account.last4, active: account.active, statementFormat: account.statement_format },
    zelleAccounts,
    learned,
    note: canConfirm ? null : READ_ONLY_NOTE,
    empty: emptyText(view, history),
    exportOffer:
      exportKey && exportCount !== null
        ? exportOffer(
            session,
            "bank_lines",
            exportHref("bank_lines", { ...sp, account: account.id, view: exportKey === "matched" || exportKey === "ignored" || exportKey === "out" ? "history" : exportKey, show: exportKey === "matched" || exportKey === "ignored" || exportKey === "out" ? exportKey : undefined }),
            exportCount,
            filterSentence(bankExportFilter(exportKey, accountLabel), LIST_WORDS.bank_lines.whole),
            param(sp, "export") === "1",
          )
        : null,
  };
  const pageHref = (n: number) => hrefWith(BASE, sp, { page: n });

  if (view === "reconcile") return { ...model, reconcile: { accountId: account.id } };

  if (view === "unbanked") return { ...model, unbanked: await loadUnbanked(session) };

  if (view === "payouts") {
    if (payoutPairs && "error" in payoutPairs) return { ...model, body: { state: "error", error: payoutPairs.error, retry } };
    return { ...model, payouts: payoutViews };
  }

  if (view === "zelle") {
    const r = await db.rpc("payment_report_queue", { p_center: center.id });
    if (r.error) return { ...model, body: { state: "error", error: failure(`Could not load the ${zelleWord} reports`, r.error).error, retry } };
    const q = parseReportQueue(r.data);
    if (!q) {
      console.error("[giving-bank] payment_report_queue returned an unexpected shape:", r.data);
      return {
        ...model,
        body: { state: "error", error: `Could not load the ${zelleWord} reports — the database answered in a shape this screen does not understand.`, retry },
      };
    }
    return { ...model, zelle: q, rows: zelleRows(exactPairs(q), ctx, canConfirm) };
  }

  if (view === "match") {
    const exactRes = on.zelle && canConfirm ? await loadExact(session) : { pairs: [] as ExactPairIn[] };
    if ("error" in exactRes) problems.push(exactRes.error);
    const exact = "pairs" in exactRes ? exactRes.pairs : null;
    const res = await lists.match().order("posted_on", { ascending: true }).order("id").range(from, from + BANK_PAGE_SIZE - 1);
    if (res.error) return { ...model, body: { state: "error", error: failure("Could not read the bank lines", res.error).error, retry } };
    const gifts = await giftLinesIn(session, res.data ?? []);
    return { ...model, rows: matchRows(gifts, exact, ctx, canConfirm), pager: bankPager(page, res.count ?? 0, pageHref) };
  }

  if (view === "deposits") {
    const res = await lists.deposits().order("posted_on", { ascending: true }).order("id").range(from, from + BANK_PAGE_SIZE - 1);
    if (res.error) return { ...model, body: { state: "error", error: failure("Could not read the bank deposits", res.error).error, retry } };
    const deposits = await depositLinesIn(session, res.data ?? []);
    return { ...model, rows: depositRows(deposits, ctx, canConfirm), pager: bankPager(page, res.count ?? 0, pageHref) };
  }

  // History: matched, ignored or money out, newest first.
  const res = await lists[history]().order("posted_on", { ascending: false }).order("id").range(from, from + BANK_PAGE_SIZE - 1);
  if (res.error) return { ...model, body: { state: "error", error: failure("Could not read the bank lines", res.error).error, retry } };
  const lines = res.data ?? [];
  const [cards, names, payInfo, counts] = await Promise.all([
    history === "matched" ? householdCards(db, lines.map((l) => l.matched_household_id)) : Promise.resolve(null),
    history === "out" ? Promise.resolve(null) : userNames(db, center.id, lines.map((l) => l.matched_by)),
    history === "matched" ? readPayments(session, lines.map((l) => l.payment_id)) : Promise.resolve(new Map<string, PaymentInfo>()),
    // A deposit matched to a count (slice 5) names that count, read-only.
    history === "matched" ? countsForBankLines(session, lines.map((l) => l.id)) : Promise.resolve(null),
  ]);
  if (cards?.error) problems.push(failure("Could not read some of the families; those lines show the receipt only", cards.error).error);
  if (counts?.error) problems.push(counts.error);
  const historyLines: HistoryLineIn[] = lines.map((l) => {
    const card = l.matched_household_id ? cards?.map.get(l.matched_household_id) : undefined;
    return {
      id: l.id,
      postedOn: l.posted_on,
      amountCents: l.amount_cents,
      description: l.description,
      status: l.status,
      family: card ? familyFrom(card) : null,
      receipt: l.payment_id ? (payInfo.get(l.payment_id)?.receipt ?? null) : null,
      // Only a line that attached a payment recorded before it (an offline payment) can be undone here; a deposit of several cannot.
      undoable: !l.is_batch_deposit && !!l.payment_id && payInfo.get(l.payment_id)?.provider === "offline",
      by: l.matched_by ? (names?.get(l.matched_by)?.name ?? null) : null,
      at: l.matched_at,
      notes: l.notes,
      isDeposit: l.is_batch_deposit,
      count: counts?.map.get(l.id)?.label ?? null,
    };
  });
  return {
    ...model,
    historyRows: historyLines.map((l) => historyRowView(l, history, ctx, canIgnore, base.can.undoMatch === true)),
    pager: bankPager(page, res.count ?? 0, pageHref),
  };
}

function exactPairs(q: ReportQueue): ExactPairIn[] {
  return q.exact.map((p) => ({
    reportId: p.report_id,
    bankTransactionId: p.bank_transaction_id,
    amountCents: p.amount_cents,
    sentOn: p.sent_on,
    postedOn: p.posted_on,
    confirmation: p.confirmation,
    payerName: p.payer_name,
    family: p.household ? familyFrom(p.household) : null,
  }));
}

type PaymentInfo = { receipt: string | null; provider: string | null };

async function readPayments(session: CrmSession, ids: (string | null)[]): Promise<Map<string, PaymentInfo>> {
  const out = new Map<string, PaymentInfo>();
  const wanted = ids.filter((x): x is string => !!x);
  for (const part of chunk(wanted)) {
    const r = await session.db.from("payments").select("id, receipt_number, provider").in("id", part);
    if (r.error) {
      console.error("[giving-bank] reading the receipts of matched lines failed; those lines show no receipt:", r.error);
      break;
    }
    for (const p of r.data ?? []) out.set(p.id, { receipt: p.receipt_number, provider: p.provider });
  }
  return out;
}

/** Provider payouts (app.payouts, the Accounting module) and this account's payout lines, paired for one row each. */
async function loadPayoutPairs(session: CrmSession, accountId: string, since: string): Promise<{ pairs: PayoutPair[] } | { error: string }> {
  const { db, center } = session;
  const [providers, lines] = await Promise.all([
    db
      .from("payouts")
      .select("id, provider, provider_ref, gross_cents, fee_cents, net_cents, arrives_on, matched, difference_code, difference_note")
      .eq("center_id", center.id)
      .gte("arrives_on", since)
      .order("arrives_on", { ascending: false })
      .limit(100),
    db
      .from("bank_transactions")
      .select("id, posted_on, amount_cents, description, payout_id")
      .eq("center_id", center.id)
      .eq("bank_account_id", accountId)
      .eq("status", "payout")
      .gte("posted_on", since)
      .order("posted_on", { ascending: false })
      .limit(100),
  ]);
  if (providers.error) return { error: failure("Could not read the card payouts", providers.error).error };
  if (lines.error) return { error: failure("Could not read the bank's payout lines", lines.error).error };
  return {
    pairs: pairPayouts(
      (providers.data ?? []).map((p) => ({
        id: p.id,
        provider: p.provider,
        ref: p.provider_ref,
        grossCents: p.gross_cents,
        feeCents: p.fee_cents,
        netCents: p.net_cents,
        arrivesOn: p.arrives_on,
        matched: p.matched,
        differenceCode: p.difference_code,
        differenceNote: p.difference_note,
      })),
      (lines.data ?? []).map((l) => ({ id: l.id, postedOn: l.posted_on, amountCents: l.amount_cents, description: l.description, payoutId: l.payout_id })),
    ),
  };
}

/** "Recently learned payer names" (under More): names that confirmed matches taught the system, with the family's card. */
async function loadLearned(session: CrmSession): Promise<BankModel["learned"]> {
  const { db, center } = session;
  const r = await db
    .from("external_ids")
    .select("id, value, household_id, times_matched, last_matched_at")
    .eq("center_id", center.id)
    .eq("kind", "bank_payer")
    .eq("source", "learned")
    .order("last_matched_at", { ascending: false, nullsFirst: false })
    .limit(8);
  if (r.error) return { state: "error", error: failure("Could not read the learned payer names", r.error).error };
  const cards = await householdCards(db, (r.data ?? []).map((l) => l.household_id));
  const rows: LearnedView[] = (r.data ?? []).map((l) => {
    const card = l.household_id ? cards.map.get(l.household_id) : undefined;
    const family: Family | null = card ? familyFrom(card) : null;
    return { id: l.id, value: l.value, family, times: l.times_matched ?? 0, last: l.last_matched_at };
  });
  return { state: "ok", rows };
}
