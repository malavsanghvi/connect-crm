import { PAYMENT_MODE_LABEL, SEAT_RULE_LABEL, feeEditing, termStatusLabel } from "@/lib/pathshala-registration/rules";
import { bandCell, missingFeeNames } from "@/lib/pathshala-registration/fees";
import { formatDateTime } from "@/lib/pathshala/format";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import type { CommandContext } from "../../types";

import { day, fee, groupsFor, loadSetup, money, rulesOf, type SetupWorld, type Term } from "./setup";

const input = object({
  term_id: f.optional(f.uuid("One term (its id, from an earlier answer). Leave it out to see every term that is not closed.")),
});

export type LevelLine = {
  track: string;
  level: string;
  level_id: string;
  /** Who the level is for and the ages: "Children's level · ages 5 to 7". */
  age_band: string;
  /** "$130.00", "Free" or "Not set". */
  fee: string;
  /** What to start from when no fee is set yet: "$130.00 last term (2025-26)". Never a value by itself. */
  suggested_fee: string | null;
  classes_this_term: number;
  offered_to_families: boolean;
  retired: boolean;
};

export type TermSetup = {
  term_id: string;
  name: string;
  status: string;
  /** True while the term is in its registration stage. */
  registration_is_open: boolean;
  dates: string;
  registration_dates: string;
  fees_and_rules_locked: boolean;
  who_may_change_fees: string;
  rules: {
    how_families_pay: string;
    seats: string;
    seat_hold_hours: number | null;
    pay_at_the_office: string | null;
    sibling_discount: string;
    family_cap: string;
    late_fee: string;
    late_registration_until: string;
    withdrawal_credit_until: string;
    age_cut_off_date: string;
    fund: string;
    membership_required: boolean;
  };
  levels: LevelLine[];
  levels_offered_without_a_fee: string[];
};

function fundWords(world: SetupWorld, fundId: string | null, locked: boolean): string {
  if (fundId) return world.funds?.find((x) => x.id === fundId)?.name ?? "A fund chosen by the treasurer";
  return locked ? "No fund chosen" : "Found when registration opens (the Pathshala fund)";
}

/** One term as a person would describe its setup: dates, rules, and every level with its fee in dollars. */
export function describeTerm(ctx: CommandContext, world: SetupWorld, term: Term): TermSetup {
  const rules = rulesOf(world, term);
  const tz = ctx.session.center.time_zone;
  const editing = feeEditing(ctx.session, { status: term.status, fees_locked_at: rules.fees_locked_at });
  const groups = groupsFor(world, term);
  const payNow = rules.payment_mode === "pay_now";
  const opens = term.registration_opens_at ? `from ${formatDateTime(term.registration_opens_at, tz)}` : "as soon as it opens";
  const closes = term.registration_closes_at ? ` until ${formatDateTime(term.registration_closes_at, tz)}` : ", with no closing date";
  return {
    term_id: term.id,
    name: term.name,
    status: termStatusLabel(term.status),
    registration_is_open: term.status === "registration",
    dates: `${day(ctx, term.starts_on)} to ${day(ctx, term.ends_on)}`,
    registration_dates: term.registration_opens_at || term.registration_closes_at ? `${opens}${closes}` : "No registration dates are set",
    fees_and_rules_locked: rules.fees_locked_at !== null,
    who_may_change_fees: editing.note,
    rules: {
      how_families_pay: PAYMENT_MODE_LABEL[rules.payment_mode],
      seats: SEAT_RULE_LABEL[rules.seat_rule],
      seat_hold_hours: payNow ? rules.hold_hours : null,
      pay_at_the_office: payNow ? (rules.office_payment_allowed ? `allowed, the seat is held ${rules.office_hold_days} days` : "not allowed") : null,
      sibling_discount: term.sibling_discount_pct > 0 ? `${term.sibling_discount_pct}% off the younger children` : "none",
      family_cap: term.fee_per_family_cap_cents !== null ? money(ctx, term.fee_per_family_cap_cents) : "none",
      late_fee: rules.late_fee_cents > 0 ? money(ctx, rules.late_fee_cents) : "none",
      late_registration_until: rules.late_registration_closes_at ? formatDateTime(rules.late_registration_closes_at, tz) : "no late window",
      withdrawal_credit_until: rules.withdrawal_credit_until ? day(ctx, rules.withdrawal_credit_until) : "set when registration opens",
      age_cut_off_date: rules.age_cutoff_on ? day(ctx, rules.age_cutoff_on) : "the first day of the term",
      fund: fundWords(world, rules.fund_id, rules.fees_locked_at !== null),
      membership_required: term.membership_required,
    },
    levels: groups.flatMap((g) =>
      g.rows.map((r): LevelLine => ({
        track: g.track.name,
        level: r.level.name,
        level_id: r.level.id,
        age_band: bandCell(r.level),
        fee: fee(ctx, r.saved),
        suggested_fee: r.suggestion ? `${money(ctx, r.suggestion.cents)} from ${r.suggestion.from}` : null,
        classes_this_term: r.classes,
        offered_to_families: r.offered,
        retired: !r.level.active,
      })),
    ),
    levels_offered_without_a_fee: missingFeeNames(groups),
  };
}

export type TermSetupData = { terms: TermSetup[] };

/** The setup of a term: levels, age bands, fees in dollars, the registration rules, and whether registration is open. */
export const termSetup = defineCommand<Infer<typeof input>, TermSetupData>({
  key: "learning.term_setup",
  title: "Look at a term's setup",
  description:
    "Describe how a Pathshala term is set up: its dates, whether registration is open, the registration rules (how families pay, seats, sibling discount, family cap, late fee, deadlines, the fund), " +
    "and every level with its age band, its fee in dollars and how many classes it has this term, plus the levels that families can choose but have no fee yet. " +
    "Leave term_id out to see every term that is not closed. It is about the setup of the term only: levels, fees, rules and classes. It never shows a learner, a family's registration or anyone under 18. It changes nothing.",
  level: "read",
  permission: "pathshalaFees",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const world = await loadSetup(ctx, { termId: inp.term_id });
    const terms = world.terms.map((t) => describeTerm(ctx, world, t));
    const open = terms.filter((t) => t.registration_is_open).length;
    return {
      ok: true,
      data: { terms },
      message:
        terms.length === 0
          ? "There is no Pathshala term that is not closed."
          : `${terms.length} term${terms.length === 1 ? "" : "s"}: ${terms.map((t) => `${t.name} (${t.status.toLowerCase()})`).join(", ")}. Registration is open for ${open}.`,
    };
  },
});
