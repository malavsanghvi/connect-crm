import type { TermRulesInput } from "@/lib/pathshala-registration/contract";
import { PAYMENT_MODES } from "@/lib/pathshala-registration/contract";
import { parseFeeInput, parseMoneyInput } from "@/lib/pathshala-registration/money";
import { PAYMENT_MODE_LABEL, feeEditing, rulesProblem } from "@/lib/pathshala-registration/rules";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import type { PreviewLine } from "../../types";

import { day, fee, groupsFor, loadSetup, money, rulesOf } from "./setup";

const input = object({
  term_id: f.uuid("The term (its id, from learning.term_setup)."),
  level_id: f.optional(f.uuid("A level whose fee would change (its id, from learning.term_setup). Use it with fee.")),
  fee: f.optional(f.string("The new fee for that level in dollars: '130', '130.50' or 'Free'.", { max: 40 })),
  sibling_discount_percent: f.optional(f.integer("The sibling discount as a whole percent from 0 to 100 (0 for none).", { min: 0, max: 100 })),
  family_cap: f.optional(f.string("The most one family pays for the term, in dollars like '300', or 'none' for no cap.", { max: 40 })),
  late_fee: f.optional(f.string("The late fee in dollars like '25', or 'none'.", { max: 40 })),
  how_families_pay: f.optional(f.enum("How families pay: 'pledge' (register now, pay later) or 'pay_now' (pay when registering).", PAYMENT_MODES)),
  starts_on: f.optional(f.date("The first day of the term, like 2026-09-06.")),
  ends_on: f.optional(f.date("The last day of the term, like 2027-05-30.")),
});
export type DraftTermChangeInput = Infer<typeof input>;

export type TermChangeDraft = {
  term_id: string;
  term: string;
  /** "Change the fee of Jainism 2 from $130.00 to $135.00." */
  summary: string;
  changes: { what: string; from: string; to: string }[];
  /** Things that stop it or that the person should know before it is done. */
  problems: string[];
  warnings: string[];
  who_may_apply_it: string;
  how_to_apply: string[];
  nothing_has_been_saved: true;
};

const NONE = /^(none|no cap|no)$/i;

/** A change to a term's setup, shown as from-and-to in dollars, checked against the same rules the database applies, and not saved. */
export const draftTermChange = defineCommand<DraftTermChangeInput, TermChangeDraft>({
  key: "learning.draft_term_change",
  title: "Prepare a change to a term's setup",
  description:
    "Prepare a change to a Pathshala term and show it as from-and-to, with every amount in dollars, without saving anything: a level's fee, the sibling discount, the family cap, the late fee, how families pay, or the term's dates. " +
    "It checks the change against the same rules the database applies and says who may make it (the principal or treasurer before registration opens; only the treasurer with a reason after). " +
    "A fee change can then be made with learning.set_level_fees, which asks the person to confirm; the other changes are made on the term's Fees and rules page. It never touches a learner or a family's registration.",
  level: "draft",
  permission: "pathshalaFees",
  module: "pathshala",
  input,
  async execute(ctx, inp) {
    const world = await loadSetup(ctx, { termId: inp.term_id, readiness: inp.how_families_pay === "pay_now" });
    const term = world.terms[0];
    const rules = rulesOf(world, term);
    const tz = ctx.session.center.time_zone;
    const currency = ctx.session.center.currency;
    const editing = feeEditing(ctx.session, { status: term.status, fees_locked_at: rules.fees_locked_at });
    const changes: PreviewLine[] = [];
    const problems: string[] = [];
    const how: string[] = [];

    // A level's fee.
    if ((inp.level_id === undefined) !== (inp.fee === undefined)) problems.push("To change a fee, give both the level (level_id) and the new fee.");
    if (inp.level_id !== undefined && inp.fee !== undefined) {
      const level = world.levels.find((l) => l.id === inp.level_id);
      if (!level) problems.push("That level was not found. Take its id from learning.term_setup.");
      else {
        const parsed = parseFeeInput(inp.fee, level.name, currency);
        if (!parsed.ok) problems.push(parsed.error);
        else if (parsed.cents === null) problems.push(`Say the new fee for ${level.name}.`);
        else {
          const saved = world.fees.find((x) => x.term_id === term.id && x.level_id === level.id)?.fee_cents ?? null;
          if (saved === parsed.cents) changes.push({ label: `Fee of ${level.name}`, before: fee(ctx, saved), after: `${fee(ctx, parsed.cents)} (no change)` });
          else {
            changes.push({ label: `Fee of ${level.name}`, before: fee(ctx, saved), after: fee(ctx, parsed.cents) });
            how.push("The fee: ask Niva to change it with learning.set_level_fees (the person confirms; the community must have switched it on), or save it on the term's Fees and rules page.");
          }
        }
      }
    }

    // The rules.
    let rulesChanged = false;
    const next: TermRulesInput = {
      payment_mode: rules.payment_mode,
      hold_hours: rules.hold_hours,
      office_payment_allowed: rules.office_payment_allowed,
      office_hold_days: rules.office_hold_days,
      seat_rule: rules.seat_rule,
      sibling_discount_pct: term.sibling_discount_pct,
      fee_per_family_cap_cents: term.fee_per_family_cap_cents,
      late_registration_closes_at: rules.late_registration_closes_at,
      late_fee_cents: rules.late_fee_cents,
      withdrawal_credit_until: rules.withdrawal_credit_until,
      age_cutoff_on: rules.age_cutoff_on,
    };
    if (inp.sibling_discount_percent !== undefined && inp.sibling_discount_percent !== term.sibling_discount_pct) {
      changes.push({ label: "Sibling discount", before: term.sibling_discount_pct > 0 ? `${term.sibling_discount_pct}%` : "none", after: inp.sibling_discount_percent > 0 ? `${inp.sibling_discount_percent}%` : "none" });
      next.sibling_discount_pct = inp.sibling_discount_percent;
      rulesChanged = true;
    }
    if (inp.family_cap !== undefined) {
      const parsed = NONE.test(inp.family_cap) ? { ok: true as const, cents: null } : parseMoneyInput(inp.family_cap, "The family cap");
      if (!parsed.ok) problems.push(parsed.error);
      else if (parsed.cents !== term.fee_per_family_cap_cents) {
        changes.push({ label: "Family cap", before: term.fee_per_family_cap_cents !== null ? money(ctx, term.fee_per_family_cap_cents) : "none", after: parsed.cents !== null ? money(ctx, parsed.cents) : "none" });
        next.fee_per_family_cap_cents = parsed.cents;
        rulesChanged = true;
      }
    }
    if (inp.late_fee !== undefined) {
      const parsed = NONE.test(inp.late_fee) ? { ok: true as const, cents: 0 } : parseMoneyInput(inp.late_fee, "The late fee");
      if (!parsed.ok) problems.push(parsed.error);
      else if ((parsed.cents ?? 0) !== rules.late_fee_cents) {
        changes.push({ label: "Late fee", before: rules.late_fee_cents > 0 ? money(ctx, rules.late_fee_cents) : "none", after: (parsed.cents ?? 0) > 0 ? money(ctx, parsed.cents ?? 0) : "none" });
        next.late_fee_cents = parsed.cents ?? 0;
        rulesChanged = true;
      }
    }
    if (inp.how_families_pay !== undefined && inp.how_families_pay !== rules.payment_mode) {
      changes.push({ label: "How families pay", before: PAYMENT_MODE_LABEL[rules.payment_mode], after: PAYMENT_MODE_LABEL[inp.how_families_pay] });
      next.payment_mode = inp.how_families_pay;
      rulesChanged = true;
      if (inp.how_families_pay === "pay_now" && world.payNowBlocked) problems.push(`"Pay when registering" cannot be used yet: ${world.payNowBlocked}`);
    }
    if (rulesChanged) {
      const problem = rulesProblem(next, term, tz);
      if (problem) problems.push(problem);
      how.push("The rules: save them on the term's Fees and rules page. Niva does not change a term's rules.");
    }

    // The term's dates.
    const starts = inp.starts_on ?? term.starts_on;
    const ends = inp.ends_on ?? term.ends_on;
    if (inp.starts_on !== undefined && inp.starts_on !== term.starts_on) changes.push({ label: "First day of the term", before: day(ctx, term.starts_on), after: day(ctx, inp.starts_on) });
    if (inp.ends_on !== undefined && inp.ends_on !== term.ends_on) changes.push({ label: "Last day of the term", before: day(ctx, term.ends_on), after: day(ctx, inp.ends_on) });
    if (ends < starts) problems.push("The term must end after it starts.");
    if ((inp.starts_on !== undefined && inp.starts_on !== term.starts_on) || (inp.ends_on !== undefined && inp.ends_on !== term.ends_on)) {
      how.push("The dates: change them on Pathshala › Terms. Niva does not change a term's dates.");
    }

    const warnings: string[] = [];
    if (editing.closed) problems.push(editing.note);
    else if (!editing.canEdit) warnings.push(editing.note);
    else if (editing.locked && (changes.length > 0)) warnings.push("Registration is open, so a change needs a reason and applies to new registrations only: fees already quoted or billed do not change.");
    if (groupsFor(world, term).length === 0) warnings.push("This term has no levels with fees or classes yet.");

    const real = changes.filter((c) => !String(c.after).endsWith("(no change)"));
    const summary = problems.length
      ? `This change cannot be made yet: ${problems[0]}`
      : real.length === 0
        ? `Nothing would change in ${term.name}: it is already set up that way.`
        : `${real.map((c) => `${c.label.charAt(0).toLowerCase()}${c.label.slice(1)} from ${c.before ?? "none"} to ${c.after ?? "none"}`).join("; ")} in ${term.name}.`;
    return {
      ok: true,
      data: {
        term_id: term.id,
        term: term.name,
        summary: problems.length || real.length === 0 ? summary : `Change ${summary}`,
        changes: changes.map((c) => ({ what: c.label, from: c.before ?? "none", to: c.after ?? "none" })),
        problems,
        warnings,
        who_may_apply_it: editing.note,
        how_to_apply: how,
        nothing_has_been_saved: true,
      },
      message: `${problems.length || real.length === 0 ? summary : `Change ${summary}`} Nothing has been saved.`,
    };
  },
});
