// giving.record_payment: record an offline payment and apply it to pledges. A MONEY command, built but OFF: it needs the owner's
// approval (docs/ADMIN_REDESIGN.md "What Niva may do" level 3; BACKLOG B90 phase 4). It is hidden from Niva, the ⌘K palette and
// every other door until an owner switches `assistant.tools.giving.record_payment` on for the community (requiresOwnerSwitch).
//
// What makes it safe to switch on:
//   * it never runs from the call itself: runCommand records a proposal (what will happen, with the household card and the
//     allocation preview), the person presses the button, and only then does it run;
//   * the payment and its allocations are written by ONE database call (app.record_offline_payment_once, migration 0658), so
//     they all exist or none does;
//   * that call carries an idempotency key made from the confirmed proposal, so the same confirmation can never record twice;
//   * the checks are the Record payment screen's own (src/lib/payments/offline-payment.ts).

import { formatCents } from "@/lib/money";

import { defineCommand } from "../define";
import { revalidateAfterCommand } from "../revalidate";
import { object } from "../schema";
import type { CommandPreview } from "../types";

import { rpcJson } from "./db";
import { paymentFields, paymentPreview, preparePayment, type PaymentFieldsInput } from "./giving-draft-payment";
import { asObj, bool, int, rows, str } from "./giving-json";

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

export const recordPayment = defineCommand<PaymentFieldsInput, RecordedPaymentData>({
  key: "giving.record_payment",
  title: "Record a payment",
  description:
    "Record an offline payment (check, cash, ACH, Zelle or stock) for a household and apply it to its pledges, earliest open pledge first. " +
    "This asks the person to confirm first, showing the household card, the amount in dollars, the method and date, and which pledges it would close; nothing is saved until they press the button. " +
    "It needs the household's id (find it with people.search; never guess from a name). Use giving.draft_payment first to talk through partial payments and overpayments. " +
    "The payment and its pledge allocations are saved together or not at all, and one confirmation can never record it twice.",
  level: "confirm",
  permission: "recordPayment",
  module: "giving",
  enabledByDefault: false,
  requiresOwnerSwitch: true,
  covers: ["src/app/(app)/giving/payments/actions.ts#recordOfflinePaymentAction"],
  input: object(paymentFields),
  async preview(ctx, inp): Promise<CommandPreview> {
    return paymentPreview(await preparePayment(ctx, inp, "record the payment"));
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const proposalId = ctx.proposalId;
    // A payment is only ever recorded for a confirmed proposal: that id is what keeps one confirmation from recording it twice.
    if (!proposalId) throw new Error("giving.record_payment was run without a confirmed proposal");
    // Everything is looked at again now: the household's pledges may have changed since the person saw the card.
    const p = await preparePayment(ctx, inp, "record the payment");
    const v = p.value;
    const j = asObj(
      await rpcJson(
        ctx.session.db,
        "record_offline_payment_once",
        {
          p_idempotency_key: `proposal:${proposalId}`,
          p_household: v.householdId,
          p_amount_cents: v.amountCents,
          p_method: v.method,
          p_received_on: v.receivedOn,
          p_pledge_ids: v.allocation === "choose" ? v.chosen : null,
          p_apply: v.allocation !== "none",
          p_check_number: v.checkNumber,
          p_envelope_number: v.envelopeNumber,
          p_memo: v.memo,
        },
        "record the payment",
      ),
    );
    const money = (c: number) => formatCents(c, p.currency);
    const receipt = str(j.receipt_number);
    const replayed = bool(j.replayed);
    const skipped = str(j.allocation_skipped);
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
