// Record a pledge, in place (docs/GIVING_REDESIGN.md slice 7; section 10 decision 3: anyone with giving.manage, no second approver
// because a pledge moves no money, shown in History with a reason, source "manual"). Pure: the sheet, the box's Giving lane, the
// giving.record_pledge command, the dev preview and the tests use the same checks and sentences. The database checks everything again
// (app.record_manual_pledge, migration 0745).
//
// Money is integer cents in the community's currency. A family is always named with its number ("the Patel household 0127"), never
// by a name alone. The person who pledged is an adult of the household; a child is never offered and never named.

import { addDays, daysBetween, isDateOnly } from "@/lib/dates";
import type { Family } from "@/lib/giving-today/queue";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { householdRef } from "./record-sheet";

/** What a pledge is for: a fund, a campaign (its fund comes with it) or an opportunity (its campaign comes with it). */
export type PledgeDesignation = { kind: "fund" | "campaign" | "opportunity"; id: string; name: string };

/** What the box (or a button) already knows. The person checks every field before pressing the button. */
export type RecordPledgeRequest = {
  household?: Family | null;
  householdId?: string | null;
  candidates?: Family[];
  prefill?: {
    /** Plain digits with a dot for the decimals ("500", "1250.50"). */
    amount?: string | null;
    designation?: PledgeDesignation | null;
  };
};

export type PledgeFundOption = { id: string; name: string };
export type PledgeCampaignOption = { id: string; name: string; fundName: string | null };
export type PledgeOpportunityOption = { id: string; name: string; campaignName: string; amountCents: number | null };
export type PledgeAdult = { id: string; name: string; isPrimary: boolean };

/** What the sheet offers: the community's funds, open campaigns and opportunities, and the household's adults. */
export type PledgeSheetOptions = {
  funds: PledgeFundOption[];
  campaigns: PledgeCampaignOption[];
  /** Empty when the Opportunities module is off. */
  opportunities: PledgeOpportunityOption[];
  /** The household's adults (never a child), primary first. Empty when no household was given. */
  adults: PledgeAdult[];
};

export const EMPTY_PLEDGE_OPTIONS: PledgeSheetOptions = { funds: [], campaigns: [], opportunities: [], adults: [] };

/** The input the sheet sends to the server. `designation` is "fund:<id>", "campaign:<id>", "opportunity:<id>" or "" (general). */
export type RecordPledgeInput = {
  /** Made once when the sheet opens: the same sheet pressed twice (or retried after a lost answer) records once. */
  requestId: string;
  householdId: string;
  amount: string;
  designation?: string | null;
  dueOn?: string | null;
  pledgedBy?: string | null;
  dedication?: string | null;
  reason: string;
};

export type CheckedPledge = {
  householdId: string;
  amountCents: number;
  fundId: string | null;
  campaignId: string | null;
  opportunityId: string | null;
  dueOn: string | null;
  pledgedBy: string | null;
  dedication: string | null;
  reason: string;
};

/** What the server answers once the pledge is recorded. */
export type RecordedPledge = { pledgeId: string; pledgeNumber: string | null; householdId: string; amountCents: number; replayed: boolean };

export const REASON_MIN = 3;
export const REASON_MAX = 500;
export const DEDICATION_MAX = 200;
/** A due date is within ten years of today (the database's own limit). */
export const DUE_WITHIN_DAYS = 3653;

/** Campaign kinds whose pledges come from their own flow (auctions, the store, class fees, memberships): never offered here (0745). */
export const OWN_FLOW_CAMPAIGN_KINDS = ["boli", "store", "pathshala", "membership"] as const;

/** One tap fills the reason; anything else can be typed. */
export const PLEDGE_REASONS = ["Pledged in person", "Pledged by phone", "Pledge card", "Pledged by email"] as const;

/** The sentence under every Record pledge sheet (section 5: say what cannot be undone, and how a mistake is fixed). */
export const PLEDGE_NO_UNDO = "No money moves. This cannot be undone here: a pledge recorded by mistake is written off, which a second person approves.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9:_-]{8,120}$/;

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** "fund:<id>" → the fund; "" → general (nothing); anything else → null (not understood). */
export function parseDesignation(raw: string | null | undefined): { fundId: string | null; campaignId: string | null; opportunityId: string | null } | null {
  const v = (raw ?? "").trim();
  if (!v) return { fundId: null, campaignId: null, opportunityId: null };
  const m = /^(fund|campaign|opportunity):(.+)$/.exec(v);
  if (!m || !UUID.test(m[2])) return null;
  const id = m[2].toLowerCase();
  return { fundId: m[1] === "fund" ? id : null, campaignId: m[1] === "campaign" ? id : null, opportunityId: m[1] === "opportunity" ? id : null };
}

export function designationValue(d: Pick<PledgeDesignation, "kind" | "id"> | null | undefined): string {
  return d ? `${d.kind}:${d.id}` : "";
}

/**
 * Every check the sheet and the command make, with the sentence the person sees. `today` is the community's own day (YYYY-MM-DD).
 * The request id is checked by the caller that needs it (the sheet's action); the command uses its confirmation instead.
 */
export function checkPledge(i: Omit<RecordPledgeInput, "requestId">, today: string): Checked<CheckedPledge> {
  const bad = (error: string): Checked<CheckedPledge> => ({ ok: false, error });
  if (!UUID.test((i.householdId ?? "").trim())) return bad("Choose the family first.");
  const cents = parseAmountToCents(i.amount);
  if (cents === null || cents <= 0) return bad("Enter the pledge amount, like 500.00.");
  if (!Number.isSafeInteger(cents)) return bad("That amount is too large. Check it and try again.");
  const designation = parseDesignation(i.designation);
  if (!designation) return bad("Choose what the pledge is for again: that choice was not understood.");
  const dueRaw = (i.dueOn ?? "").trim();
  if (dueRaw && (!isDateOnly(dueRaw) || addDays(dueRaw, 0) !== dueRaw)) return bad("Enter the due date as a date, like 2026-12-31.");
  if (dueRaw && Math.abs(daysBetween(today, dueRaw)) > DUE_WITHIN_DAYS) return bad("The due date must be within ten years of today.");
  const pledgedBy = (i.pledgedBy ?? "").trim();
  if (pledgedBy && !UUID.test(pledgedBy)) return bad("Choose the adult who pledged again: that choice was not understood.");
  const dedication = (i.dedication ?? "").trim();
  if (dedication.length > DEDICATION_MAX) return bad(`Keep the dedication to ${DEDICATION_MAX} characters or fewer.`);
  const reason = (i.reason ?? "").trim();
  if (reason.length < REASON_MIN) return bad('Say why this pledge is recorded here (for example "Pledged in person"). It shows in the family\'s History.');
  if (reason.length > REASON_MAX) return bad(`Keep the reason to ${REASON_MAX} characters or fewer.`);
  return {
    ok: true,
    value: {
      householdId: i.householdId.trim().toLowerCase(),
      amountCents: cents,
      ...designation,
      dueOn: dueRaw || null,
      pledgedBy: pledgedBy ? pledgedBy.toLowerCase() : null,
      dedication: dedication || null,
      reason,
    },
  };
}

/** The confirmation the sheet made when it opened (8 to 120 letters, digits, dashes, colons or underscores). */
export function isRequestId(v: unknown): v is string {
  return typeof v === "string" && REQUEST_ID.test(v);
}

/** The button: it names the amount and the family ("Record a $500.00 pledge for the Patel household 0127"). */
export function pledgeButtonLabel(i: { amount: string; family: Family | null; currency: string; locale?: string }): string {
  if (!i.family) return "Choose the family first";
  const cents = parseAmountToCents(i.amount);
  if (!cents || cents <= 0) return "Enter the amount";
  return `Record a ${formatCents(cents, i.currency, i.locale)} pledge for ${householdRef(i.family)}`;
}

/** After saving: "Recorded as PL-20456". */
export function recordedPledgeLabel(r: Pick<RecordedPledge, "pledgeNumber">): string {
  return r.pledgeNumber ? `Recorded as ${r.pledgeNumber}` : "Recorded";
}

/** What happens, said before the click. */
export function pledgeWhatHappens(i: { amountCents: number | null; forWhat: string | null; pledger: string | null; currency: string; locale?: string }): string {
  const amount = i.amountCents && i.amountCents > 0 ? `a pledge of ${formatCents(i.amountCents, i.currency, i.locale)}` : "a pledge";
  const to = i.forWhat ? ` to ${i.forWhat}` : " (general, no fund chosen)";
  const by = i.pledger ? `, pledged by ${i.pledger}` : ", for the household";
  return `Adds ${amount}${to}${by}. It shows as owed until it is paid, and in the family's History with your reason.`;
}

// ---------------------------------------------------------------------------
// The box: "pledge 500 patel building fund"
// ---------------------------------------------------------------------------
/** Words that say nothing about which fund or family ("the building FUND", "FOR the Patels"). */
const LINK_WORDS = new Set(["a", "an", "the", "for", "to", "towards", "toward", "of", "and", "in", "on", "fund", "funds", "campaign", "appeal", "drive"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Split what was typed after "pledge 500" into what the pledge is for and who it is from: "patel building fund" with a fund called
 * "Building fund" → the fund, and "patel" to look the family up by. A name is chosen only when every word that names it (not "fund",
 * "the", "campaign"…) was typed; with two equally good names nothing is chosen (the person picks in the sheet). A family is never chosen
 * here: the words left over are only what to look families up by.
 */
export function splitPledgeWords(who: string | null, names: readonly PledgeDesignation[]): { designation: PledgeDesignation | null; familyWords: string | null } {
  const typed = words(who ?? "");
  if (typed.length === 0) return { designation: null, familyWords: null };
  let best: { d: PledgeDesignation; score: number; used: Set<string> } | null = null;
  let tie = false;
  for (const d of names) {
    const own = words(d.name);
    const key = own.filter((w) => !LINK_WORDS.has(w));
    if (key.length === 0 || !key.every((w) => typed.includes(w))) continue;
    const score = key.length;
    if (!best || score > best.score) {
      best = { d, score, used: new Set(own) };
      tie = false;
    } else if (score === best.score && best.d.id !== d.id) {
      tie = true;
    }
  }
  const chosen = best && !tie ? best : null;
  const left = typed.filter((w) => !(chosen?.used.has(w) ?? false) && !LINK_WORDS.has(w));
  return { designation: chosen?.d ?? null, familyWords: left.length > 0 ? left.join(" ") : null };
}
