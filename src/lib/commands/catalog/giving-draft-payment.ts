// "Record a payment", prepared as a form: the household card, the amount in the community's currency, the method and date, the ALLOCATION PREVIEW
// (which pledges it would close, earliest first; a partial payment or an overpayment is shown as a question) and the check list a
// reviewer would want. It writes nothing. The same preparation (preparePayment) is what the confirm-level payment command shows
// as its "what will happen" card, so what a person reviews is what would be recorded.

import { formatDate, todayInTz } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL, OFFLINE_METHODS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { checkOfflinePayment, type CheckedOfflinePayment } from "@/lib/payments/offline-payment";
import {
  PlanChangedError,
  buildPaymentChecks,
  planDraftAllocation,
  type AllocationQuestion,
  type DraftDuplicate,
  type DraftPlan,
  type DraftPledge,
  type PaymentCheckItem,
  type PlannedLine,
} from "@/lib/payments/payment-draft";
import { duplicateWarning, parsePossibleDuplicates } from "@/lib/payments/zelle";
import { can, canAccess } from "@/lib/permissions";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError, type CommandContext, type CommandPreview, type HouseholdCard } from "../types";

import { rpcJson } from "./db";
import { dollars, uuidList } from "./giving-fields";
import { asObj, bool, int, rows, str, triState } from "./giving-json";
import { requireOwnHousehold } from "./giving-guard";
import { adultHouseholdCards } from "./household";

/** What the Record payment form takes, as a command input. Shared by the draft and the confirm-level command. */
export const paymentFields = {
  household_id: f.uuid("The household that gave (its id, from people.search). Never guessed from a name: the person must have chosen it by its card."),
  amount: dollars("The amount in the community's currency, like 250 or 250.00. Whole units and hundredths only; the system keeps the exact amount."),
  method: f.enum("How it was paid.", OFFLINE_METHODS),
  received_on: f.optional(f.date("The day the money was received, like 2026-10-04. Leave out for today. Never in the future.")),
  reference: f.optional(f.string("The check number for a check; the shares and their value for stock; a reference for other methods.", { min: 1, max: 120 })),
  envelope_number: f.optional(f.string("The envelope number, if there is one.", { min: 1, max: 40 })),
  memo: f.optional(f.string("A short note kept with the payment.", { min: 1, max: 500 })),
  allocation: f.withDefault(
    f.enum("auto = apply to the earliest open pledge first (the usual); choose = only the pledges in pledge_ids; none = leave it as a general gift.", ["auto", "choose", "none"] as const),
    "auto",
  ),
  pledge_ids: f.optional(uuidList("With allocation 'choose': the pledges to apply it to, in order (their ids from giving.household_summary).", { max: 20 })),
};

const draftInput = object(paymentFields);
export type PaymentFieldsInput = Infer<typeof draftInput>;

export type PreparedPayment = {
  value: CheckedOfflinePayment;
  household: HouseholdCard;
  plan: DraftPlan;
  checks: PaymentCheckItem[];
  today: string;
  currency: string;
  canAllocate: boolean;
};

/**
 * Check the payment (the same rules and words as the Record payment screen), look up the household and its open pledges, and work
 * out what would happen. Reads only. Throws CommandError for anything the person can fix.
 */
export async function preparePayment(
  ctx: CommandContext,
  inp: PaymentFieldsInput,
  doing: string,
  opts: { forced?: readonly PlannedLine[] } = {},
): Promise<PreparedPayment> {
  const { db, center } = ctx.session;
  const today = todayInTz(center.time_zone, ctx.now?.());
  const checked = checkOfflinePayment(
    {
      householdId: inp.household_id,
      amount: inp.amount,
      method: inp.method,
      receivedOn: inp.received_on ?? today,
      reference: inp.reference,
      envelopeNumber: inp.envelope_number,
      memo: inp.memo,
      allocation: inp.allocation,
      pledgeIds: inp.pledge_ids,
    },
    today,
    doing,
  );
  if (!checked.ok) throw new CommandError(checked.error);
  const value = checked.value;
  await requireOwnHousehold(ctx, value.householdId);

  const context = asObj(
    await rpcJson(
      db,
      "giving_draft_context",
      {
        p_household: value.householdId,
        p_amount_cents: value.amountCents,
        p_method: value.method,
        p_check_number: value.checkNumber,
        p_received_on: value.receivedOn,
      },
      "look up the household's pledges",
    ),
  );
  if (!str(context.household_id)) throw new CommandError("That household was not found, or you can't record payments for it.");
  const { cards } = await adultHouseholdCards(db, [value.householdId], { today, currency: center.currency });
  const household = cards[0];
  if (!household) throw new CommandError("That household was not found, or you can't record payments for it.");

  const pledges: DraftPledge[] = rows(context.open_pledges).map((p) => ({
    id: str(p.id) ?? "",
    pledge_number: str(p.pledge_number),
    source: str(p.source) ?? "other",
    amount_cents: int(p.amount_cents),
    paid_cents: int(p.paid_cents),
    status: str(p.status) ?? "open",
    pledged_at: str(p.pledged_at) ?? "",
    due_on: str(p.due_on),
    fund: str(p.fund),
    campaign: str(p.campaign),
  }));
  const canAllocate = canAccess(ctx.session, "allocatePayment");
  let plan: DraftPlan;
  try {
    plan = planDraftAllocation({ amountCents: value.amountCents, pledges, mode: value.allocation, chosen: value.chosen, canAllocate, currency: center.currency, forced: opts.forced });
  } catch (error) {
    // A pledge on the confirmed card is no longer as it was: said in plain words, never paid on a guess.
    if (error instanceof PlanChangedError) throw new CommandError(error.message);
    throw error;
  }

  // A Zelle may already be on the bank statement, recorded by hand or reported by the member: the same check the form makes.
  let zelleNote: string | null = null;
  if (value.method === "zelle") {
    const dup = parsePossibleDuplicates(
      await rpcJson(ctx.session.db, "possible_duplicate_zelle", { p_household: value.householdId, p_amount_cents: value.amountCents, p_on: value.receivedOn }, "check for a Zelle already recorded"),
    );
    zelleNote = duplicateWarning(dup, center.currency, (d) => formatDate(d, center.time_zone));
  }

  const duplicates: DraftDuplicate[] = rows(context.duplicates).map((d) => ({
    payment_id: str(d.payment_id) ?? "",
    receipt_number: str(d.receipt_number),
    received_on: str(d.received_on) ?? "",
    amount_cents: int(d.amount_cents),
    method: str(d.method) ?? "",
    check_number: str(d.check_number),
    same_check_number: bool(d.same_check_number),
  }));
  const checks = buildPaymentChecks({
    currency: center.currency,
    amountCents: value.amountCents,
    method: value.method,
    checkNumber: value.checkNumber,
    receivedOn: value.receivedOn,
    today,
    monthClosed: triState(context.month_closed),
    duplicates,
    checkNumberElsewhere: int(context.check_number_elsewhere),
    zelleNote,
    seesAllPayments: can(ctx.session, ["giving.view", "giving.manage"]),
    plan,
    household: { number: household.household_number, city: household.city, adults: household.adults },
  });
  return { value, household, plan, checks, today, currency: center.currency, canAllocate };
}

/** The "what will happen" card, from a prepared payment. */
export function paymentPreview(p: PreparedPayment): CommandPreview {
  const money = (c: number) => formatCents(c, p.currency);
  const { value, plan } = p;
  return {
    summary: `Record ${money(value.amountCents)} by ${(PAYMENT_METHOD_LABEL[value.method] ?? value.method).toLowerCase()} for household ${p.household.household_number ?? p.household.household_id}.`,
    lines: [
      { label: "Amount", value: money(value.amountCents) },
      { label: "Method", value: `${PAYMENT_METHOD_LABEL[value.method] ?? value.method}${value.checkNumber ? `, check ${value.checkNumber}` : ""}` },
      { label: "Received", value: value.receivedOn },
      ...(value.memo ? [{ label: "Note", value: value.memo }] : []),
      ...plan.lines.map((l) => ({
        label: `Applied to ${l.name}${l.pledge_number ? ` (${l.pledge_number})` : ""}`,
        before: `${l.open_before} open`,
        after: l.closes ? "paid in full" : `${l.open_after} open`,
      })),
      ...(plan.unallocated_cents > 0 ? [{ label: "Left as a general gift", value: plan.unallocated }] : []),
    ],
    households: [p.household],
    warnings: [...plan.questions.map((q) => q.question), ...p.checks.filter((c) => c.status === "look").map((c) => `${c.label}: ${c.detail}`)],
  };
}

export type PaymentDraftData = {
  nothing_saved: true;
  household: HouseholdCard;
  payment: {
    amount_cents: number;
    amount: string;
    method: string;
    received_on: string;
    check_number: string | null;
    envelope_number: string | null;
    memo: string | null;
  };
  allocation: DraftPlan;
  /** Questions for the person to answer before recording: a partial payment, an overpayment, the wrong kind of pledge. */
  questions: AllocationQuestion[];
  /** The check list a second person reviewing this would go through. */
  checks: PaymentCheckItem[];
  /** How many things still need a look (questions and checks). */
  needs_a_look: number;
  /** Where to record it: the Record payment screen for this household. */
  record_it_at: string;
  next_step: string;
};

export const draftPayment = defineCommand<PaymentFieldsInput, PaymentDraftData>({
  key: "giving.draft_payment",
  title: "Prepare a payment to record",
  description:
    "Prepare 'record a payment' as a filled form without saving anything: the household (shown as its household card), the amount in the community's currency, the method, the date received, " +
    "which pledges it would close (earliest open pledge first; a partial payment or an overpayment is shown as a question, never decided), and a check list a reviewer would go through " +
    "(right household, amount and method, date, month not locked, not recorded twice, applied the way the donor meant). " +
    "Needs the household's id: find it with people.search and let the person choose by the card, never by name. " +
    "Say what is in the draft and ask the questions in it. This does NOT record the payment: nothing is saved, and the person records it on the Record payment screen.",
  level: "draft",
  permission: "recordPayment",
  module: "giving",
  input: draftInput,
  async execute(ctx, inp) {
    const p = await preparePayment(ctx, inp, "prepare the payment");
    const { value, plan } = p;
    const looks = plan.questions.length + p.checks.filter((c) => c.status === "look").length;
    return {
      ok: true,
      data: {
        nothing_saved: true,
        household: p.household,
        payment: {
          amount_cents: value.amountCents,
          amount: formatCents(value.amountCents, p.currency),
          method: PAYMENT_METHOD_LABEL[value.method] ?? value.method,
          received_on: value.receivedOn,
          check_number: value.checkNumber,
          envelope_number: value.envelopeNumber,
          memo: value.memo,
        },
        allocation: plan,
        questions: plan.questions,
        checks: p.checks,
        needs_a_look: looks,
        record_it_at: `/giving/payments?household=${value.householdId}`,
        next_step:
          looks > 0
            ? "Answer the questions above, then record it on the Record payment screen."
            : "Nothing stands out. Record it on the Record payment screen when you are ready.",
      },
      message: "Nothing has been saved yet.",
    };
  },
});
