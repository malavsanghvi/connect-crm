// A term's registration rules on Pathshala › Terms › Fees and rules (plan §2.6, §2.7, P9, P15–P21): how families pay,
// the hold windows, the seat rule, the late window, who may change what and when, and the sentences that say so.
// The database decides (app.set_pathshala_term_rules, app.open_pathshala_registration, app.pathshala_pay_now_ready,
// 0590); this file mirrors its rules and words so a form can explain before it asks. Pure.

import { addDays, formatDateTime } from "@/lib/pathshala/format";
import { can, type PermissionContext } from "@/lib/permissions";

import { HOLD_HOURS, MAX_FEE_CENTS, MIN_FEE_CENTS, OFFICE_HOLD_DAYS, type PaymentMode, type SeatRule, type TermRulesInput } from "./contract";

// ---------------------------------------------------------------------------
// How families pay (P15) and who gets a seat (P12)
// ---------------------------------------------------------------------------
/** The task's words, with the database's short name in brackets (0590's refusals say "Pledge" and "Pay now"). */
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  pledge: "Register now, pay later (pledge)",
  pay_now: "Pay when registering (pay now)",
};

/** What the mode means for a family, in one or two sentences (the Fees screen and the app say the same, §3.1 step 0). */
export function paymentModeSentence(mode: PaymentMode, r: { hold_hours: number; office_payment_allowed: boolean; office_hold_days: number }): string {
  if (mode === "pledge") {
    return "Registering adds the fee to the family's pledges, one per learner. They pay any time before it is due: the first class day, or 14 days after the seat is given, whichever is later.";
  }
  const office = r.office_payment_allowed ? `, or ${r.office_hold_days} day${r.office_hold_days === 1 ? "" : "s"} when they choose to pay at the office` : "";
  return `Families pay online while registering (card, PayPal, Apple Pay or Google Pay). Seats are held ${r.hold_hours} hour${r.hold_hours === 1 ? "" : "s"} while they pay${office}; a seat not paid for in time is released.`;
}

/**
 * The fund of the fee pledges in words (the rules form's read-only line and the Fees page's summary): its name; before
 * the lock "Found when registration opens (the Pathshala fund)"; after it "No fund chosen" — 0590 looks for the
 * Pathshala fund only when registration opens, and once it has opened the fund can be changed, never cleared.
 */
export function fundText(fundId: string | null, funds: readonly { id: string; name: string }[] | null, locked: boolean): string {
  if (fundId) return funds?.find((f) => f.id === fundId)?.name ?? "A fund chosen by the treasurer";
  return locked ? "No fund chosen" : "Found when registration opens (the Pathshala fund)";
}

export const SEAT_RULE_LABEL: Record<SeatRule, string> = {
  automatic: "A seat at registration",
  office: "The office places every learner",
};

export const SEAT_RULE_HINT: Record<SeatRule, string> = {
  automatic: "When the chosen level has room, the learner gets the seat at once; otherwise they join the level's waitlist (when a class keeps one).",
  office: "Every registration waits for the office to place it, as before. Only with “Register now, pay later”.",
};

/** 0590's sentence when Giving is off (app._pathshala_pay_now_problem). */
const PAY_NOW_NEEDS_GIVING = "Pay at registration needs Pledges & donations switched on (Settings › Modules).";

/**
 * Why “Pay when registering” cannot be chosen, or null when it can (P20). The database's answer comes first (it checks
 * Giving, a card or PayPal method taking payments, and fee receipts, P13); without it, Giving switched off is known here.
 */
export function payNowBlockedReason(input: {
  givingOn: boolean;
  ready: { status: "ok"; sentence: string | null } | { status: "missing" } | { status: "error"; reason: string };
}): string | null {
  if (input.ready.status === "ok") return input.ready.sentence ?? (input.givingOn ? null : PAY_NOW_NEEDS_GIVING);
  if (!input.givingOn) return PAY_NOW_NEEDS_GIVING;
  if (input.ready.status === "missing") return "Pay when registering needs the database update that is on its way.";
  return `Whether families can pay when registering could not be checked — ${input.ready.reason}${/[.!?]$/.test(input.ready.reason) ? "" : "."}`;
}

// ---------------------------------------------------------------------------
// Checks before saving, in app.set_pathshala_term_rules' words (the database makes them again)
// ---------------------------------------------------------------------------
/** "May 30, 2027", as 0590 writes a date in its sentences. */
function shortDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? isoDate : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

export function rulesProblem(
  r: TermRulesInput,
  term: { registration_closes_at: string | null; starts_on: string; ends_on: string },
  tz: string,
): string | null {
  if (r.seat_rule === "office" && r.payment_mode !== "pledge") {
    return "The office step works only with Pledge: in a pay-now term the seat is decided when the family registers.";
  }
  if (!Number.isInteger(r.hold_hours) || r.hold_hours < HOLD_HOURS.min || r.hold_hours > HOLD_HOURS.max) {
    return `A seat is held for ${HOLD_HOURS.min} to ${HOLD_HOURS.max} hours (7 days) while the family pays.`;
  }
  if (!Number.isInteger(r.office_hold_days) || r.office_hold_days < OFFICE_HOLD_DAYS.min || r.office_hold_days > OFFICE_HOLD_DAYS.max) {
    return `A seat waiting for payment at the office is held ${OFFICE_HOLD_DAYS.min} to ${OFFICE_HOLD_DAYS.max} days.`;
  }
  if (!Number.isInteger(r.sibling_discount_pct) || r.sibling_discount_pct < 0 || r.sibling_discount_pct > 100) {
    return "The sibling discount is 0 to 100 percent.";
  }
  if (r.fee_per_family_cap_cents !== null && (r.fee_per_family_cap_cents < MIN_FEE_CENTS || r.fee_per_family_cap_cents > MAX_FEE_CENTS)) {
    return "A family cap is at least $0.50 (at most $1,000,000); leave it empty for no cap.";
  }
  if (r.late_fee_cents < 0 || (r.late_fee_cents > 0 && r.late_fee_cents < MIN_FEE_CENTS) || r.late_fee_cents > MAX_FEE_CENTS) {
    return "A late fee is $0 or at least $0.50.";
  }
  if (r.late_registration_closes_at) {
    if (!term.registration_closes_at) return "Set when registration closes (on the term) before adding a late window.";
    if (new Date(r.late_registration_closes_at).getTime() <= new Date(term.registration_closes_at).getTime()) {
      return `The late window must end after registration closes (${formatDateTime(term.registration_closes_at, tz)}).`;
    }
  }
  if (r.withdrawal_credit_until && (r.withdrawal_credit_until < addDays(term.starts_on, -90) || r.withdrawal_credit_until > term.ends_on)) {
    return `The withdrawal deadline must fall before the term ends (${shortDate(term.ends_on)}).`;
  }
  if (r.age_cutoff_on && (r.age_cutoff_on < addDays(term.starts_on, -366) || r.age_cutoff_on > term.ends_on)) {
    return "The age cut-off date must be within a year before the term starts, or during the term.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who may change fees and rules, and when (P9, P16; app._pathshala_assert_fee_editor, 0590)
// ---------------------------------------------------------------------------
export type FeeEditing = {
  /** Registration has opened with fees: fees and rules are locked (app.open_pathshala_registration set fees_locked_at). */
  locked: boolean;
  /** A closed term's fees and rules never change. */
  closed: boolean;
  /** This person may change the fees and the rules now. */
  canEdit: boolean;
  /** A change needs a reason (after the lock). */
  needsReason: boolean;
  /** This person may open registration (pathshala.manage, before the lock). */
  canOpen: boolean;
  /** This person may choose the fund of the fee pledges (giving.manage). */
  canChooseFund: boolean;
  /** One sentence for the screen: who changes what, now. */
  note: string;
};

/**
 * Before the lock the principal (pathshala.manage) — or the treasurer (giving.manage) — sets fees and rules; opening
 * registration locks them; after that only the treasurer changes them, with a reason, for new registrations only. A
 * closed term changes no more. A term that left Draft before 0590 is not locked: families cannot register with fees
 * until it is (its registration window stays "not yet"). Convenience only: the database enforces it.
 */
export function feeEditing(ctx: PermissionContext, term: { status: string; fees_locked_at: string | null }): FeeEditing {
  const locked = term.fees_locked_at !== null;
  const closed = term.status === "closed";
  const principal = can(ctx, "pathshala.manage");
  const treasurer = can(ctx, "giving.manage");
  if (closed) {
    return { locked, closed, canEdit: false, needsReason: false, canOpen: false, canChooseFund: false, note: "The term is closed, so its fees and rules cannot change." };
  }
  if (!locked) {
    const canEdit = principal || treasurer;
    const legacy = term.status !== "draft";
    return {
      locked,
      closed,
      canEdit,
      needsReason: false,
      canOpen: principal,
      canChooseFund: treasurer,
      note: legacy
        ? "This term left Draft before fees per level existed, so families cannot register with fees until its fees are set and locked here with Open registration."
        : canEdit
          ? "Until registration opens you set this term's fees and rules. Opening registration locks them; after that only the treasurer can change them, with a reason."
          : "Until registration opens the Pathshala principal (pathshala.manage) sets this term's fees and rules.",
    };
  }
  return {
    locked,
    closed,
    canEdit: treasurer,
    needsReason: true,
    canOpen: false,
    canChooseFund: treasurer,
    note: treasurer
      ? "Registration is open, so fees and rules are locked. As treasurer you can still change them, with a reason; a change applies to new registrations only, never to fees already quoted or billed."
      : "Registration is open, so fees and rules are locked. Only the treasurer (giving.manage) can change them now, with a reason, for new registrations only.",
  };
}

// ---------------------------------------------------------------------------
// Words for the term (statuses, the classes page's sub-line)
// ---------------------------------------------------------------------------
export const TERM_STATUS_LABEL: Record<string, string> = {
  draft: "Draft (hidden from families)",
  registration: "Registration open",
  active: "Active (classes running)",
  closed: "Closed",
};

export function termStatusLabel(status: string): string {
  return TERM_STATUS_LABEL[status] ?? status;
}

/**
 * What the term does with fees, for the Classes page's sub-line (F18: no promise the code does not keep). It names the
 * payment mode and never says when a family is billed: the office's Place and "Enroll a student" still give seats
 * without a fee pledge until they go through Pathshala registration (Portal B), so "billed when a seat is given" would
 * be untrue for every seat the office gives. Null when the rules could not be read: the sub-line then says nothing
 * about fees.
 */
export function termBillingPhrase(input: { mode: PaymentMode | null; locked: boolean; givingOn: boolean }): string | null {
  if (input.mode === null) return null;
  if (!input.locked) return "fees per level, not yet locked for registration";
  if (!input.givingOn) return "fees per level, not billed while Pledges & donations is off";
  return input.mode === "pay_now" ? "fees per level · pay when registering" : "fees per level · register now, pay later";
}
