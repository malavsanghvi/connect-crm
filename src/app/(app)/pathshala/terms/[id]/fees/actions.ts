"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/lib/errors";
import { bool, dateTime, DbFailure, FormError, int, isoDate, must, ok, oneOf, runAction, str } from "@/lib/forms";
import { pathshalaAreas as areas } from "@/lib/pathshala/access";
import { actionContext } from "@/lib/pathshala/server";
import { PAYMENT_MODES, SEAT_RULES, type ExampleLineInput, type Quote, type TermRulesInput } from "@/lib/pathshala-registration/contract";
import { feeExample, loadLevelFees, loadLevelRows, loadTermRules, NEEDS_UPDATE, openRegistration, setLevelFees, setTermRules } from "@/lib/pathshala-registration/db";
import { changedFees } from "@/lib/pathshala-registration/fees";
import { parseAgeInput } from "@/lib/pathshala-registration/levels";
import { parseFeeInput, parseMoneyInput } from "@/lib/pathshala-registration/money";
import { refusal } from "@/lib/pathshala-registration/refusal";
import { feeEditing, rulesProblem } from "@/lib/pathshala-registration/rules";

// Pathshala › Terms › Fees and rules (PATHSHALA_REGISTRATION_PLAN §2.2, §2.6, §2.7, §3.3). Every write goes through
// the 0590 functions, which check who may (P9, P16: before the lock the principal or the treasurer; after it the
// treasurer with a reason) and every rule; these actions check first so the form can explain before it asks.

/** Most learners "Try a family" works out at once. */
const EXAMPLE_MAX_LINES = 12;

/** The term, its 0590 rules and who may change them now (re-checked here: actions are reachable by direct POST). */
async function termForChange(termId: string) {
  const ctx = await actionContext(areas.fees, "You don't have access to Pathshala fees.");
  const term = must(
    await ctx.supabase.from("pathshala_terms").select("id, name, status, starts_on, ends_on, registration_closes_at").eq("id", termId).maybeSingle(),
    "find the term",
  );
  if (!term) throw new FormError("That term no longer exists, or it is a draft only the Pathshala principal can see. Reload the page.");
  const rules = await loadTermRules(ctx.supabase, [termId]);
  if (rules.status === "missing") throw new FormError(NEEDS_UPDATE);
  if (rules.status === "error") throw new DbFailure(rules.error, "read the term's rules");
  if (rules.status === "shape") throw new FormError(`The term's rules could not be read (${rules.message}). Has the latest migration been applied?`);
  const current = rules.value.get(termId);
  if (!current) throw new FormError("That term's rules could not be found. Reload the page.");
  return { ...ctx, term, rules: current, editing: feeEditing(ctx.viewer, { status: term.status, fees_locked_at: current.fees_locked_at }) };
}

/** After the lock a change needs a reason (P9); before it, the reason is optional and the database records its own. */
function reasonFor(fd: FormData, needsReason: boolean, what: string): string | null {
  const reason = str(fd, "reason");
  if (needsReason && !reason) throw new FormError(`Registration is open: say why the ${what} change. The reason is kept in the audit log.`);
  return reason;
}

/** Save the fees typed on the Fees screen: only the ones that differ from what is saved are sent. */
export async function saveFeesAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveFees", "save the fees", async () => {
    const { supabase, centerId, viewer, term, editing } = await termForChange(termId);
    if (!editing.canEdit) throw new FormError(editing.note);
    const [levels, fees] = await Promise.all([loadLevelRows(supabase, centerId), loadLevelFees(supabase, centerId)]);
    if (levels.status === "missing" || fees.status === "missing") throw new FormError(NEEDS_UPDATE);
    if (levels.status === "error") throw new DbFailure(levels.error, "read the levels");
    if (fees.status === "error") throw new DbFailure(fees.error, "read the saved fees");
    if (levels.status === "shape" || fees.status === "shape") throw new FormError("The levels or the saved fees could not be read. Has the latest migration been applied?");
    const names = new Map(levels.value.map((l) => [l.id, l.name]));
    const entered = new Map<string, number | null>();
    for (const [key, value] of fd.entries()) {
      if (!key.startsWith("fee:")) continue;
      const levelId = key.slice("fee:".length);
      const name = names.get(levelId);
      if (!name) throw new FormError("One of the levels on this page no longer exists. Reload the page.");
      const parsed = parseFeeInput(typeof value === "string" ? value : "", name, viewer.center.currency);
      if (!parsed.ok) throw new FormError(parsed.error);
      entered.set(levelId, parsed.cents);
    }
    const saved = new Map(fees.value.filter((f) => f.term_id === termId).map((f) => [f.level_id, f.fee_cents]));
    const changes = changedFees(saved, entered);
    if (!changes.length) return ok("Nothing to save: every fee is as it was.");
    const reason = reasonFor(fd, editing.needsReason, "fees");
    const res = await setLevelFees(supabase, termId, changes, reason);
    if (!res.ok) return refusal("save the fees", res);
    refresh();
    const what = changes.length === 1 ? `The fee for ${names.get(changes[0].level_id)} is saved` : `${changes.length} fees are saved`;
    return ok(`${what} for ${term.name}.${editing.locked ? " The change applies to new registrations only." : ""}`);
  });
}

/** Save the term's registration rules: how families pay, holds, seats, discount, cap, late window, deadlines, fund. */
export async function saveRulesAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveRules", "save the rules", async () => {
    const { supabase, tz, term, rules, editing } = await termForChange(termId);
    if (!editing.canEdit) throw new FormError(editing.note);
    const cap = parseMoneyInput(str(fd, "fee_per_family_cap"), "The family cap");
    if (!cap.ok) throw new FormError(cap.error);
    const lateFee = parseMoneyInput(str(fd, "late_fee"), "The late fee");
    if (!lateFee.ok) throw new FormError(lateFee.error);
    const input: TermRulesInput = {
      payment_mode: oneOf(fd, "payment_mode", PAYMENT_MODES, "Way families pay", rules.payment_mode),
      hold_hours: int(fd, "hold_hours", "The hold") ?? rules.hold_hours,
      office_payment_allowed: bool(fd, "office_payment_allowed"),
      office_hold_days: int(fd, "office_hold_days", "The office hold") ?? rules.office_hold_days,
      seat_rule: oneOf(fd, "seat_rule", SEAT_RULES, "Seat rule", rules.seat_rule),
      sibling_discount_pct: int(fd, "sibling_discount_pct", "The sibling discount") ?? 0,
      fee_per_family_cap_cents: cap.cents,
      late_registration_closes_at: dateTime(fd, "late_registration_closes_at", "The end of the late window", tz),
      late_fee_cents: lateFee.cents ?? 0,
      withdrawal_credit_until: isoDate(fd, "withdrawal_credit_until", "The withdrawal deadline"),
      age_cutoff_on: isoDate(fd, "age_cutoff_on", "The age cut-off date"),
    };
    // The fund is the treasurer's (0590: fund_id needs giving.manage), sent only when it changes.
    if (fd.has("fund_id")) {
      const fund = str(fd, "fund_id");
      if (fund !== rules.fund_id) {
        if (!editing.canChooseFund) throw new FormError("Choosing the fund for Pathshala fees needs giving.manage (the treasurer).");
        input.fund_id = fund;
      }
    }
    const problem = rulesProblem(input, term, tz);
    if (problem) throw new FormError(problem);
    const reason = reasonFor(fd, editing.needsReason, "fee rules");
    const res = await setTermRules(supabase, termId, input, reason);
    if (!res.ok) return refusal("save the rules", res);
    refresh();
    return ok(`Rules saved for ${term.name}.${editing.locked ? " The change applies to new registrations only." : ""}`);
  });
}

/**
 * Open registration: the database checks every offered level's fee (and pay-now readiness), links the fees to the
 * Pathshala fund and campaign, locks fees and rules, and moves a draft to "Registration open". A term that left Draft
 * before 0590 keeps its status and is locked.
 */
export async function openRegistrationAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.openRegistration", "open registration", async () => {
    const { supabase, term, editing } = await termForChange(termId);
    if (!editing.canOpen) {
      throw new FormError(
        editing.locked ? "Registration has already opened for this term." : editing.closed ? "The term is closed, so registration cannot open." : "Only the Pathshala principal (pathshala.manage) can open registration.",
      );
    }
    const res = await openRegistration(supabase, termId, str(fd, "reason"));
    if (!res.ok) return refusal("open registration", res);
    refresh();
    if (res.value.already_open) return ok(`Registration was already open for ${term.name}; its fees and rules are locked.`);
    const warned = res.value.warnings.length ? ` Note: ${res.value.warnings.join(" ")}` : "";
    return ok(`Registration is open for ${term.name}. Its fees and rules are locked: from now on only the treasurer can change them, with a reason.${warned}`);
  });
}

/**
 * "Try a family": what made-up learners would pay with this term's fees and rules (app.pathshala_fee_example, 0590:
 * [{name, age, level_id}]). Writes nothing. Each filled row is one learner in one level; a blank row is skipped. The
 * answer's lines carry the names sent, matched by their `index`.
 */
export async function tryFamilyAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<Quote>> {
  return runAction<Quote>("pathshala.tryFamily", "work out the fees", async () => {
    const { supabase } = await actionContext(areas.fees, "Trying a family on the Fees screen needs pathshala.view.");
    const text = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");
    const names = fd.getAll("name");
    const ages = fd.getAll("age");
    const levels = fd.getAll("level_id");
    const lines: ExampleLineInput[] = [];
    for (let i = 0; i < Math.max(names.length, ages.length, levels.length); i++) {
      const name = text(names[i]);
      const age = text(ages[i]);
      const level = text(levels[i]);
      if (!name && !age && !level) continue;
      const who = name || `Learner ${i + 1}`;
      if (!level) throw new FormError(`Choose a level for ${who}.`);
      const parsedAge = parseAgeInput(age, "minimum");
      if (!parsedAge.ok || parsedAge.age === null) throw new FormError(`Give ${who}'s age on the term's cut-off date: a whole number of years from 0 to 120.`);
      lines.push({ name: who, age: parsedAge.age, level_id: level });
    }
    if (!lines.length) throw new FormError("Add at least one learner: a first name, an age and a level.");
    if (lines.length > EXAMPLE_MAX_LINES) throw new FormError(`Try at most ${EXAMPLE_MAX_LINES} learners at a time.`);
    const res = await feeExample(supabase, termId, lines, bool(fd, "late"));
    if (!res.ok) return refusal("work out the fees for this family", res);
    const quote = res.value;
    return ok(undefined, { ...quote, lines: quote.lines.map((l, i) => ({ ...l, first_name: l.first_name ?? lines[(l.index ?? i + 1) - 1]?.name ?? null })) });
  });
}
