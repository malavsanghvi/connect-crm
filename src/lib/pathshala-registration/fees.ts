// Pathshala › Terms › Fees and rules (plan §2.2, §3.3, P21, P22): the levels of a term with their fees, which are
// offered (0590: an active level with a class this term), which still need a fee, the fee suggested from an earlier
// term, and what opening registration still waits for. Pure: the page, the actions and the tests share it.

import { formatDate, formatDateTime } from "@/lib/pathshala/format";

import type { LevelFee, LevelFeeInput, LevelRow, LevelSeats, PaymentMode } from "./contract";
import { ageBandLabel, levelAudience, sortLevels, sortTracks } from "./levels";

export type TrackLite = { id: string; key: string; name: string };
export type ClassLite = { level_id: string };
export type TermLite = { id: string; name: string; starts_on: string };

export type FeeRow = {
  level: LevelRow;
  /** An active level with at least one class in the term (§2.2, 0590): it needs a fee before registration opens. */
  offered: boolean;
  classes: number;
  /** The fee saved for this term, in cents; null = none yet. */
  saved: number | null;
  /** A fee to start from when none is saved (P22): the level's fee in the latest earlier term, else the term's old single fee. */
  suggestion: { cents: number; from: string } | null;
  seats: LevelSeats | null;
};

export type FeeGroup = { track: TrackLite; rows: FeeRow[] };

/**
 * The Fees screen's table: every track's levels that are active, offered or already priced for the term, in the order
 * families see them. A retired level stays listed while it has a class or a fee, so nothing is hidden.
 */
export function buildFeeGroups(input: {
  term: TermLite & { fee_per_child_cents: number };
  terms: readonly TermLite[];
  tracks: readonly TrackLite[];
  levels: readonly LevelRow[];
  classes: readonly ClassLite[];
  /** Every term's level fees (to suggest last term's). */
  fees: readonly LevelFee[];
  seats: readonly LevelSeats[] | null;
}): FeeGroup[] {
  const classCount = new Map<string, number>();
  for (const c of input.classes) classCount.set(c.level_id, (classCount.get(c.level_id) ?? 0) + 1);
  const saved = new Map(input.fees.filter((f) => f.term_id === input.term.id).map((f) => [f.level_id, f.fee_cents]));
  const earlier = input.terms.filter((t) => t.id !== input.term.id && t.starts_on < input.term.starts_on).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const seats = new Map((input.seats ?? []).map((s) => [s.level_id, s]));

  const suggestionFor = (levelId: string): FeeRow["suggestion"] => {
    for (const t of earlier) {
      const f = input.fees.find((x) => x.term_id === t.id && x.level_id === levelId);
      if (f) return { cents: f.fee_cents, from: t.name };
    }
    return input.term.fee_per_child_cents > 0 ? { cents: input.term.fee_per_child_cents, from: "the term's earlier single fee" } : null;
  };

  return sortTracks(input.tracks)
    .map((track) => {
      const rows = sortLevels(input.levels.filter((l) => l.track_id === track.id))
        .map((level): FeeRow => {
          const s = saved.get(level.id) ?? null;
          return {
            level,
            // A retired level is not offered even with a class (0590): families cannot choose it.
            offered: level.active && (classCount.get(level.id) ?? 0) > 0,
            classes: classCount.get(level.id) ?? 0,
            saved: s,
            suggestion: s === null ? suggestionFor(level.id) : null,
            seats: seats.get(level.id) ?? null,
          };
        })
        .filter((r) => r.level.active || r.classes > 0 || r.saved !== null);
      return { track, rows };
    })
    .filter((g) => g.rows.length > 0);
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Offered levels with no fee for the term, by name (opening registration refuses while there are any, P21), in the
 * order app.open_pathshala_registration names them: by track name, then the level's order and name.
 */
export function missingFeeNames(groups: readonly FeeGroup[]): string[] {
  return groups
    .flatMap((g) => g.rows.filter((r) => r.offered && r.saved === null).map((r) => ({ track: g.track.name, level: r.level })))
    .sort((a, b) => a.track.localeCompare(b.track) || a.level.sort_order - b.level.sort_order || a.level.name.localeCompare(b.level.name))
    .map((x) => x.level.name);
}

/** The fund 0590 finds by itself for the fee pledges: key "pathshala", else a name starting with "Pathshala". */
export function isPathshalaFund(fund: { key?: string | null; name: string }): boolean {
  return fund.key === "pathshala" || /^\s*pathshala/i.test(fund.name);
}

/** The database's refusal, said before anyone clicks (§2.2): "Set the fee for Gujarati 3 and Hindi 1 before opening registration." */
export function missingFeesSentence(names: readonly string[]): string | null {
  return names.length ? `Set the fee for ${joinNames(names)} before opening registration.` : null;
}

/** After opening, a class added for a level with no fee (§2.2): families cannot choose that level yet. */
export function unpricedOfferedSentence(names: readonly string[], termName: string): string | null {
  if (!names.length) return null;
  return `${joinNames(names)} ${names.length === 1 ? "has a class" : "have classes"} but no fee for ${termName} yet, so families cannot choose ${names.length === 1 ? "it" : "them"}.`;
}

/** Only the fees that differ from what is saved (a change after opening needs a reason, so nothing unchanged is sent). */
export function changedFees(saved: ReadonlyMap<string, number>, entered: ReadonlyMap<string, number | null>): LevelFeeInput[] {
  const out: LevelFeeInput[] = [];
  for (const [levelId, cents] of entered) {
    if (cents === null) continue;
    if (saved.get(levelId) !== cents) out.push({ level_id: levelId, fee_cents: cents });
  }
  return out;
}

/** A level's seats in one line: "24 seats · 12 taken · 2 held · 10 free", "No limit · 5 taken", "Full · 3 waiting". */
export function seatsLabel(s: LevelSeats | null): string {
  if (!s) return "—";
  const parts: string[] = [];
  if (s.seats === null) parts.push("No limit");
  else parts.push(`${s.seats} seat${s.seats === 1 ? "" : "s"}`);
  parts.push(`${s.taken} taken`);
  if (s.held > 0) parts.push(`${s.held} held`);
  if (s.free !== null) parts.push(s.free > 0 ? `${s.free} free` : "Full");
  if (s.waitlist > 0) parts.push(`${s.waitlist} waiting`);
  else if (s.free === 0) parts.push(s.waitlist_on ? "waitlist open" : "no waitlist");
  return parts.join(" · ");
}

/** "Children's level · Ages 8–10" / "Adult class · 18 and over" / "No age band". */
export function bandCell(level: Pick<LevelRow, "min_age" | "max_age">): string {
  const audience = levelAudience(level.min_age, level.max_age);
  const band = ageBandLabel(level.min_age, level.max_age);
  if (audience === "any") return band;
  return `${audience === "adult" ? "Adult class" : "Children's level"} · ${band}`;
}

export type CheckItem = { tone: "bad" | "warn" | "ok" | "info"; text: string };

const listSome = (names: readonly string[], max = 6) =>
  names.length <= max ? joinNames(names) : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

/**
 * What opening registration still waits for, in plain English (§3.3: "lists in plain English what is missing").
 * "bad" lines are refusals the database will make; "warn" lines are warnings it does not refuse (§2.1: no age band).
 */
export function openChecklist(input: {
  groups: readonly FeeGroup[];
  paymentMode: PaymentMode;
  payNowBlocked: string | null;
  givingOn: boolean;
  /** With Giving on, the fee pledges need a fund: the term's own, or the Pathshala fund 0590 finds by itself. Null: unknown. */
  fundFound: boolean | null;
  membershipRequired: boolean;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  tz: string;
}): CheckItem[] {
  const out: CheckItem[] = [];
  const offered = input.groups.flatMap((g) => g.rows.filter((r) => r.offered));
  const missing = missingFeeNames(input.groups);
  if (offered.length === 0) {
    out.push({ tone: "warn", text: "No classes yet: opening now locks the term with no fees to set. Add the classes first so families can choose their levels." });
  } else if (missing.length) {
    out.push({ tone: "bad", text: missingFeesSentence(missing) as string });
  } else {
    out.push({ tone: "ok", text: `Every offered level has its fee (${offered.length} level${offered.length === 1 ? "" : "s"}).` });
  }
  if (input.paymentMode === "pay_now" && input.payNowBlocked) {
    out.push({ tone: "bad", text: `This term is set to “Pay when registering”, which cannot be used yet: ${input.payNowBlocked}` });
  }
  if (input.givingOn && input.fundFound === false) {
    out.push({
      tone: "bad",
      text: "There is no Pathshala fund for the fees yet. The treasurer (giving.manage) chooses the fund under Registration rules, or adds a fund called Pathshala in Setup › Lists; then open registration.",
    });
  }
  const noBand = offered.filter((r) => r.level.min_age === null && r.level.max_age === null).map((r) => r.level.name);
  if (noBand.length) {
    out.push({
      tone: "warn",
      text: `No age band yet for ${listSome(noBand)}: the app cannot suggest ${noBand.length === 1 ? "it" : "them"} by age, or keep adult classes for adults. Set the bands in Pathshala › Levels.`,
    });
  }
  if (input.registrationOpensAt || input.registrationClosesAt) {
    const from = input.registrationOpensAt ? `from ${formatDateTime(input.registrationOpensAt, input.tz)}` : "as soon as registration opens";
    const until = input.registrationClosesAt ? ` until ${formatDateTime(input.registrationClosesAt, input.tz)}` : ", with no closing date";
    out.push({ tone: input.registrationClosesAt ? "info" : "warn", text: `Families can register ${from}${until}. The dates are on the term's form.` });
  } else {
    out.push({ tone: "warn", text: "No registration dates are set: families can register as soon as it opens, with no closing date. Set them on the term's form." });
  }
  if (input.membershipRequired) {
    out.push({ tone: "info", text: "Membership is required: a household that is not a member is held, with no seat and no fee, until its membership is active." });
  }
  if (!input.givingOn) {
    out.push({ tone: "info", text: "Pledges & donations is off: registrations are kept and their fees quoted, but nothing is billed until it is switched on." });
  }
  return out;
}

/** "Fees and rules locked on Tue, Sep 1, 2026 by Neha Shah, when registration opened." */
export function lockedSentence(lockedAt: string | null, by: string | null, tz: string): string | null {
  if (!lockedAt) return null;
  return `Fees and rules locked on ${formatDate(lockedAt, tz)}${by ? ` by ${by}` : ""}, when registration opened.`;
}
