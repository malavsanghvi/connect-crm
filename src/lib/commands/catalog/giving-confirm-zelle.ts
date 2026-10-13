// giving.confirm_exact_zelle_matches: confirm the Zelle reports whose bank line matches exactly (same confirmation number and amount).
// A MONEY command, built but OFF (requiresOwnerSwitch, see giving-record-payment.ts): confirming records each Zelle as a payment,
// applies it to the household's pledges and queues it for QuickBooks, the same as the Bank screen's "Confirm exact matches".
//
// The person confirms THESE reports (their ids are part of the confirmed input). When the button is pressed the exact matches are
// read again, and the database re-checks every pair; a report that is no longer exact is skipped and said so, never guessed at.

import { formatCents } from "@/lib/money";
import { exactConfirmSummary } from "@/lib/payments/bank-match";
import { MAX_BULK_PAIRS, parseExactConfirm, parseExactPair, type ExactPair } from "@/lib/payments/zelle";
import { todayInTz } from "@/lib/dates";

import { defineCommand } from "../define";
import { revalidateAfterCommand } from "../revalidate";
import { object, type Infer } from "../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../types";

import { rpcJson } from "./db";
import { uuidList } from "./giving-fields";
import { requireConfirmedRun } from "./giving-guard";
import { asArr } from "./giving-json";
import { adultHouseholdCards } from "./household";

const input = object({
  report_ids: uuidList("The Zelle reports to confirm (their ids from giving.zelle_waiting, only ones marked as having an exact bank match).", { max: MAX_BULK_PAIRS }),
});
type Input = Infer<typeof input>;

const UNEXPECTED_SHAPE = "the database answered in a shape this screen does not understand (has the latest migration been applied?).";
const NOTHING_EXACT = "None of these reports has a bank line that matches it exactly, so there is nothing to confirm. Match them by hand on the Bank screen.";

/** The exact pairs among the reports asked about, read now. */
async function exactPairs(ctx: CommandContext, reportIds: readonly string[]): Promise<{ pairs: ExactPair[]; left: number }> {
  const all = asArr(await rpcJson(ctx.session.db, "zelle_exact_matches", { p_center: ctx.session.center.id }, "look for exact Zelle matches")).flatMap((v) => parseExactPair(v) ?? []);
  const wanted = new Set(reportIds);
  const pairs = all.filter((p) => wanted.has(p.report_id));
  return { pairs, left: reportIds.length - pairs.length };
}

export const confirmExactZelleMatches = defineCommand<Input, { confirmed: { report_id: string; payment_id: string; receipt_number: string | null }[]; skipped: { report_id: string | null; reason: string }[] }>({
  key: "giving.confirm_exact_zelle_matches",
  title: "Confirm the exact Zelle matches",
  description:
    "Confirm Zelle payments members reported whose bank line matches exactly (same confirmation number and amount). Each is recorded as a payment for the household, applied to its pledges earliest first (or the pledges the member named) and queued for QuickBooks. " +
    "This asks the person to confirm first, showing each household card, the amount and the bank line; nothing is recorded until they press the button. " +
    "Take the report ids from giving.zelle_waiting. A report that is not an exact match is left out and must be matched by hand.",
  level: "confirm",
  permission: "bankConfirm",
  module: "giving_bank",
  enabledByDefault: false,
  requiresOwnerSwitch: true,
  covers: ["src/app/(app)/giving/payments/bank/zelle-actions.ts#confirmExactMatchesAction"],
  input,
  async preview(ctx, { report_ids }): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const { pairs, left } = await exactPairs(ctx, report_ids);
    if (pairs.length === 0) throw new CommandError(NOTHING_EXACT);
    const today = todayInTz(center.time_zone, ctx.now?.());
    const { cards } = await adultHouseholdCards(db, pairs.flatMap((p) => p.household?.household_id ?? []), { today, currency: center.currency });
    const money = (c: number) => formatCents(c, center.currency);
    const total = pairs.reduce((sum, p) => sum + p.amount_cents, 0);
    return {
      summary: `Confirm ${pairs.length} Zelle${pairs.length === 1 ? "" : "s"} totalling ${money(total)}.`,
      lines: pairs.map((p) => ({
        label: `${money(p.amount_cents)} sent ${p.sent_on}`,
        value: `bank line ${p.posted_on}${p.payer_name ? ` from ${p.payer_name}` : ""}${p.household?.household_number ? ` · household ${p.household.household_number}` : ""}`,
      })),
      households: cards,
      warnings: [
        "Each Zelle is recorded as a payment, applied to the household's earliest open pledge first (or the pledges the member named), and queued for QuickBooks once.",
        ...(left > 0 ? [`${left} of the reports you named ${left === 1 ? "has" : "have"} no exact bank match and ${left === 1 ? "is" : "are"} left out.`] : []),
      ],
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, { report_ids }) {
    requireConfirmedRun(ctx, "giving.confirm_exact_zelle_matches");
    // The exact matches are read for the community the person is working in (the database function takes it), so a report of
    // another community is never among them, whoever is asking.
    const { pairs } = await exactPairs(ctx, report_ids);
    if (pairs.length === 0) throw new CommandError(NOTHING_EXACT);
    const raw = await rpcJson(
      ctx.session.db,
      "confirm_exact_zelle_matches",
      { p_center: ctx.session.center.id, p_pairs: pairs.map((p) => ({ report_id: p.report_id, bank_transaction_id: p.bank_transaction_id })) },
      "confirm the exact matches",
    );
    const outcome = parseExactConfirm(raw);
    if (!outcome) {
      console.error("[commands] giving.confirm_exact_zelle_matches: unexpected shape:", raw);
      throw new CommandError(`Could not confirm the exact matches — ${UNEXPECTED_SHAPE} Reload the Bank screen to see which were recorded.`);
    }
    revalidateAfterCommand(["/giving/payments/bank", "/giving/payments", "/settings/payments"]);
    const { ok, message } = exactConfirmSummary(outcome);
    if (!ok) throw new CommandError(`Could not confirm the exact matches — ${message}`);
    return { ok: true, data: outcome, message };
  },
});
