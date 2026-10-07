// A term's registration rules on Pathshala › Terms › Fees and rules (plan §2.6, §2.7, P9, P15–P21): how families pay,
// the hold windows, the seat rule, the late window, who may change what and when, and the sentences that say so.
// The database decides (app.set_pathshala_term_rules, app.open_pathshala_registration, app.pathshala_pay_now_ready);
// this file mirrors its rules and words so a form can explain before it asks. Pure.

import { formatDateTime } from "@/lib/pathshala/format";
import { can, type PermissionContext } from "@/lib/permissions";

import { HOLD_HOURS, OFFICE_HOLD_DAYS, type PaymentMode, type SeatRule, type TermRulesInput } from "./contract";

// ---------------------------------------------------------------------------
// How families pay (P15) and who gets a seat (P12)
// ---------------------------------------------------------------------------
export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  pledge: "Register now, pay later",
  pay_now: "Pay when registering",
};

/** What the mode means for a family, in one or two sentences (the Fees screen and the app say the same, §3.1 step 0). */
export function paymentModeSentence(mode: PaymentMode, r: { hold_hours: number; office_payment_allowed: boolean; office_hold_days: number }): string {
  if (mode === "pledge") {
    return "Registering adds the fee to the family's pledges, one per learner. They pay any time before it is due: the first class day, or 14 days after the seat is given, whichever is later.";
  }
  const office = r.office_payment_allowed ? `, or ${r.office_hold_days} day${r.office_hold_days === 1 ? "" : "s"} when they choose to pay at the office` : "";
  return `Families pay online while registering (card, PayPal, Apple Pay or Google Pay). Seats are held ${r.hold_hours} hour${r.hold_hours === 1 ? "" : "s"} while they pay${office}; a seat not paid for in time is released.`;
}

export const SEAT_RULE_LABEL: Record<SeatRule, string> = {
  automatic: "A seat at registration",
  office: "The office places every learner",
};

export const SEAT_RULE_HINT: Record<SeatRule, string> = {
  automatic: "When the chosen level has room, the learner gets the seat at once; otherwise they join the level's waitlist (when a class keeps one).",
  office: "Every registration waits for the office to place it, as before. Only with “Register now, pay later”.",
};

/**
 * Why “Pay when registering” cannot be chosen, or null when it can (P20). Giving switched off is known here; the
 * other two conditions (an online payment method connected, fee receipts ready — P13) are the database's answer.
 */
export function payNowBlockedReason(input: {
  givingOn: boolean;
  ready: { status: "ok"; sentence: string | null } | { status: "missing" } | { status: "error"; reason: string };
}): string | null {
  if (!input.givingOn) return "Pay when registering needs Pledges & donations (Giving) switched on.";
  if (input.ready.status === "ok") return input.ready.sentence;
  if (input.ready.status === "missing") return "Pay when registering needs the database update that is on its way.";
  return `Whether families can pay when registering could not be checked — ${input.ready.reason}${/[.!?]$/.test(input.ready.reason) ? "" : "."}`;
}

// ---------------------------------------------------------------------------
// Checks before saving (the database makes them again)
// ---------------------------------------------------------------------------
export function rulesProblem(r: TermRulesInput, term: { registration_closes_at: string | null }, tz: string): string | null {
  if (!Number.isInteger(r.hold_hours) || r.hold_hours < HOLD_HOURS.min || r.hold_hours > HOLD_HOURS.max) {
    return `A seat is held for payment ${HOLD_HOURS.min} to ${HOLD_HOURS.max} hours.`;
  }
  if (!Number.isInteger(r.office_hold_days) || r.office_hold_days < OFFICE_HOLD_DAYS.min || r.office_hold_days > OFFICE_HOLD_DAYS.max) {
    return `A seat is held for payment at the office ${OFFICE_HOLD_DAYS.min} to ${OFFICE_HOLD_DAYS.max} days.`;
  }
  if (r.seat_rule === "office" && r.payment_mode === "pay_now") {
    return "“The office places every learner” works only with “Register now, pay later”: a family paying while registering needs the seat decided at once.";
  }
  if (!Number.isInteger(r.sibling_discount_pct) || r.sibling_discount_pct < 0 || r.sibling_discount_pct > 100) {
    return "The sibling discount is a whole percent from 0 to 100.";
  }
  if (r.fee_per_family_cap_cents !== null && r.fee_per_family_cap_cents < 0) return "The family cap cannot be below $0.";
  if (r.late_fee_cents < 0) return "The late fee cannot be below $0.";
  if (r.late_registration_closes_at) {
    if (!term.registration_closes_at) return "Set when registration closes (on the term's form) before adding a late registration window.";
    if (new Date(r.late_registration_closes_at).getTime() <= new Date(term.registration_closes_at).getTime()) {
      return `Late registration must end after registration closes (${formatDateTime(term.registration_closes_at, tz)}).`;
    }
  } else if (r.late_fee_cents > 0) {
    return "A late fee applies only in a late registration window: set “Late registration until”, or make the late fee 0.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who may change fees and rules, and when (P9, P16)
// ---------------------------------------------------------------------------
export type FeeEditing = {
  /** Registration has opened (or the term was opened before 0590): fees and rules are locked. */
  open: boolean;
  /** This person may change the fees and the rules now. */
  canEdit: boolean;
  /** A change needs a reason (after the lock). */
  needsReason: boolean;
  /** This person may open registration (a draft term, pathshala.manage). */
  canOpen: boolean;
  /** One sentence for the screen: who changes what, now. */
  note: string;
};

/**
 * The principal (pathshala.manage) sets fees and rules while the term is a draft; opening registration locks them;
 * after that only the treasurer (giving.manage) changes them, with a reason, for new registrations only. A term
 * that left Draft before 0590 counts as open. Convenience only: the database enforces it.
 */
export function feeEditing(ctx: PermissionContext, term: { status: string; fees_locked_at: string | null }): FeeEditing {
  const open = term.status !== "draft" || term.fees_locked_at !== null;
  const principal = can(ctx, "pathshala.manage");
  if (!open) {
    return {
      open,
      canEdit: principal,
      needsReason: false,
      canOpen: principal,
      note: principal
        ? "While the term is a draft you set its fees and rules. Opening registration locks them; after that only the treasurer can change them, with a reason."
        : "While the term is a draft the Pathshala principal (pathshala.manage) sets its fees and rules.",
    };
  }
  const treasurer = can(ctx, "giving.manage");
  return {
    open,
    canEdit: treasurer,
    needsReason: true,
    canOpen: false,
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
 * What the term does with fees, for the Classes page's sub-line (F18: no promise the code does not keep). Null when
 * the rules could not be read: the sub-line then says nothing about billing.
 */
export function termBillingPhrase(input: { mode: PaymentMode | null; givingOn: boolean }): string | null {
  if (input.mode === null) return null;
  if (!input.givingOn) return "fees per level, not billed while Pledges & donations is off";
  return input.mode === "pay_now" ? "fees per level, paid online when registering" : "fees per level, added to the family's pledges when a seat is given";
}
