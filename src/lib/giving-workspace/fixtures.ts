// DEV PREVIEW ONLY (src/app/dev/admin-giving): invented sample data for a neutral community club, so the Giving page can be
// drawn and screenshotted without a database. Every name, number and amount here is made up. The drafts are built by the same
// pure planner and checks giving.draft_payment uses, so the card shows exactly what the real one would.

import type { HouseholdCardData } from "@/components/household-card";
import type { PaymentDraftData } from "@/lib/commands/catalog/giving-draft-payment";
import type { HouseholdCard } from "@/lib/commands/types";
import type { GivingWorkspaceModel } from "@/lib/data/giving-workspace";
import { formatCents } from "@/lib/money";
import { buildPaymentChecks, planDraftAllocation, type DraftPledge } from "@/lib/payments/payment-draft";

import { parsePaymentAsk } from "./ask";
import { closeView, approvalsRow, bankRow, zelleRow, type DraftRequest } from "./view";

export const SAMPLE_COMMUNITY = "Lakeside Community Club";
export const SAMPLE_TODAY = "2026-10-07";
const CURRENCY = "USD";

export const SAMPLE_ASKED = "Record a $250 check from Okafor for the Spring appeal pledge. Check number 1043, received Sunday.";

const A = "6f1d2c3b-4a5e-4f60-8a71-9b8c7d6e5f40";
const B = "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";

export const SAMPLE_CARDS: HouseholdCardData[] = [
  {
    household_id: A,
    household_name: "Chidi & María Okafor Household",
    household_number: "0212",
    org_household_id: "LCC-H-2041",
    members: "Chidi, María, Ada, Tomás",
    primary_member: "Chidi Okafor",
    primary_org_member_id: "0417",
    zone: null,
    city: "Lakeside",
    last_gift_on: "2026-09-14",
    open_pledge_cents: 25_000,
  },
  {
    household_id: B,
    household_name: "Okafor family",
    household_number: "0388",
    org_household_id: "LCC-H-2216",
    members: "Ngozi, Emeka, Ifeoma",
    primary_member: "Ngozi Okafor",
    primary_org_member_id: "0912",
    zone: null,
    city: "Brookfield",
    last_gift_on: "2026-08-02",
    open_pledge_cents: 0,
  },
];

function adultCard(c: HouseholdCardData, adults: string[]): HouseholdCard {
  return {
    household_id: c.household_id,
    household_name: c.household_name,
    household_number: c.household_number,
    org_household_id: c.org_household_id,
    adults,
    primary_adult: c.primary_member,
    zone: c.zone,
    city: c.city,
    last_gift_on: c.last_gift_on,
    open_pledge_cents: c.open_pledge_cents,
    open_pledge: c.open_pledge_cents === null ? null : formatCents(c.open_pledge_cents, CURRENCY),
  };
}

function sampleDraft(card: HouseholdCardData, adults: string[], pledges: DraftPledge[]): PaymentDraftData {
  const plan = planDraftAllocation({ amountCents: 25_000, pledges, mode: "auto", chosen: null, canAllocate: true, currency: CURRENCY });
  const household = adultCard(card, adults);
  const checks = buildPaymentChecks({
    currency: CURRENCY,
    amountCents: 25_000,
    method: "check",
    checkNumber: "1043",
    receivedOn: "2026-10-04",
    today: SAMPLE_TODAY,
    monthClosed: false,
    duplicates: [],
    checkNumberElsewhere: 0,
    seesAllPayments: true,
    plan,
    household: { number: household.household_number, city: household.city, adults },
  });
  return {
    nothing_saved: true,
    household,
    payment: { amount_cents: 25_000, amount: formatCents(25_000, CURRENCY), method: "Check", received_on: "2026-10-04", check_number: "1043", envelope_number: null, memo: null },
    allocation: plan,
    questions: plan.questions,
    checks,
    needs_a_look: plan.questions.length + checks.filter((c) => c.status === "look").length,
    record_it_at: `/giving/payments?household=${card.household_id}`,
    next_step: "",
  };
}

export const SAMPLE_DRAFTS: Record<string, PaymentDraftData> = {
  [A]: sampleDraft(SAMPLE_CARDS[0], ["Chidi Okafor", "María Okafor"], [
    {
      id: "4c3b2a19-0f8e-4d7c-9b6a-5f4e3d2c1b0a",
      pledge_number: "P-0193",
      source: "general",
      amount_cents: 50_000,
      paid_cents: 25_000,
      status: "partially_paid",
      pledged_at: "2026-03-01",
      due_on: "2026-12-31",
      fund: "General fund",
      campaign: "Spring appeal 2026",
    },
  ]),
  [B]: sampleDraft(SAMPLE_CARDS[1], ["Ngozi Okafor", "Emeka Okafor"], []),
};

export function sampleRequest(householdId: string): DraftRequest {
  return { household_id: householdId, amount: "250", method: "check", received_on: "2026-10-04", reference: "1043", allocation: "auto" };
}

export const SAMPLE_HOUSEHOLDS = { first: A, second: B } as const;

export function sampleModel(opts: { recordByCard?: boolean } = {}): GivingWorkspaceModel {
  const money = (c: number) => formatCents(c, CURRENCY);
  return {
    title: "Giving",
    communityName: SAMPLE_COMMUNITY,
    personName: "Grace Lindqvist",
    today: SAMPLE_TODAY,
    timeZone: "America/Chicago",
    currency: CURRENCY,
    locale: "en-US",
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    views: [
      { key: "today", label: "Today", href: "/dev/giving-today" },
      { key: "conversation", label: "Ask", href: "/giving/ask" },
      { key: "payments", label: "Payments", href: "/giving/payments" },
      { key: "pledges", label: "Pledges", href: "/giving/pledges" },
      { key: "bank", label: "Bank", href: "/giving/payments/bank" },
      { key: "books", label: "Books", href: "/accounting/close" },
    ],
    canRecord: true,
    recordByCard: opts.recordByCard ?? false,
    examples: { ask: "Record a $250 check from household 1042, received yesterday", change: "“make it $300”, “it was cash”, “received yesterday”" },
    pledges: { state: "ok", data: { pledged_cents: 9_600_000, paid_cents: 6_455_000, open_cents: 3_145_000, households: 118, pledges: 131, truncated: false } },
    close: {
      state: "ok",
      data: closeView({
        month: "October 2026",
        locked: false,
        ready_to_lock: false,
        done: ["Clear QuickBooks exceptions", "Match card payouts to bank deposits", "Generate statements"],
        blockers: [{ item: "Review refunds", why: "1 refund still needs a second approver" }],
      }),
    },
    waiting: {
      bank: {
        state: "ok",
        data: bankRow({
          as_of: SAMPLE_TODAY,
          gifts: 3,
          gifts_cents: 41_000,
          gifts_total: money(41_000),
          deposits: 1,
          deposits_cents: 182_500,
          deposits_total: money(182_500),
          debits: 0,
          payouts: 0,
          oldest_posted_on: "2026-10-01",
          oldest_days: 6,
          lines: [],
          where_to_match: "/giving/payments/bank",
        }),
      },
      zelle: {
        state: "ok",
        data: zelleRow(
          { as_of: SAMPLE_TODAY, waiting: 2, reported: 2, unmatched: 0, past_window: 0, total_cents: 15_100, total: money(15_100), exact_matches: 1, reports: [], where_to_match: "/giving/payments/bank?view=zelle" },
          "Zelle",
        ),
      },
      approvals: {
        state: "ok",
        data: {
          row: approvalsRow({ total: 1, refunds: 1, write_offs: 0, provider_refunds: 0, items: [], note: null }),
          items: [
            {
              kind: "refund",
              id: "9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4",
              title: "Refund of receipt R-0457",
              household: adultCard({ ...SAMPLE_CARDS[1], household_name: "Haddad Household", household_number: "0291", org_household_id: "LCC-H-1980", city: "Lakeside" }, ["Yusuf Haddad", "Leila Haddad"]),
              amount_cents: 5_000,
              amount: money(5_000),
              asked_by: "Daniel Kim",
              asked_by_you: false,
              you_can_approve: true,
              waiting_for: "a second approver",
              reason: "Paid twice at the autumn fair",
              evidence: ["Card payment of $50.00 on Sep 27, 2026", "Matched to the bank deposit of Sep 30, 2026", "A second $50.00 payment the same day"],
              look_at: ["The two payments are really the same gift", "The refund goes back to the same card"],
              where_to_approve: "/giving?show=approvals",
            },
          ],
        },
      },
    },
    prompts: [
      { text: "Which bank lines are still unmatched?", href: "/giving/payments/bank" },
      { text: "Which Zelle reports are waiting for the bank?", href: "/giving/payments/bank?view=zelle" },
      { text: "Who is behind on pledges?", href: "/giving/pledges" },
      { text: "What is blocking month-end close?", href: "/accounting/close" },
      { text: "What do I need to send for year-end statements?", href: null, comingNext: true },
    ],
  };
}

/** The conversation as the board draws it: the sentence, two matching households, one picked and its card. */
export function sampleFlowState(picked: "first" | "second" = "first", opts: { evidenceOpen?: boolean } = {}) {
  const id = picked === "first" ? A : B;
  return {
    asked: SAMPLE_ASKED,
    ask: parsePaymentAsk(SAMPLE_ASKED, SAMPLE_TODAY),
    allocation: "auto" as const,
    search: { query: "Okafor", status: "done" as const, cards: SAMPLE_CARDS, more: false },
    picked: id,
    draft: { status: "done" as const, request: sampleRequest(id), data: SAMPLE_DRAFTS[id] },
    later: [],
    editing: false,
    evidenceOpen: opts.evidenceOpen ?? false,
    proposal: null,
    proposing: false,
    proposeError: null,
    closed: null,
  };
}
