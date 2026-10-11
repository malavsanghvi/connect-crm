// giving.record_payment: record an offline payment and apply it to pledges. A MONEY command, built but OFF: it needs the owner's
// approval (docs/ADMIN_REDESIGN.md "What Niva may do" level 3; BACKLOG B90 phase 4). It is hidden from Niva, the ⌘K palette and
// every other door until an owner switches `assistant.tools.giving.record_payment` on for the community (requiresOwnerSwitch).
//
// What makes it safe to switch on:
//   * it never runs from the call itself: runCommand records a proposal (what will happen, with the household card and the
//     allocation preview), the person presses the button, and only then does it run. A screen cannot run it directly;
//   * what the card shows is what runs. When the confirmation is prepared (`resolve`) the received date is fixed in the
//     community's own time zone and the pledges the payment will close are fixed, both stored in the proposal. Confirming at five
//     past midnight records the day that was on the card, and the database applies exactly those pledges and amounts, or refuses
//     if a pledge changed since (so two pledges made at the same moment can never be swapped);
//   * the payment and its allocations are written by ONE database call (app.record_offline_payment_once, migration 0658), so
//     they all exist or none does, with an idempotency key made from the confirmed proposal;
//   * a payment that looks like one just confirmed is refused when the card is prepared, in case the answer was lost after it
//     was recorded;
//   * the checks are the Record payment screen's own (src/lib/payments/offline-payment.ts).

import { todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { checkOfflinePayment } from "@/lib/payments/offline-payment";
import { canAccess } from "@/lib/permissions";

import { defineCommand } from "../define";
import { revalidateAfterCommand } from "../revalidate";
import { object, type Infer } from "../schema";
import { CommandError, type CommandPreview } from "../types";

import { rpcJson } from "./db";
import { paymentFields, paymentPreview, preparePayment } from "./giving-draft-payment";
import { hiddenCents, hiddenPlan } from "./giving-fields";
import { requireConfirmedRun, requireOwnHousehold } from "./giving-guard";
import { asObj, bool, int, rows, str } from "./giving-json";

const KEY = "giving.record_payment";

export const REPEAT_MINUTES = 30;
export const LIKELY_REPEAT =
  "A payment like this for this household was confirmed a few minutes ago and may already be recorded. Check the household's payments first. " +
  "If it really is a second payment, record it on the Record payment screen.";
const NOT_APPLIED =
  "The payment was recorded but not applied to pledges: applying needs the giving.manage permission, so a treasurer can apply it.";

const input = object({
  ...paymentFields,
  amount_cents: hiddenCents("The amount in whole cents, read from the amount when the confirmation is prepared."),
  plan: hiddenPlan("The pledges the payment will be applied to, as the confirmation card shows them."),
});
export type RecordPaymentInput = Infer<typeof input>;

export type RecordedPaymentData = {
  payment_id: string;
  receipt_number: string | null;
  amount_cents: number;
  amount: string;
  /** True when this confirmation had already recorded the payment: nothing was added. */
  replayed: boolean;
  applied: { pledge_id: string; pledge_number: string | null; amount_cents: number; amount: string; closed: boolean }[];
  unallocated_cents: number;
  unallocated: string;
  /** Set when the payment was recorded but not applied to pledges (the person may record but not apply). */
  allocation_skipped: string | null;
};

export const recordPayment = defineCommand<RecordPaymentInput, RecordedPaymentData>({
  key: KEY,
  title: "Record a payment",
  description:
    "Record an offline payment (check, cash, ACH, Zelle or stock) for a household and apply it to its pledges, earliest open pledge first. " +
    "This asks the person to confirm first, showing the household card, the amount in dollars, the method and date, and which pledges it would close; nothing is saved until they press the button, and exactly what the card shows is what is recorded. " +
    "It needs the household's id (find it with people.search; never guess from a name). Use giving.draft_payment first to talk through partial payments and overpayments. " +
    "The payment and its pledge allocations are saved together or not at all, and one confirmation can never record it twice.",
  level: "confirm",
  permission: "recordPayment",
  module: "giving",
  enabledByDefault: false,
  requiresOwnerSwitch: true,
  covers: ["src/app/(app)/giving/payments/actions.ts#recordOfflinePaymentAction"],
  input,
  /**
   * Decide, once, what the person will confirm: the received date (today in the community's time zone unless a date was given),
   * the amount in cents and the pledges it closes. Refuses a payment that looks like one just confirmed.
   */
  async resolve(ctx, inp) {
    const p = await preparePayment(ctx, inp, "record the payment");
    const guard = asObj(
      await rpcJson(ctx.session.db, "giving_payment_confirm_guard", { p_household: p.value.householdId, p_amount_cents: p.value.amountCents, p_minutes: REPEAT_MINUTES }, "check whether this payment was just confirmed"),
    );
    if (int(guard.unfinished) > 0 || int(guard.recorded) > 0) throw new CommandError(LIKELY_REPEAT);
    return { ...inp, received_on: p.value.receivedOn, amount_cents: p.value.amountCents, plan: p.plan.stored };
  },
  async preview(ctx, inp): Promise<CommandPreview> {
    // The card shows the stored plan, checked against the pledges as they are now.
    return paymentPreview(await preparePayment(ctx, inp, "record the payment", { forced: inp.plan }));
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    // A payment is only ever recorded for a confirmed proposal, with the owner's switch on: that id is what keeps one confirmation
    // from recording it twice.
    const proposalId = requireConfirmedRun(ctx, KEY);
    if (inp.plan === undefined || inp.amount_cents === undefined || inp.received_on === undefined) {
      throw new CommandError("This confirmation is missing details, so nothing was recorded. Ask again.");
    }
    const { db, center } = ctx.session;
    // Only what was stored is used: the date and the pledges are NOT worked out again now.
    const checked = checkOfflinePayment(
      {
        householdId: inp.household_id,
        amount: inp.amount,
        method: inp.method,
        receivedOn: inp.received_on,
        reference: inp.reference,
        envelopeNumber: inp.envelope_number,
        memo: inp.memo,
        allocation: inp.allocation,
        pledgeIds: inp.pledge_ids,
      },
      todayInTz(center.time_zone, ctx.now?.()),
      "record the payment",
    );
    if (!checked.ok) throw new CommandError(checked.error);
    const v = checked.value;
    if (v.amountCents !== inp.amount_cents) throw new CommandError("The amount no longer matches what was confirmed, so nothing was recorded. Ask again.");
    await requireOwnHousehold(ctx, v.householdId);
    const j = asObj(
      await rpcJson(
        db,
        "record_offline_payment_once",
        {
          p_idempotency_key: `proposal:${proposalId}`,
          p_center: center.id,
          p_household: v.householdId,
          p_amount_cents: v.amountCents,
          p_method: v.method,
          p_received_on: v.receivedOn,
          p_allocations: inp.plan,
          p_chosen: v.allocation === "choose",
          p_check_number: v.checkNumber,
          p_envelope_number: v.envelopeNumber,
          p_memo: v.memo,
        },
        "record the payment",
      ),
    );
    const money = (c: number) => formatCents(c, center.currency);
    const receipt = str(j.receipt_number);
    const replayed = bool(j.replayed);
    // A recorder who may not apply payments is told so, even though no pledge was named for them.
    const skipped = str(j.allocation_skipped) ?? (v.allocation !== "none" && !canAccess(ctx.session, "allocatePayment") ? NOT_APPLIED : null);
    const data: RecordedPaymentData = {
      payment_id: str(j.payment_id) ?? "",
      receipt_number: receipt,
      amount_cents: int(j.amount_cents),
      amount: money(int(j.amount_cents)),
      replayed,
      applied: rows(j.applied).map((a) => ({
        pledge_id: str(a.pledge_id) ?? "",
        pledge_number: str(a.pledge_number),
        amount_cents: int(a.amount_cents),
        amount: money(int(a.amount_cents)),
        closed: bool(a.closed),
      })),
      unallocated_cents: int(j.unallocated_cents),
      unallocated: money(int(j.unallocated_cents)),
      allocation_skipped: skipped,
    };
    revalidateAfterCommand(["/giving/payments", `/households/${v.householdId}`]);
    // The screen's own sentence when it records; a repeat says nothing was added.
    const base = replayed ? `This payment was already recorded (receipt ${receipt ?? "pending"}). Nothing was added.` : `Recorded ${money(data.amount_cents)} — receipt ${receipt ?? "pending"}.`;
    return { ok: true, data, message: skipped ? `${base} ${skipped}` : base };
  },
});
