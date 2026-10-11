// giving.match_deposit: match one bank deposit to the checks and cash already recorded for it. A MONEY command, built but OFF
// (requiresOwnerSwitch, see giving-record-payment.ts): it marks the payments settled, matches the bank line and queues ONE
// QuickBooks deposit, the same as the Bank screen's deposit matcher (app.match_deposit, unchanged).
//
// The person is told BEFORE confirming what the database would only say afterwards: the payments must add up to the deposit to the
// cent, none may already be on a deposit, and all must be payments recorded by hand.

import { formatCents } from "@/lib/money";
import { depositMatchedMessage, depositTotalProblem } from "@/lib/payments/bank-match";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { todayInTz } from "@/lib/dates";

import { defineCommand } from "../define";
import { revalidateAfterCommand } from "../revalidate";
import { f, object, type Infer } from "../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview, type HouseholdCard } from "../types";

import { rpcJson } from "./db";
import { uuidList } from "./giving-fields";
import { asArr, asObj, bool, int, rows, str } from "./giving-json";
import { adultHouseholdCards } from "./household";

const MAX_PAYMENTS = 100;
const MAX_CARDS = 25;

const input = object({
  bank_line_id: f.uuid("The bank line (the deposit), from giving.bank_lines_unmatched."),
  payment_ids: uuidList("The recorded payments (checks and cash) that make up this deposit, by id. Together they must add up to the deposit exactly.", { max: MAX_PAYMENTS }),
});
type Input = Infer<typeof input>;

type DepositLook = {
  bank: { posted_on: string; amount_cents: number; description: string };
  payments: { id: string; receipt_number: string | null; household_id: string | null; amount_cents: number; method: string; check_number: string | null; received_on: string }[];
  households: HouseholdCard[];
  currency: string;
};

/** Read the bank line and the chosen payments now, and refuse anything the database would refuse, in words. */
async function look(ctx: CommandContext, { bank_line_id, payment_ids }: Input): Promise<DepositLook> {
  const { db, center } = ctx.session;
  const money = (c: number) => formatCents(c, center.currency);
  const j = asObj(await rpcJson(db, "giving_deposit_context", { p_txn: bank_line_id, p_payment_ids: payment_ids }, "look at the deposit"));
  const line = asObj(j.bank_line);
  if (!str(line.id)) throw new CommandError("That bank line was not found, or you can't see it.");
  if (str(line.status) === "matched") throw new CommandError("That bank line is already matched.");
  const missing = asArr(j.missing_ids).length;
  if (missing > 0) throw new CommandError(`${missing} of those payments ${missing === 1 ? "was" : "were"} not found, or you can't see ${missing === 1 ? "it" : "them"}.`);
  const payments = rows(j.payments).map((p) => ({
    id: str(p.id) ?? "",
    receipt_number: str(p.receipt_number),
    household_id: str(p.household_id),
    amount_cents: int(p.amount_cents),
    method: PAYMENT_METHOD_LABEL[str(p.method) ?? ""] ?? str(p.method) ?? "Other",
    check_number: str(p.check_number),
    received_on: str(p.received_on) ?? "",
    can_match: bool(p.can_match),
    already_deposited: bool(p.already_deposited),
  }));
  const deposited = payments.filter((p) => p.already_deposited);
  if (deposited.length > 0) throw new CommandError(`Already on a deposit: ${deposited.map((p) => p.receipt_number ?? "a payment").join(", ")}. Take them out and try again.`);
  const notByHand = payments.filter((p) => !p.can_match);
  if (notByHand.length > 0) throw new CommandError(`Not recorded by hand, so not part of a deposit: ${notByHand.map((p) => p.receipt_number ?? "a payment").join(", ")}.`);
  const total = int(j.total_cents);
  const difference = int(j.difference_cents);
  if (difference !== 0) {
    throw new CommandError(
      `The chosen payments total ${money(total)} but the deposit is ${money(int(line.amount_cents))} (${difference > 0 ? `${money(difference)} short` : `${money(-difference)} over`}). They must add up exactly.`,
    );
  }
  const today = todayInTz(center.time_zone, ctx.now?.());
  const ids = [...new Set(payments.flatMap((p) => p.household_id ?? []))].slice(0, MAX_CARDS);
  const { cards } = await adultHouseholdCards(db, ids, { today, currency: center.currency });
  return {
    bank: { posted_on: str(line.posted_on) ?? "", amount_cents: int(line.amount_cents), description: str(line.description) ?? "" },
    payments,
    households: cards,
    currency: center.currency,
  };
}

export const matchDeposit = defineCommand<Input, { count: number }>({
  key: "giving.match_deposit",
  title: "Match a deposit to recorded checks",
  description:
    "Match one bank deposit (a batch of checks or cash) to the payments already recorded for it. The payments are marked settled, the bank line is matched and one QuickBooks deposit is queued. " +
    "This asks the person to confirm first, showing the deposit, each payment and the household cards; nothing changes until they press the button. " +
    "The payments must add up to the deposit exactly, none may already be on a deposit, and all must be payments recorded by hand. Find the bank line with giving.bank_lines_unmatched.",
  level: "confirm",
  permission: "bankConfirm",
  module: "giving",
  enabledByDefault: false,
  requiresOwnerSwitch: true,
  covers: ["src/app/(app)/giving/payments/bank/actions.ts#matchDepositAction"],
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const d = await look(ctx, inp);
    const money = (c: number) => formatCents(c, d.currency);
    return {
      summary: `Match the ${money(d.bank.amount_cents)} deposit of ${d.bank.posted_on} to ${d.payments.length} recorded payment${d.payments.length === 1 ? "" : "s"}.`,
      lines: [
        { label: "Bank line", value: `${d.bank.posted_on} · ${money(d.bank.amount_cents)}${d.bank.description ? ` · ${d.bank.description}` : ""}` },
        ...d.payments.map((p) => ({
          label: `${p.receipt_number ?? "Payment"} · ${p.method}${p.check_number ? ` ${p.check_number}` : ""} · ${p.received_on}`,
          value: money(p.amount_cents),
        })),
        { label: "Total", value: `${money(d.payments.reduce((s, p) => s + p.amount_cents, 0))} (matches the deposit)` },
      ],
      households: d.households,
      warnings: ["The payments are marked settled and one QuickBooks deposit is queued for the whole batch."],
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    // Looked at again now: a payment may have been put on another deposit since the person saw the card.
    await look(ctx, inp);
    const { db, center } = ctx.session;
    let raw: unknown;
    try {
      raw = await rpcJson(db, "match_deposit", { p_txn: inp.bank_line_id, p_payment_ids: inp.payment_ids }, "match the deposit");
    } catch (error) {
      // The totals problem has its own sentence (the Bank screen's); anything else is explained by the command runner.
      const problem = error instanceof CommandDbError ? depositTotalProblem((error.dbError as { message?: string | null } | null)?.message, center.currency) : null;
      if (problem) throw new CommandError(problem);
      throw error;
    }
    const count = typeof raw === "number" ? raw : inp.payment_ids.length;
    revalidateAfterCommand(["/giving/payments/bank", "/giving/payments", "/"]);
    return { ok: true, data: { count }, message: depositMatchedMessage(count) };
  },
});
