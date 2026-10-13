// The pure core of the person slide-over's Memberships section (docs/PEOPLE_REDESIGN.md section 4). No server imports and no React:
// the loader (memberships-load.ts) reads the database and fills the model in, the components draw it, the Server Actions
// (households/[id]/membership-actions.ts) send what these checks accept, and the tests need no database.
//
// What staff can do here (owner decision 2026-10-13), and who: only a person who holds BOTH people.approve AND people.manage.
//   - Edit the start date, end date and note of a membership, with a reason          (app.staff_update_membership, migration 0724)
//   - Change a family's tier, with a reason                                          (the existing people.update_household command)
//   - Assign a new membership, with or without recording its fee as an open pledge   (app.staff_assign_membership, migration 0724)
//
// !! A membership assigned by staff is ACTIVE AT ONCE, for every tier, Life included, and it does NOT wait for the Executive Committee.
// The confirmation sentence below says so every time. Every one of these needs a reason, and every one is audited.
//
// The checks here mirror the database's (so a mistake shows before anything is sent, in plain words, next to the field); the database
// checks again and is the one that decides. Built for every organization: nothing here names a community, a tradition or a currency;
// the tier words come from the data (tierLabel) and money arrives already formatted in the community's currency.

import { formatDate, isDateOnly } from "@/lib/dates";
import { tierLabel } from "@/lib/people";

export const MEMBERSHIP_REASON_MAX = 500;
export const MEMBERSHIP_NOTE_MAX = 1000;
export const MEMBERSHIP_MIN_DATE = "1900-01-01";
export const MEMBERSHIP_MAX_DATE = "2200-12-31";
/** The database makes the fee pledge due this many days from the day it is recorded, as the approval path does. */
export const FEE_DUE_DAYS = 30;

export const CHANGE_NEEDS = "You can see memberships here but not change them. Changing one needs both the manage and the approve permission for People.";
/** Under the Notes box of the edit panel: members can read a note, so the reason belongs in the Reason box (audit log only). */
export const NOTE_READABLE_HINT = "Members of this household can read this note. Put the reason in the Reason box below: it only goes in the audit log.";
/** In the assign confirmation: the reason is audit-only and the note the database writes is neutral. */
export const ASSIGN_NOTE_LINE = "The reason is kept in the audit log only. The membership's note will say just \"Assigned by staff\", which members of this household can read.";
/** In the Change tier panel: the existing tier change copies the reason into the new membership's note (migration 0030/0104). */
export const TIER_NOTE_LINE = "The reason goes in the audit log. The tier change also copies it into the new membership's note, which members of this household can read, so keep it factual.";
export const NO_FAMILY_NOTE = "This person is not in a family yet, so a membership cannot be assigned here.";

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------
export type MembershipHolder = { id: string; name: string };

export type MembershipRow = {
  id: string;
  householdId: string;
  tier: string;
  typeName: string;
  status: string;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  holder: MembershipHolder | null;
  /** The family's card line in parts (name, number, the organization's id, adults, place): a family is never shown by its name alone. */
  household: string[];
  hasFeePledge: boolean;
  /** The type runs for a set period (a yearly one): its end date cannot be cleared. */
  fixedTerm: boolean;
};

export type MembershipTypeOption = {
  id: string;
  name: string;
  tier: string;
  feeCents: number;
  /** The fee written in the community's currency ("$500.00"), or null when the type has none. */
  feeLabel: string | null;
  periodMonths: number | null;
};

export type AssignContext = {
  householdId: string;
  /** The family's card line in parts. */
  household: string[];
  types: MembershipTypeOption[];
  /** The adults of the family (never a child, never a person recorded as deceased). */
  holders: MembershipHolder[];
  defaultHolderId: string | null;
  /** Pledges & donations is on: a fee can be recorded. */
  givingOn: boolean;
  /** The family's live membership, when it has one: assigning another is refused and Change tier is the way. */
  live: { id: string; tier: string; typeName: string; endsOn: string | null } | null;
};

export type MembershipsData = {
  rows: MembershipRow[];
  /** More memberships exist than are shown (the most recent are). */
  truncated: boolean;
  today: string;
  /** The viewer holds both people.approve and people.manage. */
  canChange: boolean;
  /** The family the page is about; null when the person is in none. */
  assign: AssignContext | null;
};

// ---------------------------------------------------------------------------
// Who, what is live
// ---------------------------------------------------------------------------
/** Both permissions together, the same gate as the tier change. `has` asks one permission key. */
export function canChangeMemberships(has: (permission: string) => boolean): boolean {
  return has("people.approve") && has("people.manage");
}

/** Live is what the rest of the system means by it: active, and not past its end date. */
export function isLive(m: Pick<MembershipRow, "status" | "endsOn">, today: string): boolean {
  return m.status === "active" && (!m.endsOn || m.endsOn >= today);
}

export type StatusView = { label: string; tone: "green" | "grey" | "sun" | "blue" };

export function statusView(m: Pick<MembershipRow, "status" | "endsOn">, today: string): StatusView {
  switch (m.status) {
    case "active":
      return isLive(m, today) ? { label: "Active", tone: "green" } : { label: "Expired", tone: "grey" };
    case "pending":
      return { label: "Pending", tone: "sun" };
    case "suspended":
      return { label: "Suspended", tone: "sun" };
    case "lapsed":
      return { label: "Lapsed", tone: "grey" };
    case "ended":
      return { label: "Ended", tone: "grey" };
    default:
      return { label: m.status ? `${m.status[0].toUpperCase()}${m.status.slice(1)}` : "Unknown", tone: "grey" };
  }
}

/** "Oct 14, 2026 – Oct 14, 2027", or "Oct 14, 2026 – no end date". */
export function periodText(m: Pick<MembershipRow, "startsOn" | "endsOn">, timeZone: string): string {
  return `${formatDate(m.startsOn, timeZone)} – ${m.endsOn ? formatDate(m.endsOn, timeZone) : "no end date"}`;
}

/** The family's live membership among these rows: the highest tier, then the newest. */
export function liveOf(rows: readonly MembershipRow[], householdId: string, today: string): MembershipRow | null {
  const rank: Record<string, number> = { community: 1, yearly: 2, life: 3 };
  const live = rows.filter((r) => r.householdId === householdId && isLive(r, today));
  live.sort((a, b) => (rank[b.tier] ?? 0) - (rank[a.tier] ?? 0) || (a.startsOn < b.startsOn ? 1 : a.startsOn > b.startsOn ? -1 : 0));
  return live[0] ?? null;
}

/**
 * A family's card line (never a name alone) from app.household_card: the name, the household number, the organization's own id, the
 * primary member and the place. For a family other than the one the page is about.
 */
export function householdCardLine(c: {
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  primary_member: string | null;
  city: string | null;
}): string[] {
  return [c.household_name || "Unnamed household", c.household_number ? `No. ${c.household_number}` : "No household number yet", c.org_household_id, c.primary_member, c.city].filter(
    (x): x is string => Boolean(x),
  );
}

/** The family's card line as one phrase: "Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside)". */
export function householdPhrase(line: readonly string[]): string {
  const [name, ...rest] = line;
  if (!name) return "this family";
  return rest.length > 0 ? `${name} (${rest.join(" · ")})` : name;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
/** A real calendar day written YYYY-MM-DD. */
export function isRealDate(value: string): boolean {
  if (!isDateOnly(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export const inRange = (value: string): boolean => value >= MEMBERSHIP_MIN_DATE && value <= MEMBERSHIP_MAX_DATE;

/** Add months to a YYYY-MM-DD date the way the database does: the same day, or the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/** When a membership of this type that starts on `startsOn` ends, unless a date is chosen: the type's period, or never. */
export function defaultEndsOn(startsOn: string, periodMonths: number | null): string | null {
  return periodMonths !== null && isRealDate(startsOn) ? addMonths(startsOn, periodMonths) : null;
}

/** Two active memberships overlap when their days overlap; sharing a single boundary day is fine (a tier change does it). */
export function overlaps(a: { startsOn: string; endsOn: string | null }, b: { startsOn: string; endsOn: string | null }): boolean {
  return a.startsOn < (b.endsOn ?? "9999-12-31") && b.startsOn < (a.endsOn ?? "9999-12-31");
}

export type Checked<I> = { ok: true; input: I } | { ok: false; error: string; field: string };
const bad = (field: string, error: string): { ok: false; error: string; field: string } => ({ ok: false, error, field });

function checkReason(reason: string, what: string): string | null {
  const r = reason.trim();
  if (!r) return `Say why ${what}: the reason goes in the audit log`;
  if (r.length > MEMBERSHIP_REASON_MAX) return `The reason is too long (${MEMBERSHIP_REASON_MAX} characters at most)`;
  return null;
}

// ---------------------------------------------------------------------------
// Edit the dates and note
// ---------------------------------------------------------------------------
export type EditDraft = { startsOn: string; endsOn: string; notes: string; reason: string };

export const editDraftOf = (m: Pick<MembershipRow, "startsOn" | "endsOn" | "notes">): EditDraft => ({ startsOn: m.startsOn, endsOn: m.endsOn ?? "", notes: m.notes ?? "", reason: "" });

export type EditInput = { membershipId: string; startsOn: string; endsOn: string | null; notes: string | null; reason: string };

const clean = (s: string | null | undefined): string | null => (s ?? "").trim() || null;

/** What changes, as plain lines ("Start date: Oct 1, 2026 → Sep 20, 2026"), for the panel to show before it saves. */
export function editChanges(m: MembershipRow, d: EditDraft, timeZone: string): string[] {
  const out: string[] = [];
  const day = (v: string | null) => (v ? formatDate(v, timeZone) : "none");
  if (d.startsOn !== m.startsOn) out.push(`Start date: ${day(m.startsOn)} → ${day(d.startsOn || null)}`);
  if ((d.endsOn || null) !== m.endsOn) out.push(`End date: ${m.endsOn ? day(m.endsOn) : "none"} → ${d.endsOn ? day(d.endsOn) : "none"}`);
  if (clean(d.notes) !== clean(m.notes)) out.push(clean(d.notes) ? "The note changes" : "The note is cleared");
  return out;
}

/**
 * The edit panel's checks: the same rules as app.staff_update_membership. `siblings` are the other memberships of the same family
 * (for the overlap rule). Only a value that is being changed is held to "today" (a membership imported with an odd date can still
 * have its note corrected).
 */
export function checkEdit(m: MembershipRow, d: EditDraft, today: string, siblings: readonly MembershipRow[] = []): Checked<EditInput> {
  const starts = d.startsOn.trim();
  const ends = d.endsOn.trim();
  if (!starts) return bad("startsOn", "Choose the date the membership starts");
  if (!isRealDate(starts)) return bad("startsOn", "That start date is not a real date");
  if (ends && !isRealDate(ends)) return bad("endsOn", "That end date is not a real date");
  if (!inRange(starts) || (ends && !inRange(ends))) return bad(ends && !inRange(ends) ? "endsOn" : "startsOn", "Check the dates: they must fall between the years 1900 and 2200");
  if (ends && ends < starts) return bad("endsOn", "The end date cannot be before the start date");
  if (d.notes.trim().length > MEMBERSHIP_NOTE_MAX) return bad("notes", `The note is too long (${MEMBERSHIP_NOTE_MAX.toLocaleString("en-US")} characters at most)`);
  const startChanged = starts !== m.startsOn;
  const endChanged = (ends || null) !== m.endsOn;
  const notes = clean(d.notes);
  if (!startChanged && !endChanged && notes === clean(m.notes)) return bad("form", "Change a date or the note first");

  if (m.status === "active") {
    if (startChanged && starts > today) return bad("startsOn", "An active membership has already started, so it cannot start in the future. Choose today or an earlier date");
    if (endChanged && ends && ends < today) {
      return bad("endsOn", "An active membership cannot be given an end date in the past. To end it today, choose today as the end date: it counts until the end of today. To move the family to a different tier, use Change tier");
    }
  } else if (m.status === "ended" || m.status === "lapsed") {
    if (!ends) return bad("endsOn", "This membership has ended, so it keeps an end date");
    if (endChanged && ends > today) return bad("endsOn", "An ended membership cannot end in the future");
  }
  if (!ends && m.endsOn && m.fixedTerm && m.status !== "ended" && m.status !== "lapsed") {
    return bad("endsOn", "This kind of membership runs for a set period, so it needs an end date. To make a family a lifetime member, use Change tier");
  }
  if (m.status === "active" && (startChanged || endChanged)) {
    const clash = siblings.find((o) => o.id !== m.id && o.householdId === m.householdId && o.status === "active" && overlaps({ startsOn: starts, endsOn: ends || null }, o));
    if (clash) {
      return bad(
        "startsOn",
        `This family has another active ${tierLabel(clash.tier)} membership (from ${clash.startsOn} to ${clash.endsOn ?? "no end date"}) that overlaps those dates. To replace a membership, use Change tier; two active memberships cannot overlap`,
      );
    }
  }
  const reason = checkReason(d.reason, "the membership is being changed");
  if (reason) return bad("reason", reason);
  return { ok: true, input: { membershipId: m.id, startsOn: starts, endsOn: ends || null, notes, reason: d.reason.trim() } };
}

// ---------------------------------------------------------------------------
// Change tier (the existing rule: the people.update_household command with a tier and its reason)
// ---------------------------------------------------------------------------
export type TierDraft = { tier: string; reason: string };
export type TierInput = { householdId: string; tier: string; reason: string };

/** The tiers a family can be moved to: the ones the community offers, other than the one it holds. */
export function tierChoices(types: readonly MembershipTypeOption[], currentTier: string): string[] {
  const order = ["community", "yearly", "life"];
  return order.filter((t) => t !== currentTier && types.some((x) => x.tier === t));
}

export function checkTierChange(o: { householdId: string; currentTier: string; choices: readonly string[] }, d: TierDraft): Checked<TierInput> {
  if (!d.tier) return bad("tier", "Choose the tier to change to");
  if (d.tier === o.currentTier) return bad("tier", `The family already holds a ${tierLabel(o.currentTier)} membership. Choose a different tier`);
  if (!o.choices.includes(d.tier)) return bad("tier", "That tier is not offered by this community");
  const reason = checkReason(d.reason, "the tier is changing");
  if (reason) return bad("reason", reason);
  return { ok: true, input: { householdId: o.householdId, tier: d.tier, reason: d.reason.trim() } };
}

/** What a tier change does, in words. A tier change is also active at once and does not go to the Executive Committee. */
export function tierSentence(o: { household: readonly string[]; from: string; to: string }): string {
  return (
    `Change ${householdPhrase(o.household)} from ${tierLabel(o.from)} to ${tierLabel(o.to)}. ` +
    `The ${tierLabel(o.from)} membership ends today and a ${tierLabel(o.to)} membership starts today. ` +
    "It is active at once and does not wait for the Executive Committee. No fee is recorded."
  );
}

// ---------------------------------------------------------------------------
// Assign a membership
// ---------------------------------------------------------------------------
export type AssignDraft = { typeId: string; startsOn: string; endsOn: string; holderId: string; reason: string; recordFee: boolean };

export function assignDraftOf(ctx: AssignContext, today: string): AssignDraft {
  return { typeId: "", startsOn: today, endsOn: "", holderId: ctx.defaultHolderId ?? "", reason: "", recordFee: false };
}

/** The fee box is offered only for a type with a fee, and only when Pledges & donations is on. */
export function feeOffered(ctx: Pick<AssignContext, "givingOn">, type: Pick<MembershipTypeOption, "feeCents"> | undefined): boolean {
  return Boolean(type && ctx.givingOn && type.feeCents > 0);
}

export type AssignInput = {
  householdId: string;
  holderId: string | null;
  typeId: string;
  startsOn: string;
  /** Always sent when the membership ends: the chosen date, else the one the type's period gives (so the sentence and the database agree). */
  endsOn: string | null;
  reason: string;
  recordFee: boolean;
};

export type AssignChecked = { type: MembershipTypeOption; holder: MembershipHolder | null; request: AssignInput };

/** The new-membership form's checks: the same rules as app.staff_assign_membership. */
export function checkAssign(ctx: AssignContext, d: AssignDraft, today: string): Checked<AssignChecked> {
  if (ctx.live) {
    return bad("typeId", `This family already has an active ${tierLabel(ctx.live.tier)} membership. To move it to a different tier, use Change tier`);
  }
  const type = ctx.types.find((t) => t.id === d.typeId);
  if (!type) return bad("typeId", "Choose a membership type");
  const starts = d.startsOn.trim();
  if (!starts) return bad("startsOn", "Choose the date the membership starts");
  if (!isRealDate(starts)) return bad("startsOn", "That start date is not a real date");
  if (starts < MEMBERSHIP_MIN_DATE) return bad("startsOn", "Check the start date: it must be after the year 1900");
  if (starts > today) return bad("startsOn", "A membership assigned by staff is active at once, so it cannot start in the future. Choose today or an earlier date");
  const given = d.endsOn.trim();
  if (given && !isRealDate(given)) return bad("endsOn", "That end date is not a real date");
  if (given && !inRange(given)) return bad("endsOn", "Check the end date: it must fall between the years 1900 and 2200");
  const ends = given || defaultEndsOn(starts, type.periodMonths);
  if (ends && ends < starts) return bad("endsOn", "The end date cannot be before the start date");
  if (ends && ends < today) return bad("endsOn", "That end date has already passed, so the membership would be over as soon as it begins. Choose a later end date");
  let holder: MembershipHolder | null = null;
  if (d.holderId) {
    holder = ctx.holders.find((h) => h.id === d.holderId) ?? null;
    if (!holder) return bad("holderId", "The holder must be an adult of this family");
  }
  const reason = checkReason(d.reason, "the membership is being assigned");
  if (reason) return bad("reason", reason);
  return {
    ok: true,
    input: {
      type,
      holder,
      request: { householdId: ctx.householdId, holderId: holder?.id ?? null, typeId: type.id, startsOn: starts, endsOn: ends, reason: d.reason.trim(), recordFee: d.recordFee && feeOffered(ctx, type) },
    },
  };
}

/**
 * The one confirmation, in words: exactly what will happen. It ALWAYS says that the membership is active at once and does not wait
 * for the Executive Committee, for every tier, and always says what happens to the fee.
 *   "Assign a Life membership (Lifetime member) to Hassan household (No. 0301 · …), held by Samira Hassan, from Oct 14, 2026, for life.
 *    It is active at once and does not wait for the Executive Committee. The $500.00 fee is recorded as an open pledge."
 */
export function assignSentence(ctx: Pick<AssignContext, "household" | "givingOn">, c: AssignChecked, timeZone: string): string {
  const { type, holder, request } = c;
  const kind = tierLabel(type.tier);
  const typeName = type.name.trim().toLowerCase();
  const named = typeName === kind.toLowerCase() || typeName === `${kind} membership`.toLowerCase() ? "" : ` (${type.name})`;
  const who = holder ? `held by ${holder.name}` : "with no holder named";
  const from = `from ${formatDate(request.startsOn, timeZone)}`;
  const until = request.endsOn ? `until ${formatDate(request.endsOn, timeZone)}` : type.tier === "life" ? "for life" : "with no end date";
  const head = `Assign a ${kind} membership${named} to ${householdPhrase(ctx.household)}, ${who}, ${from}, ${until}.`;
  const active = "It is active at once and does not wait for the Executive Committee.";
  return `${head} ${active} ${feeSentence(ctx, type, request.recordFee)}`;
}

/** What happens to the fee. */
export function feeSentence(ctx: Pick<AssignContext, "givingOn">, type: MembershipTypeOption, recordFee: boolean): string {
  if (type.feeCents <= 0) return "This membership has no fee.";
  if (!ctx.givingOn) return `The ${type.feeLabel ?? "fee"} fee is not recorded, because Pledges & donations is switched off.`;
  if (recordFee) return `The ${type.feeLabel ?? "fee"} fee is recorded as an open pledge, due in ${FEE_DUE_DAYS} days.`;
  return "No fee is recorded.";
}

/** The sentence said after the assignment worked; `feeRecorded` is null when the server could not say. */
export function assignedMessage(o: { typeName: string; tier: string; feeRecorded: boolean | null; wantedFee: boolean }): string {
  const base = `${tierLabel(o.tier)} membership assigned (${o.typeName}). It is active now · audit logged.`;
  if (o.feeRecorded === true) return `${base} The fee is recorded as an open pledge.`;
  if (o.feeRecorded === false && o.wantedFee) return `${base} No fee pledge was recorded.`;
  if (o.feeRecorded === null && o.wantedFee) return `${base} Check the Giving tab to see the fee pledge.`;
  return base;
}
