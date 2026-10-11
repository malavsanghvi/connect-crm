import { userNames } from "@/lib/data/lookups";
import { todayInTz } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { sourceLabel } from "@/lib/payments/payment-draft";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandError, type HouseholdCard } from "../types";

import { rpcJson } from "./db";
import { asArr, asObj, bool, int, rows, str } from "./giving-json";
import { adultHouseholdCards } from "./household";

export type ApprovalKind = "refund" | "write_off" | "provider_refund";

/** One request waiting for a second, different person, with what that person needs in front of them to decide. */
export type WaitingApproval = {
  kind: ApprovalKind;
  /** The payment (refund), pledge (write-off) or flagged refund (provider refund) id. */
  id: string;
  /** "Refund of receipt R-0042", "Write-off of pledge P-12". */
  title: string;
  household: HouseholdCard | null;
  amount_cents: number;
  amount: string;
  /** Who asked (or approved first), by name. */
  asked_by: string | null;
  asked_by_you: boolean;
  /** Needs giving.approve and a different person than the one who asked. */
  you_can_approve: boolean;
  waiting_for: "a first approver" | "a second approver";
  reason: string | null;
  /** Plain facts about the request. */
  evidence: string[];
  /** Things to check before approving. */
  look_at: string[];
  where_to_approve: string;
};

export type SecondApproverData = {
  total: number;
  refunds: number;
  write_offs: number;
  provider_refunds: number;
  items: WaitingApproval[];
  /** The lists are capped at 25 each; the true counts are above. */
  note: string | null;
};

const input = object({
  kind: f.withDefault(f.enum("Which requests to show.", ["all", "refunds", "write_offs"] as const), "all"),
});

const WHERE = "/approvals";

function methodWord(method: string | null, provider: string | null): string {
  const label = PAYMENT_METHOD_LABEL[method ?? ""] ?? method ?? "payment";
  return provider && provider !== "offline" ? `${label} (${provider})` : label;
}

export const waitingForSecondApprover = defineCommand<Infer<typeof input>, SecondApproverData>({
  key: "giving.waiting_for_second_approver",
  title: "Show what is waiting for a second approver",
  description:
    "Refunds, write-offs and refunds made in Stripe or PayPal that one person asked for and a second, different person must approve. " +
    "Each one is a card with the household card, the amount in the community's currency, who asked and why, the payment or pledge facts the approver needs " +
    "(amount, method, date, whether it was matched to a bank deposit, how much is still open), and things to check before approving. " +
    "It says whether the signed-in person asked for it themselves (then someone else must approve). Read only: it never approves, refunds or writes anything off. Approving is done by a person on the Approvals screen.",
  level: "read",
  permission: "approvals",
  module: "giving",
  input,
  async execute(ctx, { kind }) {
    const { db, center, userId } = ctx.session;
    if (!can(ctx.session, ["giving.view", "giving.manage", "giving.approve"])) {
      throw new CommandError("You don't have access to this area. Refunds and write-offs waiting for approval need the Giving permission (view, manage or approve).");
    }
    const today = todayInTz(center.time_zone, ctx.now?.());
    const money = (c: number) => formatCents(c, center.currency);
    const j = asObj(await rpcJson(db, "giving_second_approver_queue", { p_center: center.id }, "read the refunds and write-offs waiting for approval"));
    const canApprove = can(ctx.session, "giving.approve");
    const refunds = kind === "write_offs" ? [] : rows(j.refunds);
    const writeOffs = kind === "refunds" ? [] : rows(j.write_offs);
    const provider = kind === "write_offs" ? [] : rows(j.provider_refunds);

    const householdIds = [...refunds, ...writeOffs, ...provider].flatMap((r) => str(r.household_id) ?? []);
    const askers = [...refunds.map((r) => str(r.requested_by)), ...writeOffs.map((r) => str(r.requested_by)), ...provider.map((r) => str(r.first_approver))];
    const [{ cards }, names] = await Promise.all([
      adultHouseholdCards(db, householdIds, { today, currency: center.currency }),
      userNames(db, center.id, askers),
    ]);
    const card = (id: string | null) => cards.find((c) => c.household_id === id) ?? null;
    const who = (userIdOf: string | null) => (userIdOf ? (userIdOf === userId ? "you" : (names.get(userIdOf)?.name ?? "a colleague")) : null);

    const items: WaitingApproval[] = [];

    for (const r of refunds) {
      const requestedCents = int(r.requested_cents);
      const paymentCents = int(r.payment_amount_cents);
      const by = str(r.requested_by);
      const mine = by === userId;
      const ref = str(r.receipt_number) ?? "a payment";
      const evidence = [
        `Refund of ${money(requestedCents)} from a ${money(paymentCents)} ${methodWord(str(r.method), str(r.provider))} payment received ${str(r.received_on) ?? "on an unknown date"}${
          requestedCents >= paymentCents ? " (the whole payment)" : " (part of it)"
        }.`,
        `Asked for by ${who(by) ?? "a colleague"}.`,
        str(r.reason) ? `Reason given: ${str(r.reason)}.` : "No reason was given.",
      ];
      const look: string[] = [];
      if (!str(r.reason)) look.push("No reason is written down. Ask the person who requested it.");
      if (bool(r.matched_to_deposit)) look.push("This payment was matched to a bank deposit, so the books will need the refund recorded too.");
      if (int(r.refunded_cents) > 0) look.push(`${money(int(r.refunded_cents))} has already been refunded on this payment.`);
      if (mine) look.push("You asked for this refund yourself, so a different person with approval rights has to approve it.");
      items.push({
        kind: "refund",
        id: str(r.payment_id) ?? "",
        title: `Refund of receipt ${ref}`,
        household: card(str(r.household_id)),
        amount_cents: requestedCents,
        amount: money(requestedCents),
        asked_by: who(by),
        asked_by_you: mine,
        you_can_approve: canApprove && !mine,
        waiting_for: "a second approver",
        reason: str(r.reason),
        evidence,
        look_at: look,
        where_to_approve: WHERE,
      });
    }

    for (const w of writeOffs) {
      const openCents = int(w.open_cents);
      const by = str(w.requested_by);
      const mine = by === userId;
      const ref = str(w.pledge_number) ?? "a pledge";
      const evidence = [
        `${money(openCents)} still open on ${ref} (${sourceLabel(str(w.source) ?? "")}${str(w.fund) ? `, ${str(w.fund)}` : ""}), ${money(int(w.paid_cents))} of ${money(int(w.amount_cents))} paid.`,
        str(w.due_on) ? `It was due ${str(w.due_on)}.` : "It has no due date.",
        `Asked for by ${who(by) ?? "a colleague"}.`,
        str(w.reason) ? `Reason given: ${str(w.reason)}.` : "No reason was given.",
      ];
      const look: string[] = [];
      if (!str(w.reason)) look.push("No reason is written down. Ask the person who requested it.");
      if (int(w.paid_cents) > 0) look.push("The household has paid part of this pledge already.");
      look.push("A write-off cannot be undone from here: the pledge stops counting as owed.");
      if (mine) look.push("You asked for this write-off yourself, so a different person with approval rights has to approve it.");
      items.push({
        kind: "write_off",
        id: str(w.pledge_id) ?? "",
        title: `Write-off of pledge ${str(w.pledge_number) ?? ""}`.trim(),
        household: card(str(w.household_id)),
        amount_cents: openCents,
        amount: money(openCents),
        asked_by: who(by),
        asked_by_you: mine,
        you_can_approve: canApprove && !mine,
        waiting_for: "a second approver",
        reason: str(w.reason),
        evidence,
        look_at: look,
        where_to_approve: WHERE,
      });
    }

    for (const p of provider) {
      const cents = int(p.amount_cents);
      const first = str(p.first_approver);
      const mine = first === userId;
      const ref = str(p.receipt_number) ?? "a payment";
      const providerName = str(p.provider) === "paypal" ? "PayPal" : "Stripe";
      const evidence = [
        `${providerName} refunded ${money(cents)} of a ${money(int(p.payment_amount_cents))} payment${str(p.refunded_on) ? ` on ${str(p.refunded_on)}` : ""}; Weaver did not record it.`,
        first ? `Approved first by ${who(first)}.` : "Nobody has approved it yet.",
      ];
      if (str(p.detail)) evidence.push(`${providerName} said: ${str(p.detail)}.`);
      const look: string[] = ["Nothing changes on the payment until two different people approve this."];
      if (mine) look.push("You approved this first, so a different person has to approve it second.");
      items.push({
        kind: "provider_refund",
        id: str(p.id) ?? "",
        title: `Refund made in ${providerName} on receipt ${ref}`,
        household: card(str(p.household_id)),
        amount_cents: cents,
        amount: money(cents),
        asked_by: first ? who(first) : null,
        asked_by_you: mine,
        you_can_approve: canApprove && !mine,
        waiting_for: first ? "a second approver" : "a first approver",
        reason: str(p.reason),
        evidence,
        look_at: look,
        where_to_approve: "/giving/payments",
      });
    }

    const refundTotal = kind === "write_offs" ? 0 : int(j.refund_count);
    const writeOffTotal = kind === "refunds" ? 0 : int(j.write_off_count);
    const providerTotal = kind === "write_offs" ? 0 : int(j.provider_refund_count) || asArr(j.provider_refunds).length;
    const total = refundTotal + writeOffTotal + providerTotal;
    const capped = refundTotal > refunds.length || writeOffTotal > writeOffs.length;
    return {
      ok: true,
      data: {
        total,
        refunds: refundTotal,
        write_offs: writeOffTotal,
        provider_refunds: providerTotal,
        items,
        note: capped ? "Only the oldest 25 of each kind are shown." : null,
      },
      message: total === 0 ? "Nothing is waiting for a second approver." : undefined,
    };
  },
});
