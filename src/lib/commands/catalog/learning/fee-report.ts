import { isPermissionError } from "@/lib/access-db";
import { schoolOrGeneric } from "@/lib/kind-samples";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError } from "../../types";
import { must, rpcJson } from "../db";
import { asObj, int, isObj, rows, str } from "../giving-json";

import { NO_ACCESS_HERE, NO_TERM, money, school, type Term } from "./setup";

const input = object({
  term_id: f.optional(f.uuid("One term (its id, from learning.term_setup). Leave it out for the term that is running, else the one open for registration.")),
});

/** A level with fewer fee lines than this is added to "other levels", so a total never stands for one or two learners. */
export const SMALLEST_LEVEL_SHOWN = 3;

export type FeeReportData = {
  term_id: string;
  term: string;
  fee_lines: number;
  fees_before_discounts: string;
  sibling_discounts: string;
  family_cap_reductions: string;
  late_fees: string;
  fee_assistance: string;
  total_fees: string;
  collected: string;
  billed_not_paid_yet: string;
  not_billed_yet: string;
  percent_collected: number | null;
  lines_the_office_still_has_to_price: number;
  by_level: { track: string; level: string; fee_lines: number; total: string; collected: string }[];
  other_levels: { levels: number; fee_lines: number; total: string; collected: string } | null;
};

/** The term this report is about: the one asked for, else the one running, else the one open for registration. */
function chooseTerm(terms: Term[], asked: string | undefined): Term | null {
  if (asked) return terms.find((t) => t.id === asked) ?? null;
  return terms.find((t) => t.status === "active") ?? terms.find((t) => t.status === "registration") ?? null;
}

/** The fee totals of a term: sums in the community's currency, in all and by level. Never who paid or owes. */
export const feeReport = defineCommand<Infer<typeof input>, FeeReportData>({
  key: "learning.fee_report",
  title: "Look at the school fee totals",
  description: (kind) => {
    const schoolName = schoolOrGeneric(kind);
    return (
      `Give the ${schoolName} fee totals for a term, in the community's currency: what the fees add up to, what has been collected, what is billed but not paid yet, what is not billed yet, and the discounts, late fees and fee assistance, in all and level by level. ` +
      `It is SUMS only. It never says which family or which learner paid or owes anything; a level with fewer than three fee lines is added to 'other levels' so a total never stands for one or two learners. Needs access to ${schoolName} fees or to Giving. It changes nothing.`
    );
  },
  level: "read",
  permission: "pathshalaFees",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const terms = (must(await db.from("pathshala_terms").select("*").eq("center_id", center.id).order("starts_on", { ascending: false }), "read the terms") ?? []) as Term[];
    const term = chooseTerm(terms, inp.term_id);
    if (!term) {
      if (inp.term_id) throw new CommandError(NO_TERM);
      throw new CommandError(`No ${school(ctx)} term is running or open for registration. Give term_id (from learning.term_setup) to look at another one.`);
    }

    let raw: unknown;
    try {
      raw = await rpcJson(db, "pathshala_fee_totals", { p_term: term.id }, `add up the ${school(ctx)} fees`);
    } catch (error) {
      if (error instanceof CommandDbError && isPermissionError(error.dbError)) throw new CommandError(NO_ACCESS_HERE);
      throw error;
    }
    const t = asObj(raw);
    if (!isObj(raw) || str(t.term_id) !== term.id) throw new CommandError("The fee totals came back in a shape this screen cannot read. Has the latest database update been applied?");

    const total = int(t.total_cents);
    const paid = int(t.paid_cents);
    const levels = rows(t.by_level).map((l) => ({
      track: str(l.track) ?? "",
      level: str(l.level) ?? "Level",
      lines: int(l.fee_lines),
      total: int(l.total_cents),
      paid: int(l.paid_cents),
    }));
    const shown = levels.filter((l) => l.lines >= SMALLEST_LEVEL_SHOWN);
    const small = levels.filter((l) => l.lines < SMALLEST_LEVEL_SHOWN);
    const data: FeeReportData = {
      term_id: term.id,
      term: term.name,
      fee_lines: int(t.fee_lines),
      fees_before_discounts: money(ctx, int(t.base_cents)),
      sibling_discounts: money(ctx, int(t.sibling_discount_cents)),
      family_cap_reductions: money(ctx, int(t.cap_reduction_cents)),
      late_fees: money(ctx, int(t.late_fee_cents)),
      fee_assistance: money(ctx, int(t.assistance_cents)),
      total_fees: money(ctx, total),
      collected: money(ctx, paid),
      billed_not_paid_yet: money(ctx, int(t.billed_unpaid_cents)),
      not_billed_yet: money(ctx, int(t.not_billed_cents)),
      percent_collected: total > 0 ? Math.round((paid / total) * 100) : null,
      lines_the_office_still_has_to_price: int(t.unpriced_lines),
      by_level: shown.map((l) => ({ track: l.track, level: l.level, fee_lines: l.lines, total: money(ctx, l.total), collected: money(ctx, l.paid) })),
      other_levels: small.length
        ? { levels: small.length, fee_lines: small.reduce((n, l) => n + l.lines, 0), total: money(ctx, small.reduce((n, l) => n + l.total, 0)), collected: money(ctx, small.reduce((n, l) => n + l.paid, 0)) }
        : null,
    };
    return {
      ok: true,
      data,
      message:
        data.fee_lines === 0
          ? `${term.name} has no fee lines yet.`
          : `${term.name}: ${data.total_fees} in fees, ${data.collected} collected${data.percent_collected !== null ? ` (${data.percent_collected}%)` : ""}, ${data.billed_not_paid_yet} billed and not paid yet, ${data.not_billed_yet} not billed yet.`,
    };
  },
});
