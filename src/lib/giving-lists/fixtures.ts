// DEV PREVIEW AND TESTS ONLY (src/app/dev/giving-lists): invented pledges and payments for a neutral community club, so Giving's
// Pledges and Payments tabs can be drawn, screenshotted and tested without a database. Every name, number and amount is made up.
// The rows, chips and buckets are built by the same pure core the real loader uses; the search is answered here the way the
// database answers it (a number inside the reference, the exact amount, or a family the household search finds), and a finance
// volunteer sees only what they recorded, as row-level security decides on the real page.

import { TODAY_DATE, TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import type { Family } from "@/lib/giving-today/queue";
import { givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import { isModuleEnabled } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { canAccess, type ScopedContext } from "@/lib/permissions";
import { hrefWith, type RawSearchParams } from "@/lib/search-params";
import { countsWord } from "@/lib/wording";

import { recordPaymentHref } from "./links";
import { pager, switchedOff, type ListBody, type PaymentsModel, type PledgesModel } from "./model";
import {
  countRow,
  flaggedRow,
  grantRow,
  methodChip,
  methodChips,
  paymentRow,
  paymentViewChips,
  paymentViewFromParam,
  RECURRING_CHIPS,
  recurringChipFromParam,
  recurringRow,
  sourceChip,
  sourceChips,
  type FlaggedIn,
  type GrantIn,
  type PaymentIn,
  type PaymentViewKey,
  type RecurringIn,
  type ViewState,
} from "./payments";
import {
  bucketChips,
  bucketFromParam,
  isOpenStatus,
  pledgeChipFromParam,
  pledgeChips,
  pledgeRow,
  selectOpen,
  summarizeOpen,
  type PledgeIn,
} from "./pledges";
import { matchedBy, matchedByText, readListSearch, type ListSearch } from "./search";
import type { ListContext } from "./types";

export type ListsRole = "treasurer" | "approver" | "volunteer";

export const LISTS_USERS = { grace: "u-0000-grace", sam: "u-0000-sam", lee: "u-0000-lee", ama: "u-0000-ama" } as const;
const U = LISTS_USERS;
const NAMES: Record<string, string> = { [U.grace]: "Grace Lindqvist", [U.sam]: "Sam Carter", [U.lee]: "Lee Park", [U.ama]: "Ama Mensah" };

export const LISTS_ROLES: Record<ListsRole, { me: string; permissions: string[] }> = {
  treasurer: { me: U.grace, permissions: ["giving.view", "giving.manage", "giving.record_offline", "accounting.close"] },
  // A second approver who also reads Giving (giving.approve alone opens Today only).
  approver: { me: U.lee, permissions: ["giving.view", "giving.approve"] },
  volunteer: { me: U.ama, permissions: ["giving.record_offline"] },
};

export type Community = { name: string; currency: string; locale: string; timeZone: string; kind: KindProfile; plugins: string[] };

export const LISTS_COMMUNITY: Community = { name: "Lakeside Community Club", currency: "USD", locale: "en-US", timeZone: "America/Chicago", kind: NEUTRAL_KIND, plugins: ["zelle"] };
/** A non-faith community in another currency, with no Zelle. */
export const ROWING_CLUB: Community = { name: "Riverside Rowing Club", currency: "EUR", locale: "en-IE", timeZone: "Europe/Dublin", kind: NEUTRAL_KIND, plugins: [] };

const F = TODAY_FAMILIES;
const FAMILIES: Family[] = Object.values(F);
const pid = (n: number) => `7c6b5a49-0000-4000-8000-${String(n).padStart(12, "0")}`;

function pledge(n: number, p: Partial<PledgeIn> & Pick<PledgeIn, "number" | "householdId" | "amountCents" | "paidCents" | "status" | "pledgedAt">): PledgeIn {
  return {
    id: pid(n),
    campaign: "Annual fund",
    dueOn: null,
    writeOffBy: null,
    writeOffByName: null,
    writeOffSecond: null,
    writeOffReason: null,
    writeOffSince: null,
    importedWriteOffBy: null,
    posting: null,
    ...p,
  };
}

export const SAMPLE_PLEDGES: PledgeIn[] = [
  pledge(1, { number: "PL-0388", householdId: F.okafor2.id, amountCents: 50_000, paidCents: 35_000, status: "partially_paid", pledgedAt: "2026-02-01T15:00:00Z", dueOn: "2026-08-01", writeOffBy: U.grace, writeOffByName: NAMES[U.grace], writeOffReason: "Moved away in August", writeOffSince: "2026-10-09T15:00:00Z" }),
  pledge(2, { number: "PL-0412", householdId: F.nguyen.id, amountCents: 30_000, paidCents: 18_000, status: "partially_paid", pledgedAt: "2026-01-10T15:00:00Z", dueOn: "2026-06-30", writeOffBy: U.sam, writeOffByName: NAMES[U.sam], writeOffSecond: U.lee, writeOffReason: "Hardship", writeOffSince: "2026-10-07T09:00:00Z" }),
  pledge(3, { number: "PL-0455", householdId: F.adeyemi.id, amountCents: 120_000, paidCents: 40_000, status: "partially_paid", pledgedAt: "2026-03-15T15:00:00Z", dueOn: "2026-09-30", campaign: "New roof" }),
  pledge(4, { number: "PL-0460", householdId: F.lindqvist.id, amountCents: 25_000, paidCents: 0, status: "open", pledgedAt: "2026-09-20T15:00:00Z" }),
  pledge(5, { number: "PL-0471", householdId: F.fernandez.id, amountCents: 60_000, paidCents: 60_000, status: "paid", pledgedAt: "2026-04-02T15:00:00Z" }),
  pledge(6, { number: "PL-0301", householdId: F.kim.id, amountCents: 15_000, paidCents: 5_000, status: "written_off", pledgedAt: "2025-11-02T15:00:00Z", writeOffReason: "Hardship", posting: { tone: "ok", label: "Posted to QuickBooks as a credit memo." } }),
  pledge(7, { number: "PL-0350", householdId: F.okafor.id, amountCents: 90_000, paidCents: 10_000, status: "partially_paid", pledgedAt: "2026-01-20T15:00:00Z", dueOn: "2026-05-01", campaign: "New roof" }),
  pledge(8, { number: "PL-0480", householdId: F.adeyemi.id, amountCents: 7_500, paidCents: 0, status: "open", pledgedAt: "2026-10-05T15:00:00Z", campaign: null }),
];

const payId = (n: number) => `5e4d3c2b-0000-4000-8000-${String(n).padStart(12, "0")}`;

function payment(n: number, p: Partial<PaymentIn> & Pick<PaymentIn, "receipt" | "householdId" | "receivedOn" | "method" | "amountCents" | "provider" | "recordedBy">): PaymentIn & { appliedFull: number } {
  return {
    id: payId(n),
    status: "settled",
    checkNumber: null,
    envelopeNumber: null,
    recordedByName: p.recordedBy ? (NAMES[p.recordedBy] ?? null) : null,
    refundedCents: 0,
    refundBy: null,
    refundByName: null,
    refundSecond: null,
    refundReason: null,
    refundRequestedCents: null,
    refundSince: null,
    deposited: null,
    openingBalance: false,
    appliedCents: null,
    appliedFull: p.amountCents,
    ...p,
  };
}

export const SAMPLE_PAYMENTS = [
  payment(1, { receipt: "R-2026-0413", householdId: F.adeyemi.id, receivedOn: "2026-10-11", method: "check", checkNumber: "1042", amountCents: 20_000, provider: "offline", recordedBy: U.ama, deposited: false }),
  payment(2, { receipt: "R-2026-0398", householdId: F.adeyemi.id, receivedOn: "2026-10-04", method: "cash", amountCents: 8_000, provider: "offline", recordedBy: U.sam, deposited: true, refundBy: U.sam, refundByName: NAMES[U.sam], refundReason: "Paid twice at the autumn fair", refundRequestedCents: 4_000, refundSince: "2026-10-09T15:00:00Z" }),
  payment(3, { receipt: "R-2026-0377", householdId: F.kim.id, receivedOn: "2026-09-28", method: "card", amountCents: 2_500, provider: "stripe", recordedBy: null, refundBy: U.grace, refundByName: NAMES[U.grace], refundSecond: U.lee, refundReason: "Charged for a cancelled event", refundRequestedCents: 2_500, refundSince: "2026-10-08T10:00:00Z" }),
  { ...payment(4, { receipt: "R-2026-0360", householdId: F.nguyen.id, receivedOn: "2026-09-20", method: "zelle", amountCents: 12_000, provider: "bank", recordedBy: U.sam }), appliedFull: 0 },
  payment(5, { receipt: "R-2026-0355", householdId: F.lindqvist.id, receivedOn: "2026-09-18", method: "paypal", amountCents: 6_000, provider: "paypal", recordedBy: null, refundBy: U.sam, refundByName: NAMES[U.sam], refundSecond: U.lee, refundReason: "Duplicate gift", refundRequestedCents: 6_000, refundSince: "2026-10-01T10:00:00Z" }),
  payment(6, { receipt: "R-2026-0340", householdId: F.fernandez.id, receivedOn: "2026-09-02", method: "ach", amountCents: 50_000, provider: "bank", recordedBy: U.grace, status: "partially_refunded", refundedCents: 10_000, refundBy: U.grace, refundByName: NAMES[U.grace], refundSecond: U.lee, refundReason: "Overpaid the term fee", refundRequestedCents: 10_000, refundSince: "2026-09-10T10:00:00Z" }),
  payment(7, { receipt: "R-2026-0330", householdId: F.okafor.id, receivedOn: "2026-08-30", method: "stock", amountCents: 100_000, provider: "offline", recordedBy: U.grace }),
  payment(8, { receipt: "R-2026-0322", householdId: F.okafor2.id, receivedOn: "2026-08-21", method: "cash", envelopeNumber: "88", amountCents: 3_500, provider: "offline", recordedBy: U.ama, deposited: true }),
];

export const SAMPLE_FLAGGED: FlaggedIn[] = [
  { id: payId(90), provider: "stripe", amountCents: 1_500, refundedOn: "2026-10-08", providerRef: "re_3PqLakeside01", firstApprover: null, firstApproverName: null, receipt: "R-2026-0371", householdId: F.kim.id, paymentAmountCents: 4_000 },
];

export const SAMPLE_GRANTS: GrantIn[] = [
  { id: payId(80), postedOn: "2026-10-06", amountCents: 25_000, description: "GRANT 88412 IN HONOR OF THE ADEYEMI FAMILY", payerName: "FIDELITY CHARITABLE", reference: "DEP-1006", checkOrSlip: null, kind: "daf", status: "unmatched", matchedFamily: null },
  { id: payId(81), postedOn: "2026-09-29", amountCents: 12_000, description: "EMPLOYER MATCH Q3", payerName: "BENEVITY", reference: "DEP-0929", checkOrSlip: null, kind: "matching_gift", status: "matched", matchedFamily: F.nguyen },
];

export const SAMPLE_RECURRING: RecurringIn[] = [
  { id: payId(70), householdId: F.adeyemi.id, amountCents: 5_000, frequency: "monthly", method: "card", nextChargeOn: "2026-11-01", status: "active", cause: "New roof", linksToPledges: true },
  { id: payId(71), householdId: F.kim.id, amountCents: 2_000, frequency: "monthly", method: "card", nextChargeOn: "2026-10-15", status: "failed", cause: "General fund", linksToPledges: false },
  { id: payId(72), householdId: F.lindqvist.id, amountCents: 10_000, frequency: "quarterly", method: "ach", nextChargeOn: null, status: "paused", cause: "Annual fund", linksToPledges: false },
];

// ---------------------------------------------------------------------------- Building the models

const famById = new Map(FAMILIES.map((f) => [f.id, f]));

function tabCtx(role: ListsRole, c: Community, modulesOff: readonly string[]): ScopedContext & { kind: KindProfile } {
  return { permissions: LISTS_ROLES[role].permissions, isPlatformAdmin: false, modulesOff: ["bolis", ...modulesOff], kind: c.kind };
}

function listCtx(role: ListsRole, c: Community, paypalEmailOnly = false): ListContext {
  const ctx = tabCtx(role, c, []);
  return {
    me: LISTS_ROLES[role].me,
    can: {
      manage: canAccess(ctx, "givingManage"),
      approve: canAccess(ctx, "givingApprove"),
      record: canAccess(ctx, "recordPayment"),
      allocate: canAccess(ctx, "allocatePayment"),
      bankConfirm: canAccess(ctx, "bankConfirm"),
    },
    currency: c.currency,
    locale: c.locale,
    timeZone: c.timeZone,
    today: TODAY_DATE,
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    paypalEmailOnly,
  };
}

/** The household search, as the database answers it for these invented families. */
function familiesFound(s: ListSearch | null): Set<string> {
  if (!s?.familyText) return new Set();
  const t = s.familyText.toLowerCase();
  return new Set(FAMILIES.filter((f) => [f.name, f.number ?? "", f.orgId ?? "", f.primary ?? ""].some((v) => v.toLowerCase().includes(t))).map((f) => f.id));
}

function hit(s: ListSearch | null, ids: Set<string>, row: { number: string | null; amountCents: number; householdId: string | null }): boolean {
  return !s || matchedBy(s, row, ids) !== null;
}

function base(role: ListsRole, c: Community, ctx: ListContext, q: string, searchLabel: string, path: string, sp: RawSearchParams, modulesOff: readonly string[]) {
  return {
    title: "Giving",
    tabs: givingTabs(tabCtx(role, c, modulesOff)),
    currency: c.currency,
    locale: c.locale,
    timeZone: c.timeZone,
    today: TODAY_DATE,
    labels: ctx.labels,
    q,
    searchLabel,
    searchBase: hrefWith(path, sp, { q: undefined, page: undefined }),
    pager: null,
    expandSingle: false,
    problems: [] as string[],
    note: null as string | null,
    recordHref: ctx.can.record ? recordPaymentHref() : null,
  };
}

export function samplePledgesModel(role: ListsRole = "treasurer", sp: RawSearchParams = {}, c: Community = LISTS_COMMUNITY): PledgesModel {
  const ctx = listCtx(role, c);
  const q = typeof sp.q === "string" ? sp.q : "";
  const b = base(role, c, ctx, q, "Find a pledge by family, pledge number or amount", "/dev/giving-lists", { ...sp, tab: "pledges" }, []);
  if (!canAccess(tabCtx(role, c, []), "pledges")) return { ...b, body: { state: "no_access", area: "Pledges", access: "pledges" }, chips: [], buckets: [], summary: null };
  const chip = pledgeChipFromParam(typeof sp.status === "string" ? sp.status : undefined);
  const bucket = bucketFromParam(typeof sp.age === "string" ? sp.age : undefined);
  const search = readListSearch(q, c.currency);
  const ids = familiesFound(search);
  const matching = SAMPLE_PLEDGES.filter((p) => hit(search, ids, { number: p.number, amountCents: p.amountCents, householdId: p.householdId }));
  const open = matching.filter((p) => isOpenStatus(p.status));
  const lite = open.map((p) => ({ ...p, writeOffBy: p.writeOffBy }));
  const summary = summarizeOpen(lite, TODAY_DATE, c.timeZone);
  const closed = matching.length - open.length;
  const href = (o: Record<string, string | undefined>) => hrefWith("/dev/giving-lists", { ...sp, tab: "pledges" }, { page: undefined, ...o });
  const money = (n: number) => formatCents(n, c.currency, c.locale);
  const rows =
    bucket || chip === "open" || chip === "behind" || chip === "waiting"
      ? selectOpen(lite, chip === "closed" || chip === "all" ? "open" : chip, bucket, TODAY_DATE, c.timeZone).map((l) => open.find((p) => p.id === l.id)!)
      : matching.filter((p) => chip === "all" || !isOpenStatus(p.status));
  return {
    ...b,
    chips: pledgeChips(summary, closed, chip, bucket, (k) => href({ status: k === "open" ? undefined : k, age: undefined })),
    buckets: bucketChips(summary, bucket, money, (k) => href({ age: bucket === k ? undefined : k, status: undefined })),
    summary: `${money(summary.open.cents)} open across ${summary.open.count} pledges · ${money(summary.behind.cents)} of it behind`,
    body: {
      state: "ok",
      rows: rows.map((p) => pledgeRow(p, famById.get(p.householdId) ?? null, ctx, matchedByText(matchedBy(search, { number: p.number, amountCents: p.amountCents, householdId: p.householdId }, ids), "pledge number"))),
      empty: search ? `No pledge matches “${search.text}”.` : "No pledges here.",
    },
    pager: pager(1, rows.length, () => "#"),
    expandSingle: search !== null && rows.length === 1,
  };
}

export function samplePaymentsModel(
  role: ListsRole = "treasurer",
  sp: RawSearchParams = {},
  c: Community = LISTS_COMMUNITY,
  opts: { modulesOff?: string[]; paypalEmailOnly?: boolean } = {},
): PaymentsModel {
  const modulesOff = opts.modulesOff ?? [];
  const tctx = tabCtx(role, c, modulesOff);
  const ctx = listCtx(role, c, opts.paypalEmailOnly ?? false);
  const q = typeof sp.q === "string" ? sp.q : "";
  const view = paymentViewFromParam(typeof sp.view === "string" ? sp.view : undefined);
  const path = "/dev/giving-lists";
  const psp = { ...sp, tab: "payments" };
  const b = {
    ...base(role, c, ctx, q, "", path, psp, modulesOff),
    view,
    views: [],
    methods: [],
    sources: [],
    statuses: [],
    flagged: [],
    canCount: false,
    countsWord: countsWord(c.kind),
  };
  if (!canAccess(tctx, "payments")) return { ...b, body: { state: "no_access", area: "Payments", access: "payments" } };
  const seesAll = canAccess(tctx, "paymentsAll");
  const bankOn = isModuleEnabled(tctx, "giving_bank");
  const states: Record<Exclude<PaymentViewKey, "all">, ViewState> = {
    refunds: seesAll || ctx.can.manage || ctx.can.approve ? "on" : "no_access",
    grants: !bankOn ? "off" : canAccess(tctx, "bank") ? "on" : "no_access",
    recurring: !isModuleEnabled(tctx, "giving_recurring") ? "off" : canAccess(tctx, "recurring") ? "on" : "no_access",
    counts: !isModuleEnabled(tctx, "giving_counts") ? "off" : canAccess(tctx, "counting") ? "on" : "no_access",
  };
  // Row-level security: a finance volunteer reads only the payments they recorded.
  const visible = SAMPLE_PAYMENTS.filter((p) => seesAll || p.recordedBy === ctx.me).map((p) => ({ ...p, appliedCents: seesAll ? p.appliedFull : null }));
  const pending = visible.filter((p) => p.refundBy && p.refundedCents === 0).length;
  const shell = {
    ...b,
    views: paymentViewChips(states, { refunds: (seesAll ? pending : 0) + SAMPLE_FLAGGED.length || null, grants: SAMPLE_GRANTS.filter((g) => g.status !== "matched").length || null }, view, b.countsWord, (v) =>
      hrefWith(path, { tab: "payments" }, { view: v === "all" ? undefined : v }),
    ),
    note: seesAll ? null : "Limited view: you see the payments you recorded yourself. The rest are for the treasurer.",
  };
  if (view !== "all" && states[view] !== "on") {
    const body: ListBody =
      states[view] === "off"
        ? switchedOff(c.kind, view === "grants" ? "giving_bank" : view === "recurring" ? "giving_recurring" : "giving_counts", c.name)
        : { state: "no_access", area: view === "refunds" ? "Refunds" : view === "grants" ? "Grants to match" : view === "recurring" ? "Recurring gifts" : b.countsWord, access: view === "refunds" ? "paymentsAll" : view === "grants" ? "bank" : view === "recurring" ? "recurring" : "counting" };
    return { ...shell, body };
  }
  const search = readListSearch(q, c.currency);
  const ids = familiesFound(search);
  const chipHref = (key: string, value: string | null) => hrefWith(path, psp, { [key]: value ?? undefined, page: undefined });
  if (view === "all" || view === "refunds") {
    const method = view === "all" ? methodChip(typeof sp.method === "string" ? sp.method : undefined) : null;
    const source = view === "all" ? sourceChip(typeof sp.source === "string" ? sp.source : undefined) : null;
    const rows = visible
      .filter((p) => view === "all" || p.refundBy)
      .filter((p) => !method || method.methods.includes(p.method))
      .filter((p) => !source || (source.key === "online" ? p.provider !== "offline" && p.provider !== "bank" : p.provider === source.key))
      .filter((p) => hit(search, ids, { number: p.receipt, amountCents: p.amountCents, householdId: p.householdId }));
    return {
      ...shell,
      searchLabel: view === "refunds" ? "Find a refund by family, receipt number or amount" : "Find a payment by family, receipt number or amount",
      methods: view === "all" ? methodChips(method?.key ?? null, c.locale, c.plugins, (k) => chipHref("method", k)) : [],
      sources: view === "all" ? sourceChips(source?.key ?? null, bankOn, (k) => chipHref("source", k)) : [],
      flagged: view === "refunds" ? SAMPLE_FLAGGED.map((f) => flaggedRow(f, famById.get(f.householdId) ?? null, ctx)) : [],
      body: {
        state: "ok",
        rows: rows.map((p) =>
          paymentRow(p, famById.get(p.householdId) ?? null, ctx, matchedByText(matchedBy(search, { number: p.receipt, amountCents: p.amountCents, householdId: p.householdId }, ids), "receipt number")),
        ),
        empty: search ? `No payment matches “${search.text}”.` : "No payments match.",
      },
      expandSingle: search !== null && rows.length === 1,
    };
  }
  if (view === "grants") {
    return { ...shell, searchLabel: "Find a grant by sender, memo or amount", body: { state: "ok", rows: SAMPLE_GRANTS.map((g) => grantRow(g, ctx)), empty: "No grants to match." } };
  }
  if (view === "recurring") {
    const status = recurringChipFromParam(typeof sp.rstatus === "string" ? sp.rstatus : undefined);
    const rows = SAMPLE_RECURRING.filter((r) => status === "all" || r.status === status).filter((r) => hit(search, ids, { number: null, amountCents: r.amountCents, householdId: r.householdId }));
    return {
      ...shell,
      searchLabel: "Find a recurring gift by family or amount",
      statuses: RECURRING_CHIPS.map((x) => ({ key: x.key, label: x.label, href: chipHref("rstatus", x.key === "all" ? null : x.key), count: null, on: x.key === status })),
      body: { state: "ok", rows: rows.map((r) => recurringRow(r, famById.get(r.householdId) ?? null, ctx)), empty: "No recurring gifts here." },
    };
  }
  const canCount = canAccess(tctx, "countingRecord");
  return {
    ...shell,
    canCount,
    body: {
      state: "ok",
      rows: [
        countRow({ id: payId(60), countedOn: "2026-10-05", totalCents: 41_250, bags: ["118", "119"], counters: ["Sam Carter", "Linh Nguyen"], depositRef: null, paymentId: null }, { ...ctx, canCount }),
        countRow({ id: payId(61), countedOn: "2026-09-28", totalCents: 38_000, bags: ["116", "117"], counters: ["Ama Mensah", "Tola Adeyemi"], depositRef: "SLIP-4471", paymentId: null }, { ...ctx, canCount }),
      ],
      empty: "No counts yet.",
    },
  };
}
