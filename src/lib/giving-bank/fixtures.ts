// DEV PREVIEW AND TESTS ONLY (src/app/dev/giving-bank): invented sample data so Giving › Bank (New look) can be drawn, screenshotted
// and tested without a database. Two communities, neither of them a faith community: a community club that takes Zelle and pays
// in US dollars, and an allotment society in pounds that has no Zelle. Every name, number and amount is made up. The page model
// is built by the same pure core the real loader uses (src/lib/giving-bank/views.ts).

import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import type { DepositLineIn, ExactPairIn, Family, GiftLineIn } from "@/lib/giving-today/queue";
import { givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND } from "@/lib/kind";
import type { QueueReport, ReportQueue } from "@/lib/payments/zelle";
import { can, canAccess } from "@/lib/permissions";

import {
  READ_ONLY_NOTE,
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
  type BankPayoutLineIn,
  type BankViewKey,
  type HistoryKey,
  type HistoryLineIn,
  type ProviderPayoutIn,
} from "./views";

export type BankRole = "treasurer" | "volunteer" | "viewer" | "approver";
export type BankCommunity = "club" | "allotment";

export const BANK_ROLE_PERMISSIONS: Record<BankRole, string[]> = {
  treasurer: ["giving.view", "giving.manage", "giving.record_offline", "accounting.manage"],
  volunteer: ["giving.record_offline"],
  viewer: ["giving.view"],
  approver: ["giving.approve"],
};

const fam = (id: string, name: string, number: string, orgId: string, primary: string, city: string): Family => ({ id, name, number, orgId, primary, city });

const ALLOTMENT_FAMILIES = {
  price: fam("2b3c4d5e-0000-4000-8000-000000000214", "Price household", "0214", "HAS-P-14", "Gwen Price", "Harbourside"),
  osei: fam("2b3c4d5e-0000-4000-8000-000000000233", "Osei household", "0233", "HAS-P-33", "Kwame Osei", "Harbourside"),
  osei2: fam("2b3c4d5e-0000-4000-8000-000000000251", "Osei family", "0251", "HAS-P-51", "Ama Osei", "Quayside"),
  novak: fam("2b3c4d5e-0000-4000-8000-000000000270", "Novák household", "0270", "HAS-P-70", "Petra Novák", "Harbourside"),
} as const;

type Community = {
  name: string;
  currency: string;
  locale: string;
  timeZone: string;
  today: string;
  labels: { orgMemberLabel: string; orgHouseholdLabel: string };
  zelle: boolean;
  gifts: GiftLineIn[];
  exact: ExactPairIn[];
  deposits: DepositLineIn[];
  providers: ProviderPayoutIn[];
  payoutLines: BankPayoutLineIn[];
  history: Record<HistoryKey, HistoryLineIn[]>;
  queue: ReportQueue | null;
};

const lid = (n: number) => `7c6b5a49-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = TODAY_FAMILIES;
const A = ALLOTMENT_FAMILIES;

function report(id: string, family: Family, amountCents: number, sentOn: string): QueueReport {
  return {
    id,
    status: "reported",
    is_test: false,
    amount_cents: amountCents,
    sent_on: sentOn,
    due_on: "2026-10-20",
    confirmation: "ZL8842",
    sender_name: family.primary,
    note: null,
    reported_by_name: family.primary ?? "A member",
    created_at: `${sentOn}T18:00:00Z`,
    household: {
      household_id: family.id,
      household_name: family.name,
      household_number: family.number,
      org_household_id: family.orgId,
      members: family.primary,
      primary_member: family.primary,
      primary_org_member_id: null,
      zone: null,
      city: family.city,
      last_gift_on: null,
      open_pledge_cents: null,
    },
    pledges: [],
    candidates: [],
    hand_recorded: [],
    bank_recorded: [],
  };
}

const CLUB: Community = {
  name: "Lakeside Community Club",
  currency: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  today: "2026-10-12",
  labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
  zelle: true,
  exact: [
    { reportId: lid(901), bankTransactionId: lid(1), amountCents: 5_000, sentOn: "2026-10-08", postedOn: "2026-10-09", confirmation: "ZL7710", payerName: "LINH NGUYEN", family: T.nguyen },
    { reportId: lid(902), bankTransactionId: lid(2), amountCents: 10_100, sentOn: "2026-10-08", postedOn: "2026-10-09", confirmation: "ZL7713", payerName: "G LINDQVIST", family: T.lindqvist },
    { reportId: lid(903), bankTransactionId: lid(3), amountCents: 2_500, sentOn: "2026-10-09", postedOn: "2026-10-10", confirmation: "ZL7720", payerName: "DANIEL KIM", family: T.kim },
    { reportId: lid(904), bankTransactionId: lid(4), amountCents: 7_500, sentOn: "2026-10-09", postedOn: "2026-10-10", confirmation: "ZL7731", payerName: "LUCIA FERNANDEZ", family: T.fernandez },
  ],
  gifts: [
    ...[1, 2, 3, 4].map((n) => ({
      id: lid(n),
      postedOn: "2026-10-09",
      amountCents: [5_000, 10_100, 2_500, 7_500][n - 1],
      description: "Zelle payment from a member",
      payerName: null,
      originatorKind: null,
      suggestions: [],
      suggestionError: null,
    })),
    {
      id: lid(5),
      postedOn: "2026-10-05",
      amountCents: 12_000,
      description: "ACH CREDIT T ADEYEMI GIFT",
      payerName: "T ADEYEMI",
      originatorKind: null,
      suggestions: [{ family: T.adeyemi, reason: "Payer name learned from 3 earlier matches", ambiguous: false, reportId: null }],
      suggestionError: null,
    },
    {
      id: lid(6),
      postedOn: "2026-10-06",
      amountCents: 25_000,
      description: "ZELLE FROM OKAFOR",
      payerName: "OKAFOR",
      originatorKind: null,
      suggestions: [
        { family: T.okafor, reason: "Surname matches", ambiguous: true, reportId: null },
        { family: T.okafor2, reason: "Surname matches", ambiguous: true, reportId: null },
      ],
      suggestionError: null,
    },
    {
      id: lid(7),
      postedOn: "2026-10-07",
      amountCents: 50_000,
      description: "GRANT COMMUNITY FOUNDATION FUND",
      payerName: "COMMUNITY FOUNDATION",
      originatorKind: "daf",
      suggestions: [],
      suggestionError: null,
    },
  ],
  deposits: [
    {
      id: lid(10),
      postedOn: "2026-10-08",
      amountCents: 35_000,
      description: "DEPOSIT ID NUMBER 88412",
      exact: true,
      error: null,
      candidates: [
        { paymentId: lid(301), receipt: "R-2026-0410", method: "Check", amountCents: 20_000, receivedOn: "2026-10-05", checkNumber: "1042", family: T.fernandez, householdName: null },
        { paymentId: lid(302), receipt: "R-2026-0411", method: "Cash", amountCents: 15_000, receivedOn: "2026-10-05", checkNumber: null, family: T.lindqvist, householdName: null },
      ],
    },
  ],
  providers: [
    { id: lid(501), provider: "stripe", ref: "po_1Q2W3E", grossCents: 51_200, feeCents: 1_515, netCents: 49_685, arrivesOn: "2026-10-07" },
    { id: lid(502), provider: "stripe", ref: "po_1Q2W9K", grossCents: 20_000, feeCents: 610, netCents: 19_390, arrivesOn: "2026-10-01" },
    { id: lid(503), provider: "stripe", ref: "po_1Q3A7Z", grossCents: 8_000, feeCents: 262, netCents: 7_738, arrivesOn: "2026-10-12" },
  ],
  payoutLines: [
    { id: lid(601), postedOn: "2026-10-08", amountCents: 49_365, description: "STRIPE TRANSFER ST-P8Q2", payoutId: null },
    { id: lid(602), postedOn: "2026-10-01", amountCents: 19_390, description: "STRIPE TRANSFER ST-K3L9", payoutId: lid(502) },
  ],
  history: {
    matched: [
      { id: lid(701), postedOn: "2026-10-02", amountCents: 6_000, description: "ZELLE FROM GRACE LINDQVIST", status: "matched", family: T.lindqvist, receipt: "R-2026-0402", by: "Sam Carter", at: "2026-10-03T15:00:00Z", notes: null, isDeposit: false },
      { id: lid(702), postedOn: "2026-10-01", amountCents: 41_000, description: "DEPOSIT ID NUMBER 88390", status: "matched", family: null, receipt: null, by: "Sam Carter", at: "2026-10-02T15:00:00Z", notes: null, isDeposit: true },
    ],
    ignored: [
      { id: lid(711), postedOn: "2026-09-30", amountCents: 100_000, description: "ONLINE TRANSFER FROM SAVINGS", status: "ignored", family: null, receipt: null, by: "Sam Carter", at: "2026-10-01T09:00:00Z", notes: "Transfer between our own accounts", isDeposit: false },
    ],
    out: [{ id: lid(721), postedOn: "2026-10-04", amountCents: -18_000, description: "CHECK 2210 HALL RENTAL", status: "unmatched", family: null, receipt: null, by: null, at: null, notes: null, isDeposit: false }],
  },
  queue: null,
};
CLUB.queue = {
  window_days: 10,
  bank_account_id: lid(1000),
  counts: { reported: 1, unmatched: 0, exact: 4 },
  exact: CLUB.exact.map((p) => ({
    report_id: p.reportId,
    bank_transaction_id: p.bankTransactionId,
    amount_cents: p.amountCents,
    sent_on: p.sentOn,
    posted_on: p.postedOn,
    confirmation: p.confirmation,
    payer_name: p.payerName,
    household: null,
  })),
  reports: [report(lid(905), T.adeyemi, 4_000, "2026-10-11")],
};

const ALLOTMENT: Community = {
  name: "Harbourside Allotment Society",
  currency: "GBP",
  locale: "en-GB",
  timeZone: "Europe/London",
  today: "2026-10-12",
  labels: { orgMemberLabel: "member", orgHouseholdLabel: "Plot holder ID" },
  zelle: false,
  exact: [],
  gifts: [
    {
      id: lid(51),
      postedOn: "2026-10-06",
      amountCents: 12_000,
      description: "FASTER PAYMENT G PRICE PLOT FEE",
      payerName: "G PRICE",
      originatorKind: null,
      suggestions: [{ family: A.price, reason: "Payer name learned from 2 earlier matches", ambiguous: false, reportId: null }],
      suggestionError: null,
    },
    {
      id: lid(52),
      postedOn: "2026-10-07",
      amountCents: 4_500,
      description: "BANK GIRO CREDIT OSEI",
      payerName: "OSEI",
      originatorKind: null,
      suggestions: [
        { family: A.osei, reason: "Surname matches", ambiguous: true, reportId: null },
        { family: A.osei2, reason: "Surname matches", ambiguous: true, reportId: null },
      ],
      suggestionError: null,
    },
  ],
  deposits: [
    {
      id: lid(60),
      postedOn: "2026-10-09",
      amountCents: 9_000,
      description: "PAID IN AT COUNTER 000231",
      exact: true,
      error: null,
      candidates: [{ paymentId: lid(331), receipt: "R-2026-0088", method: "Cheque", amountCents: 9_000, receivedOn: "2026-10-04", checkNumber: "100231", family: A.novak, householdName: null }],
    },
  ],
  providers: [{ id: lid(531), provider: "stripe", ref: "po_GB55X1", grossCents: 30_000, feeCents: 570, netCents: 29_430, arrivesOn: "2026-10-06" }],
  payoutLines: [{ id: lid(631), postedOn: "2026-10-07", amountCents: 29_430, description: "STRIPE PAYMENTS UK LTD", payoutId: null }],
  history: { matched: [], ignored: [], out: [] },
  queue: null,
};

export const BANK_COMMUNITIES: Record<BankCommunity, Community> = { club: CLUB, allotment: ALLOTMENT };

export function sampleBankModel(
  opts: { community?: BankCommunity; role?: BankRole; view?: string; show?: string; accounting?: boolean; bankOff?: boolean } = {},
): BankModel {
  const c = BANK_COMMUNITIES[opts.community ?? "club"];
  const role = opts.role ?? "treasurer";
  const modulesOff = [...(opts.accounting === false ? ["accounting"] : []), ...(opts.bankOff ? ["giving_bank"] : [])];
  const ctx = { permissions: BANK_ROLE_PERMISSIONS[role], isPlatformAdmin: false, modulesOff, kind: NEUTRAL_KIND };
  const canConfirm = canAccess(ctx, "bankConfirm");
  const canIgnore = canAccess(ctx, "bankIgnore");
  const rowCtx = { currency: c.currency, locale: c.locale, timeZone: c.timeZone, today: c.today, zelleWord: "Zelle" };
  const on = { zelle: c.zelle, payouts: opts.accounting !== false };
  const { view, history } = bankViewFromParam(opts.view, opts.show, on);
  const href = (v: BankViewKey) => `/dev/giving-bank?view=${v}`;
  const pairs = pairPayouts(c.providers, c.payoutLines);
  const payouts = pairs.map((p) => payoutRowView(p, rowCtx));
  const base: BankModel = {
    title: "Giving",
    tabs: givingTabs(ctx),
    currency: c.currency,
    locale: c.locale,
    timeZone: c.timeZone,
    today: c.today,
    labels: c.labels,
    zelleWord: "Zelle",
    view,
    views: bankViewChips(
      on,
      { match: c.gifts.length, deposits: c.deposits.length, zelle: c.queue ? c.queue.counts.reported + c.queue.counts.unmatched + c.exact.length : null, payouts: payouts.filter((p) => p.attention).length },
      view,
      "Zelle",
      href,
    ),
    history,
    historyChips:
      view === "history"
        ? historyChips({ matched: c.history.matched.length, ignored: c.history.ignored.length, out: c.history.out.length }, history, (h) => `/dev/giving-bank?view=history&show=${h}`)
        : [],
    body: { state: "ok" },
    accounts: [],
    account: { id: lid(1000), name: c.zelle ? "Operating account" : "Society current account", last4: "4410", active: true, statementFormat: "generic_csv" },
    zelleAccounts: [{ id: lid(1000), name: "Operating account", last4: "4410", active: true }],
    rows: [],
    zelle: null,
    payouts: [],
    historyRows: [],
    learned: { state: "ok", rows: [{ id: lid(801), value: "T ADEYEMI", family: c.zelle ? T.adeyemi : A.price, times: 3, last: "2026-10-05T12:00:00Z" }] },
    pager: null,
    problems: [],
    note: canConfirm ? null : READ_ONLY_NOTE,
    empty: emptyText(view, history),
    can: { confirm: canConfirm, ignore: canIgnore, import: canAccess(ctx, "bankImport"), configureZelle: can(ctx, ["giving.manage", "integrations.manage"]) },
  };
  if (!canAccess(ctx, "bank") && !canConfirm) return { ...base, views: [], body: { state: "no_access", area: "Bank reconciliation", access: "bank" } };
  if (opts.bankOff) return { ...base, views: [], body: { state: "off", title: "Bank reconciliation is switched off", message: `${c.name} has switched off Bank reconciliation.` } };
  if (view === "match") return { ...base, rows: matchRows(c.gifts, c.zelle ? c.exact : null, rowCtx, canConfirm) };
  if (view === "deposits") return { ...base, rows: depositRows(c.deposits, rowCtx, canConfirm) };
  if (view === "zelle") return { ...base, zelle: c.queue, rows: zelleRows(c.exact, rowCtx, canConfirm) };
  if (view === "payouts") return { ...base, payouts };
  return { ...base, historyRows: c.history[history].map((l) => historyRowView(l, history, rowCtx, canIgnore)) };
}
