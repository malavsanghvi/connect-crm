// Edit and delete a pledge, in place (owner request 2026-10-13; migration 0782; NEEDS OWNER OK). Pure: the Edit sheet, the server
// actions and the tests use the same checks and sentences. The database decides everything again (app.edit_pledge, app.delete_pledge)
// and says what is locked and why (app._pledge_locks), so the screen never guesses a rule of its own.
//
// Who: giving.manage, the same people who record a pledge by hand. A pledge is a promise, not money, so there is no second person; the
// amount can never go below what is already paid (a full write-off of what is open stays the two-person flow). "Delete" cancels the
// pledge: it leaves the owed totals, stays in the family's History with the reason, and nothing is erased.
//
// Never in one place only: a pledge that is in QuickBooks, or belongs to another screen (an event registration, a membership, a class
// fee…), keeps its amount, what it is for and its life until that other place changes first. The sheet shows the database's sentence.

import { daysBetween } from "@/lib/dates";
import { DUE_WITHIN_DAYS, isRealDate } from "@/lib/giving-due";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { DEDICATION_MAX, REASON_MAX, REASON_MIN, parseDesignation } from "./record-pledge";

export const RECOGNITION_MAX = 120;

/** What may change on this pledge: null = allowed, otherwise the database's sentence for why not. */
export type PledgeLocks = {
  details: string | null;
  due: string | null;
  amount: string | null;
  for: string | null;
  delete: string | null;
  /** Where the pledge touches QuickBooks, as the database words it ("QuickBooks Invoice #1043"); null when it does not. */
  qbo: string | null;
};

/** The pledge as the Edit sheet shows it (app.pledge_edit_state). */
export type PledgeEditState = {
  pledgeId: string;
  pledgeNumber: string | null;
  householdId: string;
  status: string;
  source: string;
  amountCents: number;
  paidCents: number;
  dueOn: string | null;
  /** The day it was pledged, in the community's time zone (YYYY-MM-DD). */
  pledgedOn: string;
  campaignId: string | null;
  fundId: string | null;
  opportunityId: string | null;
  dedication: string | null;
  recognitionName: string | null;
  anonymous: boolean;
  pledgedByPersonId: string | null;
  locks: PledgeLocks;
};

/** Only the keys that change. A key with null clears it (where that is allowed). */
export type PledgeEditChanges = {
  amount_cents?: number;
  due_on?: string;
  campaign_id?: string | null;
  fund_id?: string | null;
  dedication?: string | null;
  recognition_name?: string | null;
  anonymous?: boolean;
  pledged_by_person_id?: string | null;
};

export type EditPledgeInput = { pledgeId: string; changes: PledgeEditChanges; reason: string };
export type DeletePledgeInput = { pledgeId: string; reason: string };

export type EditedPledge = {
  pledgeId: string;
  pledgeNumber: string | null;
  householdId: string;
  changed: boolean;
  /** In words: "amount", "due date", "what it is for"… */
  fields: string[];
  amountCents: number;
  wasAmountCents: number;
  dueOn: string | null;
  status: string;
};

export type DeletedPledge = { pledgeId: string; pledgeNumber: string | null; householdId: string; amountCents: number };

/** What the sheet fields hold (strings, as typed). */
export type PledgeEditForm = {
  amount: string;
  dueOn: string;
  /** "fund:<id>", "campaign:<id>" or "" (general). */
  designation: string;
  dedication: string;
  recognitionName: string;
  anonymous: boolean;
  /** An adult's id, or "" for the household. */
  pledgedBy: string;
};

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One tap fills the reason; anything else can be typed. */
export const EDIT_REASONS = ["Family asked to change it", "Corrected a mistake", "Agreed with the family", "Entered wrongly"] as const;
export const DELETE_REASONS = ["Recorded twice by mistake", "Entered for the wrong family", "Family withdrew the pledge"] as const;

export const EDIT_REASON_PROMPT = 'Say why the pledge changes (for example "Family asked to change it"). It shows in the family\'s History.';
export const DELETE_REASON_PROMPT = 'Say why the pledge is deleted (for example "Recorded twice by mistake"). It shows in the family\'s History.';

/** The sentence under the Delete step (section 5: say what cannot be undone, and how a mistake is fixed). */
export const DELETE_WHAT =
  "The pledge is deleted: it stops counting as owed and moves to Closed as Cancelled. It stays in the family's History with your reason. No money moves. It cannot be brought back here: if this was a mistake, record the pledge again.";

/** "500.00" for the amount field. */
export function amountText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The designation value ("fund:<id>", "campaign:<id>" or "") a pledge has now. A campaign carries its fund with it. */
export function designationOf(s: Pick<PledgeEditState, "campaignId" | "fundId">): string {
  return s.campaignId ? `campaign:${s.campaignId}` : s.fundId ? `fund:${s.fundId}` : "";
}

export function formFromState(s: PledgeEditState): PledgeEditForm {
  return {
    amount: amountText(s.amountCents),
    dueOn: s.dueOn ?? "",
    designation: designationOf(s),
    dedication: s.dedication ?? "",
    recognitionName: s.recognitionName ?? "",
    anonymous: s.anonymous,
    pledgedBy: s.pledgedByPersonId ?? "",
  };
}

/**
 * What the person changed, as the keys app.edit_pledge reads, and the words for the button. A field the database locked is not
 * looked at (the sheet shows it as text). `today` is the community's day; `money` words an amount for a sentence.
 */
export function diffPledgeEdit(s: PledgeEditState, f: PledgeEditForm, today: string, money: (cents: number) => string): Checked<{ changes: PledgeEditChanges; fields: string[] }> {
  const bad = (error: string): Checked<{ changes: PledgeEditChanges; fields: string[] }> => ({ ok: false, error });
  const changes: PledgeEditChanges = {};
  const fields: string[] = [];

  if (!s.locks.amount) {
    const cents = parseAmountToCents(f.amount);
    if (cents === null || cents <= 0) return bad("Enter the pledge amount, like 500.00.");
    if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) return bad("That amount is too large. Check it and try again.");
    if (cents !== s.amountCents) {
      if (cents < s.paidCents) return bad(`The amount cannot be less than ${money(s.paidCents)}, which is already paid. To close the pledge early, write off what is still open.`);
      changes.amount_cents = cents;
      fields.push("amount");
    }
  }

  if (!s.locks.due) {
    const due = f.dueOn.trim();
    if (due !== (s.dueOn ?? "")) {
      if (!due) return bad("Choose the due date.");
      if (!isRealDate(due)) return bad("Enter the due date as a date, like 2026-12-31.");
      if (Math.abs(daysBetween(today, due)) > DUE_WITHIN_DAYS) return bad("The due date must be within ten years of today.");
      if (due < s.pledgedOn) return bad("The due date cannot be before the day it was pledged.");
      changes.due_on = due;
      fields.push("due date");
    }
  }

  if (!s.locks.for && !s.opportunityId) {
    const d = parseDesignation(f.designation);
    if (!d || d.opportunityId) return bad("Choose what the pledge is for again: that choice was not understood.");
    const changed = d.campaignId ? d.campaignId !== s.campaignId : d.fundId ? s.campaignId !== null || d.fundId !== s.fundId : s.campaignId !== null || s.fundId !== null;
    if (changed) {
      changes.campaign_id = d.campaignId;
      changes.fund_id = d.fundId;
      fields.push("what it is for");
    }
  }

  if (!s.locks.details) {
    const ded = f.dedication.trim();
    if (ded.length > DEDICATION_MAX) return bad(`Keep the dedication to ${DEDICATION_MAX} characters or fewer.`);
    if (ded !== (s.dedication ?? "")) {
      changes.dedication = ded || null;
      fields.push("dedication");
    }
    const rec = f.recognitionName.trim();
    if (rec.length > RECOGNITION_MAX) return bad(`Keep the recognition name to ${RECOGNITION_MAX} characters or fewer.`);
    if (rec !== (s.recognitionName ?? "")) {
      changes.recognition_name = rec || null;
      fields.push("recognition name");
    }
    if (f.anonymous !== s.anonymous) {
      changes.anonymous = f.anonymous;
      fields.push("anonymous");
    }
    const by = f.pledgedBy.trim();
    if (by && !UUID.test(by)) return bad("Choose the adult who pledged again: that choice was not understood.");
    if (by.toLowerCase() !== (s.pledgedByPersonId ?? "").toLowerCase()) {
      changes.pledged_by_person_id = by ? by.toLowerCase() : null;
      fields.push("who pledged");
    }
  }
  return { ok: true, value: { changes, fields } };
}

const CHANGE_KEYS = ["amount_cents", "due_on", "campaign_id", "fund_id", "dedication", "recognition_name", "anonymous", "pledged_by_person_id"] as const;

/** The server's own look at what arrived (the database checks it all again). */
export function checkEditChanges(raw: unknown): Checked<PledgeEditChanges> {
  const bad = (error: string): Checked<PledgeEditChanges> => ({ ok: false, error });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("Change at least one thing, or close the sheet.");
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length === 0) return bad("Change at least one thing, or close the sheet.");
  for (const k of keys) if (!(CHANGE_KEYS as readonly string[]).includes(k)) return bad("Something on the sheet was not understood. Close it and open it again.");
  const out: PledgeEditChanges = {};
  if ("amount_cents" in o) {
    const v = o.amount_cents;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) return bad("Enter the pledge amount, like 500.00.");
    out.amount_cents = v;
  }
  if ("due_on" in o) {
    const v = o.due_on;
    if (typeof v !== "string" || !isRealDate(v)) return bad("Enter the due date as a date, like 2026-12-31.");
    out.due_on = v;
  }
  for (const k of ["campaign_id", "fund_id", "pledged_by_person_id"] as const) {
    if (k in o) {
      const v = o[k];
      if (v !== null && (typeof v !== "string" || !UUID.test(v))) return bad("A choice on the sheet was not understood. Close it and open it again.");
      out[k] = v === null ? null : (v as string).toLowerCase();
    }
  }
  if ("dedication" in o) {
    const v = o.dedication;
    if (v !== null && typeof v !== "string") return bad("The dedication was not understood.");
    if (typeof v === "string" && v.trim().length > DEDICATION_MAX) return bad(`Keep the dedication to ${DEDICATION_MAX} characters or fewer.`);
    out.dedication = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  if ("recognition_name" in o) {
    const v = o.recognition_name;
    if (v !== null && typeof v !== "string") return bad("The recognition name was not understood.");
    if (typeof v === "string" && v.trim().length > RECOGNITION_MAX) return bad(`Keep the recognition name to ${RECOGNITION_MAX} characters or fewer.`);
    out.recognition_name = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  if ("anonymous" in o) {
    if (typeof o.anonymous !== "boolean") return bad("Anonymous is yes or no.");
    out.anonymous = o.anonymous;
  }
  return { ok: true, value: out };
}

export function checkEditReason(raw: unknown, prompt: string = EDIT_REASON_PROMPT): Checked<string> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < REASON_MIN) return { ok: false, error: prompt };
  if (reason.length > REASON_MAX) return { ok: false, error: `Keep the reason to ${REASON_MAX} characters or fewer.` };
  return { ok: true, value: reason };
}

export function checkPledgeId(raw: unknown): Checked<string> {
  const v = typeof raw === "string" ? raw.trim() : "";
  return UUID.test(v) ? { ok: true, value: v.toLowerCase() } : { ok: false, error: "Open the pledge again: it was not found." };
}

/** "Save: amount and due date" on the button. */
export function editButtonLabel(ref: string | null, fields: readonly string[]): string {
  if (fields.length === 0) return "Change something to save";
  const list = fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
  return `Save ${list}${ref ? ` on ${ref}` : ""}`;
}

/** What happens, said before the click. */
export function editWhatHappens(ref: string | null): string {
  return `Changes ${ref ?? "the pledge"} for this family. No money moves. The change and your reason show in the family's History, with what it was before.`;
}

/** After saving. */
export function editedMessage(r: Pick<EditedPledge, "pledgeNumber" | "changed" | "fields">): string {
  const ref = r.pledgeNumber ?? "The pledge";
  if (!r.changed) return `${ref} already had these details. Nothing changed.`;
  return `${ref} updated: ${r.fields.join(", ")}.`;
}

export function deletedMessage(r: Pick<DeletedPledge, "pledgeNumber">): string {
  return `${r.pledgeNumber ?? "The pledge"} is deleted. It stays in the family's History as Cancelled.`;
}

/** The button of the Delete step names the pledge and its amount. */
export function deleteButtonLabel(ref: string | null, cents: number, currency: string, locale?: string): string {
  return `Delete ${ref ?? "the pledge"} (${formatCents(cents, currency, locale)})`;
}
