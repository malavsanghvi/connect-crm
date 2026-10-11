import { todayInTz } from "@/lib/dates";
import { formatCents } from "@/lib/money";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";

import { rpcJson } from "./db";
import { asObj, int, rows, str } from "./giving-json";

export type UnmatchedBankLine = {
  id: string;
  /** A gift is money in from one payer; a deposit is a batch of checks or cash. */
  kind: "gift" | "deposit";
  posted_on: string;
  days_waiting: number;
  amount_cents: number;
  amount: string;
  channel: string | null;
  payer_name: string | null;
  reference: string | null;
  description: string;
  suggested: boolean;
  account: string | null;
};

export type UnmatchedBankData = {
  as_of: string;
  gifts: number;
  gifts_cents: number;
  gifts_total: string;
  deposits: number;
  deposits_cents: number;
  deposits_total: string;
  /** Money-out lines and card payouts waiting; counted, not listed. */
  debits: number;
  payouts: number;
  oldest_posted_on: string | null;
  oldest_days: number | null;
  lines: UnmatchedBankLine[];
  where_to_match: string;
};

const input = object({
  limit: f.withDefault(f.integer("The most bank lines to list, oldest first.", { min: 1, max: 25 }), 10),
});

export const bankLinesUnmatched = defineCommand<Infer<typeof input>, UnmatchedBankData>({
  key: "giving.bank_lines_unmatched",
  title: "Show bank lines nobody has matched",
  description:
    "The bank lines still waiting to be matched to a household or to recorded checks: single gifts (for example Zelle and ACH) and batch deposits of checks or cash, " +
    "with how many there are, their total in dollars, how long the oldest has waited, and the oldest ones with the payer, the bank's wording and the amount. " +
    "Money-out lines and card payouts are counted. Read only: it does not match anything. Matching is done on Giving > Payments > Bank.",
  level: "read",
  permission: "bank",
  module: "giving",
  input,
  async execute(ctx, { limit }) {
    const { db, center } = ctx.session;
    const today = todayInTz(center.time_zone, ctx.now?.());
    const money = (c: number) => formatCents(c, center.currency);
    const j = asObj(await rpcJson(db, "giving_unmatched_bank_lines", { p_center: center.id, p_limit: limit, p_today: today }, "read the bank lines"));
    const data: UnmatchedBankData = {
      as_of: str(j.as_of) ?? today,
      gifts: int(j.gifts),
      gifts_cents: int(j.gifts_cents),
      gifts_total: money(int(j.gifts_cents)),
      deposits: int(j.deposits),
      deposits_cents: int(j.deposits_cents),
      deposits_total: money(int(j.deposits_cents)),
      debits: int(j.debits),
      payouts: int(j.payouts),
      oldest_posted_on: str(j.oldest_posted_on),
      oldest_days: str(j.oldest_posted_on) ? int(j.oldest_days) : null,
      lines: rows(j.lines).map((l) => ({
        id: str(l.id) ?? "",
        kind: l.kind === "deposit" ? "deposit" : "gift",
        posted_on: str(l.posted_on) ?? "",
        days_waiting: int(l.days_waiting),
        amount_cents: int(l.amount_cents),
        amount: money(int(l.amount_cents)),
        channel: str(l.channel),
        payer_name: str(l.payer_name),
        reference: str(l.reference),
        description: str(l.description) ?? "",
        suggested: l.status === "suggested",
        account: str(l.account),
      })),
      where_to_match: "/giving/payments/bank",
    };
    const waiting = data.gifts + data.deposits;
    return {
      ok: true,
      data,
      message:
        waiting === 0
          ? "Every bank line is matched or set aside."
          : waiting > data.lines.length
            ? `Showing the oldest ${data.lines.length} of ${waiting} bank lines waiting.`
            : undefined,
    };
  },
});
