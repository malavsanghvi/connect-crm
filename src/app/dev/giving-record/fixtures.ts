// DEV ONLY. Invented Giving data for a neutral community club, so the box's Giving lane, the Record payment sheet and a family's
// giving can be tried and screenshotted without a session or a database. The rules are the real ones (src/lib/find/giving.ts,
// src/lib/giving-actions/*); only the rows are made up. Nothing is saved anywhere.

import type { OpenPledge } from "@/app/(app)/giving/actions";
import type { RecordPaymentInput, RecordPaymentResult } from "@/app/(app)/giving/payments/actions";
import type { GivingSheetBackend } from "@/components/giving-actions/backend";
import { previewAllocation } from "@/lib/allocation";
import { addDays } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { buildGivingLane, readGivingIntent, type FindScope, type GivingFound } from "@/lib/find/giving";
import type { FindResult, FindRow } from "@/lib/find/types";
import type { PledgeEditSheet } from "@/lib/data/edit-pledge";
import type { DeletedPledge, DeletePledgeInput, EditedPledge, EditPledgeInput } from "@/lib/giving-actions/edit-pledge";
import { composeFamilyGiving, type FamilyFocus, type GivingHousehold } from "@/lib/giving-actions/family-giving";
import { checkPledge, splitPledgeWords, type PledgeDesignation, type PledgeSheetOptions, type RecordedPledge, type RecordPledgeInput } from "@/lib/giving-actions/record-pledge";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import { familyLine } from "@/lib/giving-today/queue";
import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";
import { parseAmountToCents } from "@/lib/money";

export type PreviewRole = "treasurer" | "volunteer";

const LABELS = { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" };
const TODAY = "2026-10-12";

export function previewContext(role: PreviewRole): GivingSheetContext {
  return {
    currency: "USD",
    locale: "en-US",
    timeZone: "America/Chicago",
    today: TODAY,
    labels: LABELS,
    canRecord: true,
    canAllocate: role === "treasurer",
    bankOn: true,
    canOpenFamily: role === "treasurer",
    canRecordPledge: role === "treasurer",
    canEditPledge: role === "treasurer",
  };
}

const F = TODAY_FAMILIES;
const households: GivingHousehold[] = [F.adeyemi, F.okafor, F.okafor2, F.lindqvist, F.nguyen].map((f) => ({ ...f, cardLine: familyLine(f, LABELS) }));
const byId = new Map(households.map((h) => [h.id, h]));

const PLEDGES = [
  { id: "9e000000-0000-4000-8000-000000020455", pledge_number: "PL-20455", household_id: F.adeyemi.id, campaign: "Clubhouse roof", amount_cents: 50000, paid_cents: 38800, pledged_at: "2026-02-01", due_on: "2026-09-30", status: "partially_paid", source: "manual" },
  { id: "9e000000-0000-4000-8000-000000020460", pledge_number: "PL-20460", household_id: F.adeyemi.id, campaign: "Youth league", amount_cents: 30000, paid_cents: 0, pledged_at: "2026-05-10", due_on: null, status: "open", source: "manual" },
  { id: "9e000000-0000-4000-8000-000000020470", pledge_number: "PL-20470", household_id: F.okafor.id, campaign: "Clubhouse roof", amount_cents: 25000, paid_cents: 0, pledged_at: "2026-04-02", due_on: null, status: "open", source: "manual" },
];
const PAYMENTS = [
  { id: "9f000000-0000-4000-8000-000000000388", receipt_number: "R-2026-0388", household_id: F.adeyemi.id, amount_cents: 20000, refunded_cents: 0, method: "check", status: "captured", received_on: "2026-10-03" },
  { id: "9f000000-0000-4000-8000-000000000401", receipt_number: "R-2026-0401", household_id: F.lindqvist.id, amount_cents: 12000, refunded_cents: 0, method: "zelle", status: "captured", received_on: "2026-10-05" },
  { id: "9f000000-0000-4000-8000-000000000402", receipt_number: "R-2026-0402", household_id: F.okafor.id, amount_cents: 20000, refunded_cents: 0, method: "cash", status: "captured", received_on: "2026-10-06" },
];
const BANK = [{ id: "b1", postedOn: "2026-10-07", amountCents: 12000, description: "ZELLE FROM LINDQVIST G", payerName: "LINDQVIST G", status: "unmatched" }];
const CAMPAIGNS = [
  { id: "c1", name: "Clubhouse roof", status: "active", goalCents: 5000000 },
  { id: "c2", name: "Youth league", status: "active", goalCents: null },
];

const FUNDS = [
  { id: "9d000000-0000-4000-8000-000000000001", name: "Building fund" },
  { id: "9d000000-0000-4000-8000-000000000002", name: "General fund" },
];
const PLEDGE_CAMPAIGNS = [
  { id: "9d000000-0000-4000-8000-000000000011", name: "Clubhouse roof", fundName: "Building fund" },
  { id: "9d000000-0000-4000-8000-000000000012", name: "Youth league", fundName: null },
];
const DESIGNATIONS: PledgeDesignation[] = [
  ...FUNDS.map((f) => ({ kind: "fund" as const, ...f })),
  ...PLEDGE_CAMPAIGNS.map((c) => ({ kind: "campaign" as const, id: c.id, name: c.name })),
];

const has = (hay: string | null | undefined, needle: string) => !!hay && hay.toLowerCase().includes(needle.toLowerCase());

/** The box's lookup over the invented rows, through the real Giving rules. */
export async function previewSearch(q: string, scope: FindScope, role: PreviewRole): Promise<FindResult> {
  const ctx = previewContext(role);
  const intent = readGivingIntent(q, { today: TODAY, fmt: { currency: ctx.currency, locale: ctx.locale }, scope });
  const nameHits = (words: string | null) => (words ? households.filter((h) => words.split(" ").some((w) => w.length >= 2 && (has(h.name, w) || h.number === w))) : []);
  const people: FindRow[] =
    !intent || intent.kind === "lookup"
      ? nameHits(q).map((h) => ({ kind: "family", id: h.id, title: h.name, cardLine: h.cardLine, why: { code: "name", label: "Name" }, href: `/households/${h.id}`, score: 80 }))
      : [];
  if (!intent) return { ok: true, data: { query: q, kind: "name", rows: people, more: 0, filter: null, problem: null } };
  const token = intent.kind === "lookup" ? intent.code : intent.kind === "refund" || intent.kind === "write_off" ? intent.token : null;
  const cents = intent.kind === "lookup" ? intent.cents : null;
  const words = intent.kind === "lookup" ? intent.words : null;
  const split = intent.kind === "pledge" && ctx.canRecordPledge ? splitPledgeWords(intent.who, DESIGNATIONS) : null;
  const found: GivingFound = {
    families: intent.kind === "record" ? nameHits(intent.who) : split ? nameHits(split.familyWords) : [],
    ...(split ? { designation: split.designation, pledgeWho: split.familyWords } : {}),
    moreFamilies: false,
    payments: PAYMENTS.filter((p) => (token && p.receipt_number.toLowerCase() === token.toLowerCase()) || (cents !== null && p.amount_cents === cents)).map((p) => ({
      id: p.id,
      receipt: p.receipt_number,
      amountCents: p.amount_cents,
      refundedCents: p.refunded_cents,
      method: p.method,
      status: p.status,
      receivedOn: p.received_on,
      householdId: p.household_id,
    })),
    pledges: PLEDGES.filter((p) => token && p.pledge_number.toLowerCase() === token.toLowerCase()).map((p) => ({
      id: p.id,
      number: p.pledge_number,
      campaign: p.campaign,
      amountCents: p.amount_cents,
      paidCents: p.paid_cents,
      status: p.status,
      householdId: p.household_id,
    })),
    bank: role === "treasurer" ? BANK.filter((b) => (cents !== null && b.amountCents === cents) || (words && has(b.description, words))) : [],
    campaigns: words ? CAMPAIGNS.filter((c) => has(c.name, words)) : [],
    cards: byId,
  };
  const lane = buildGivingLane(intent, found, { currency: ctx.currency, locale: ctx.locale, timeZone: ctx.timeZone, canRecord: ctx.canRecord, canRecordPledge: ctx.canRecordPledge });
  return { ok: true, data: { query: q, kind: "name", rows: people, more: 0, filter: null, problem: null, giving: lane } };
}

const later = <T,>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 250));
let receipt = 412;
let pledgeNumber = 20500;
const recordedPledges = new Map<string, RecordedPledge>();

/** The sheets' reads and the record call, over the invented rows. Recording here saves nothing: the receipt says PREVIEW. */
export const PREVIEW_BACKEND: GivingSheetBackend = {
  household: async (id: string) => {
    const h = byId.get(id);
    return later<ActionResult<GivingHousehold>>(h ? { ok: true, data: h } : { ok: false, error: "Could not open the family — it was not found, or your role can't see it." });
  },
  pledges: async (id: string) =>
    later<ActionResult<OpenPledge[]>>({
      ok: true,
      data: PLEDGES.filter((p) => p.household_id === id).map((p) => ({
        id: p.id,
        pledge_number: p.pledge_number,
        campaign: p.campaign,
        source: p.source,
        amount_cents: p.amount_cents,
        paid_cents: p.paid_cents,
        pledged_at: p.pledged_at,
        due_on: p.due_on,
        status: p.status,
      })),
    }),
  family: async (id: string, focus: FamilyFocus | null = null) => {
    const h = byId.get(id);
    if (!h) return later({ ok: false as const, error: "Could not open the family's giving — the family was not found." });
    return later({
      ok: true as const,
      data: composeFamilyGiving({ household: h, pledges: PLEDGES.filter((p) => p.household_id === id), payments: PAYMENTS.filter((p) => p.household_id === id), focus }),
    });
  },
  record: async (input: RecordPaymentInput) => {
    const cents = parseAmountToCents(input.amount) ?? 0;
    if (cents <= 0) return later<ActionResult<RecordPaymentResult>>({ ok: false, error: "Enter the amount received, like 400.00." });
    receipt += 1;
    const open = PLEDGES.filter((p) => p.household_id === input.householdId);
    const plan = input.allocation === "none" ? null : previewAllocation(cents, open, input.allocation === "choose" ? (input.pledgeIds ?? []) : null);
    const numberOf = new Map(open.map((p) => [p.id, p.pledge_number]));
    return later<ActionResult<RecordPaymentResult>>({
      ok: true,
      message: "Preview: nothing was saved.",
      data: {
        paymentId: `preview-${receipt}`,
        receiptNumber: `R-PREVIEW-${receipt}`,
        amountCents: cents,
        applied: (plan?.lines ?? []).map((l) => ({ pledge_id: l.pledge_id, pledge_number: numberOf.get(l.pledge_id) ?? null, amount_cents: l.amount_cents, closed: l.closes })),
        unallocatedCents: plan ? plan.unallocated_cents : cents,
        allocationProblem: input.allocation !== "none" && !plan ? "the payment was saved but not applied to pledges" : null,
        qboQueued: null,
      },
    });
  },
  apply: (async () => later({ ok: false as const, error: "Preview: nothing is applied." })) as unknown as GivingSheetBackend["apply"],
  duplicateZelle: async () => later({ ok: true as const, data: [] }),
  findHouseholds: async (query: string) => {
    const words = query.trim();
    const cards = households
      .filter((h) => has(h.name, words) || h.number === words)
      .map((h) => ({
        household_id: h.id,
        household_name: h.name,
        household_number: h.number,
        org_household_id: h.orgId,
        members: null,
        primary_member: h.primary,
        zone: null,
        city: h.city,
        last_gift_on: null,
        open_pledge_cents: null,
      }));
    return later({ ok: true as const, data: { cards, hits: [], more: false } });
  },
  pledgeOptions: async (householdId: string | null) => {
    const h = householdId ? byId.get(householdId) : null;
    // Invented adults: the household card's primary adult (a child is never offered).
    const adults = h?.primary ? [{ id: "9c000000-0000-4000-8000-000000000001", name: h.primary, isPrimary: true }] : [];
    return later<ActionResult<PledgeSheetOptions>>({
      ok: true,
      data: { funds: FUNDS, campaigns: PLEDGE_CAMPAIGNS, opportunities: [], adults, dueDays: 30, defaultDueOn: addDays(TODAY, 30) },
    });
  },
  recordPledge: async (input: RecordPledgeInput) => {
    const checked = checkPledge(input, TODAY);
    if (!checked.ok) return later<ActionResult<RecordedPledge>>({ ok: false, error: `Could not record the pledge — ${checked.error}` });
    // The same request id twice records once, as in the database.
    const again = recordedPledges.get(input.requestId);
    if (again) return later<ActionResult<RecordedPledge>>({ ok: true, data: { ...again, replayed: true }, message: "Preview: nothing was saved." });
    pledgeNumber += 1;
    const recorded: RecordedPledge = { pledgeId: `preview-${pledgeNumber}`, pledgeNumber: `PL-PREVIEW-${pledgeNumber}`, householdId: checked.value.householdId, amountCents: checked.value.amountCents, replayed: false };
    recordedPledges.set(input.requestId, recorded);
    return later<ActionResult<RecordedPledge>>({ ok: true, data: recorded, message: "Preview: nothing was saved." });
  },
  pledgeEditSheet: async (pledgeId: string) => {
    const p = PLEDGES.find((x) => x.id === pledgeId);
    if (!p) return later<ActionResult<PledgeEditSheet>>({ ok: false, error: "Could not open the pledge — it was not found." });
    const h = byId.get(p.household_id);
    const adults = h?.primary ? [{ id: "9c000000-0000-4000-8000-000000000001", name: h.primary, isPrimary: true }] : [];
    const open = p.status === "open" || p.status === "partially_paid";
    const closed = open ? null : "This pledge is closed, so it stays as it is.";
    return later<ActionResult<PledgeEditSheet>>({
      ok: true,
      data: {
        state: {
          pledgeId: p.id,
          pledgeNumber: p.pledge_number,
          householdId: p.household_id,
          status: p.status,
          source: p.source,
          amountCents: p.amount_cents,
          paidCents: p.paid_cents,
          dueOn: p.due_on,
          pledgedOn: p.pledged_at.slice(0, 10),
          campaignId: null,
          fundId: null,
          opportunityId: null,
          dedication: null,
          recognitionName: null,
          anonymous: false,
          pledgedByPersonId: null,
          locks: {
            details: null,
            due: closed,
            amount: closed,
            for: closed ?? (p.paid_cents > 0 ? "Payments are already applied to this pledge, so what it is for does not change." : null),
            delete: closed ?? (p.paid_cents > 0 ? "Payments are already applied to this pledge. Undo them first, or write off what is still open." : null),
            qbo: null,
          },
        },
        options: { funds: FUNDS, campaigns: PLEDGE_CAMPAIGNS, opportunities: [], adults, dueDays: 30, defaultDueOn: addDays(TODAY, 30) },
      },
    });
  },
  editPledge: async (input: EditPledgeInput) => {
    const p = PLEDGES.find((x) => x.id === input.pledgeId);
    if (!p) return later<ActionResult<EditedPledge>>({ ok: false, error: "Could not change the pledge — it was not found." });
    const fields = Object.keys(input.changes).map((k) => k.replace(/_/g, " "));
    return later<ActionResult<EditedPledge>>({
      ok: true,
      message: "Preview: nothing was saved.",
      data: {
        pledgeId: p.id,
        pledgeNumber: p.pledge_number,
        householdId: p.household_id,
        changed: fields.length > 0,
        fields,
        amountCents: input.changes.amount_cents ?? p.amount_cents,
        wasAmountCents: p.amount_cents,
        dueOn: input.changes.due_on ?? p.due_on,
        status: p.status,
      },
    });
  },
  deletePledge: async (input: DeletePledgeInput) => {
    const p = PLEDGES.find((x) => x.id === input.pledgeId);
    if (!p) return later<ActionResult<DeletedPledge>>({ ok: false, error: "Could not delete the pledge — it was not found." });
    return later<ActionResult<DeletedPledge>>({
      ok: true,
      message: "Preview: nothing was saved.",
      data: { pledgeId: p.id, pledgeNumber: p.pledge_number, householdId: p.household_id, amountCents: p.amount_cents },
    });
  },
};
