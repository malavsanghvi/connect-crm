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
// the 0590 functions, which check who may (P9, P16: the principal while a draft; the treasurer, with a reason, after
// registration opens) and every rule; these actions check first so the form can explain before it asks.

/** Most learners "Try a family" works out at once. */
const EXAMPLE_MAX_LINES = 12;

/** The term, its 0590 rules and who may change them now (re-checked here: actions are reachable by direct POST). */
async function termForChange(termId: string) {
  const ctx = await actionContext(areas.fees, "You don't have access to Pathshala fees.");
  const term = must(
    await ctx.supabase.from("pathshala_terms").select("id, name, status, registration_closes_at").eq("id", termId).maybeSingle(),
    "find the term",
  );
  if (!term) throw new FormError("That term no longer exists. Reload the page.");
  const rules = await loadTermRules(ctx.supabase, [termId]);
  if (rules.status === "missing") throw new FormError(NEEDS_UPDATE);
  if (rules.status === "error") throw new DbFailure(rules.error, "read the term's rules");
  if (rules.status === "shape") throw new FormError(`The term's rules could not be read (${rules.message}). Has the latest migration been applied?`);
  const current = rules.value.get(termId);
  if (!current) throw new FormError("That term's rules could not be found. Reload the page.");
  return { ...ctx, term, rules: current, editing: feeEditing(ctx.viewer, { status: term.status, fees_locked_at: current.fees_locked_at }) };
}

/** After the lock a change needs a reason (P9); before it, the reason is optional and a plain one is recorded. */
function reasonFor(fd: FormData, needsReason: boolean, what: string, fallback: string): string {
  const reason = str(fd, "reason");
  if (needsReason && !reason) throw new FormError(`Say why the ${what} change: registration is open, so a change needs a reason.`);
  return reason ?? fallback;
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
    const reason = reasonFor(fd, editing.needsReason, "fees", `Set ${changes.length === 1 ? "a level fee" : `${changes.length} level fees`} for ${term.name}`);
    const res = await setLevelFees(supabase, termId, changes, reason);
    if (!res.ok) return refusal("save the fees", res);
    refresh();
    const what = changes.length === 1 ? `The fee for ${names.get(changes[0].level_id)} is saved` : `${changes.length} fees are saved`;
    return ok(`${what} for ${term.name}.${editing.open ? " The change applies to new registrations only." : ""}`);
  });
}

/** Save the term's registration rules: how families pay, holds, seats, discount, cap, late window, deadlines. */
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
      hold_hours: int(fd, "hold_hours", "The hold window (hours)") ?? rules.hold_hours,
      office_payment_allowed: bool(fd, "office_payment_allowed"),
      office_hold_days: int(fd, "office_hold_days", "The office window (days)") ?? rules.office_hold_days,
      seat_rule: oneOf(fd, "seat_rule", SEAT_RULES, "Seat rule", rules.seat_rule),
      sibling_discount_pct: int(fd, "sibling_discount_pct", "The sibling discount") ?? 0,
      fee_per_family_cap_cents: cap.cents,
      late_registration_closes_at: dateTime(fd, "late_registration_closes_at", "Late registration until", tz),
      late_fee_cents: lateFee.cents ?? 0,
      withdrawal_credit_until: isoDate(fd, "withdrawal_credit_until", "The withdrawal deadline"),
      age_cutoff_on: isoDate(fd, "age_cutoff_on", "The age cut-off date"),
    };
    // The fund is sent only when someone picks another one (most communities have a Pathshala fund found by its key).
    if (fd.has("fund_id")) {
      const fund = str(fd, "fund_id");
      if (fund !== rules.fund_id) input.fund_id = fund;
    }
    const problem = rulesProblem(input, term, tz);
    if (problem) throw new FormError(problem);
    const reason = reasonFor(fd, editing.needsReason, "rules", `Set the registration rules for ${term.name}`);
    const res = await setTermRules(supabase, termId, input, reason);
    if (!res.ok) return refusal("save the rules", res);
    refresh();
    return ok(`Rules saved for ${term.name}.${editing.open ? " The change applies to new registrations only." : ""}`);
  });
}

/** Open registration: the database checks every offered level's fee (and pay-now readiness), locks fees and rules, opens. */
export async function openRegistrationAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.openRegistration", "open registration", async () => {
    const { supabase, term, editing } = await termForChange(termId);
    if (!editing.canOpen) {
      throw new FormError(editing.open ? "Registration has already opened for this term." : "Only the Pathshala principal (pathshala.manage) can open registration.");
    }
    const res = await openRegistration(supabase, termId, str(fd, "reason") ?? `Opened registration for ${term.name}`);
    if (!res.ok) return refusal("open registration", res);
    refresh();
    return ok(`Registration is open for ${term.name}. Its fees and rules are locked: from now on only the treasurer can change them, with a reason.`);
  });
}

/**
 * "Try a family": what made-up learners would pay with this term's fees and rules (app.pathshala_fee_example). Writes
 * nothing. Each filled row is one learner in one level; a blank row is skipped.
 */
export async function tryFamilyAction(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<Quote>> {
  return runAction<Quote>("pathshala.tryFamily", "work out the fees", async () => {
    const { supabase } = await actionContext(areas.admin, "Only Pathshala staff can try a family.");
    const text = (v: FormDataEntryValue | undefined) => (typeof v === "string" ? v.trim() : "");
    const names = fd.getAll("first_name");
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
      if (!parsedAge.ok || parsedAge.age === null) throw new FormError(`Give ${who}'s age on the term's cut-off date, in whole years from 0 to 120.`);
      lines.push({ first_name: who, age_on_cutoff: parsedAge.age, level_id: level });
    }
    if (!lines.length) throw new FormError("Add at least one learner: a first name, an age and a level.");
    if (lines.length > EXAMPLE_MAX_LINES) throw new FormError(`Try at most ${EXAMPLE_MAX_LINES} learners at a time.`);
    const res = await feeExample(supabase, termId, lines);
    if (!res.ok) return refusal("work out the fees for this family", res);
    return ok(undefined, res.value);
  });
}
