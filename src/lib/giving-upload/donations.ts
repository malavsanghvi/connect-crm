// Upload donations (GV-U slice C; owner ask 2026-10-13: "we will need similar for donations separately"). Pure: the template,
// reading the rows, and the review the person confirms. Each row is ONE offline payment (check, cash, ACH, Zelle or stock) recorded
// through app.record_offline_payment_once (0658), which the database runs once per row inside one upload (app.record_donation_upload,
// 0777): all or nothing, once per confirmation.
//
// The rules are the Record payment sheet's own: the same checks and words (checkOfflinePayment), the same allocation plan
// (planDraftAllocation: earliest open pledge first, a named pledge, or none), applied exactly as the review shows. Rows are planned
// in file order, each seeing what the rows above it will have paid, as the database will run them. Someone who may record but not
// apply payments gets every row recorded and not applied, as on the sheet. A household is found by an identifier of any kind, never
// by a name alone. A row that looks like a payment already recorded waits for the person.

import { familyRef, type Family } from "@/lib/giving-today/queue";
import { OFFLINE_METHODS } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { checkOfflinePayment, type AllocationMode, type OfflineMethod } from "@/lib/payments/offline-payment";
import { planDraftAllocation, type DraftPledge, type PlannedLine } from "@/lib/payments/payment-draft";
import type { CardLabels } from "@/components/household-card";

import { matchHousehold, nameDisagrees, pickReason, type HouseholdHit } from "./households";
import { findTarget, type PledgeTarget } from "./pledges";
import {
  MAX_UPLOAD_ROWS,
  cell,
  dateExample,
  mapColumns,
  readAmount,
  readDate,
  rowsWord,
  withinTenYears,
  type ColumnMap,
  type ColumnSpec,
  type Conventions,
  type UploadTable,
} from "./sheet";

export type DonationColumn =
  | "household"
  | "name_check"
  | "amount"
  | "method"
  | "received_on"
  | "reference"
  | "envelope"
  | "for"
  | "apply_to"
  | "note";

export const NOTE_MAX = 300;

/** The columns, in the community's words. */
export function donationColumns(words: { household: string }): ColumnSpec<DonationColumn>[] {
  const hh = words.household ? words.household[0].toUpperCase() + words.household.slice(1) : "Household";
  return [
    {
      key: "household",
      header: `${hh} ID`,
      required: true,
      synonyms: [
        "household", "household id", "household number", "household no", "family id", "family number", "member id", "member number",
        "member no", "id", "identifier", "donor id", "account", "account id", "constituent id", "customer", "customer id", "payer",
        "payer name", "family", "donor", "household name", "family name", "donor name",
      ],
      help: `Any ID of the ${words.household}: its number, a member's number, your own IDs, the old system's or the accounting system's, or the bank payer name it is known by. A name works too, but you then pick the ${words.household} yourself.`,
    },
    {
      key: "name_check",
      header: "Name (to check)",
      required: false,
      synonyms: ["name", "full name", "household name", "family name", "donor name"],
      help: `Optional. A name to check the match against: a row whose ${words.household} does not match it waits for you to look.`,
    },
    {
      key: "amount",
      header: "Amount",
      required: true,
      synonyms: ["gift", "gift amount", "donation", "donation amount", "amount received", "total", "value", "payment"],
      help: "The amount received, in your community's currency.",
    },
    {
      key: "method",
      header: "Method",
      required: true,
      synonyms: ["payment method", "type", "payment type", "tender", "paid by", "how paid"],
      help: "Check, cash, ACH (a bank transfer), Zelle or stock. Card, PayPal and Venmo gifts come in through the payment provider.",
    },
    {
      key: "received_on",
      header: "Received on",
      required: true,
      synonyms: ["date", "received", "date received", "gift date", "donation date", "payment date", "deposit date"],
      help: "The day it was received: today or earlier.",
    },
    {
      key: "reference",
      header: "Check number or reference",
      required: false,
      synonyms: ["check number", "check no", "check #", "cheque number", "reference", "ref", "confirmation", "confirmation number", "transaction id"],
      help: "A check's number, a Zelle or bank confirmation, or for stock the shares and their value (required for stock).",
    },
    {
      key: "envelope",
      header: "Envelope",
      required: false,
      synonyms: ["envelope number", "envelope no", "envelope #"],
      help: "Optional. The offering envelope's number.",
    },
    {
      key: "for",
      header: "For",
      required: false,
      synonyms: ["fund", "campaign", "purpose", "designation", "appeal", "project"],
      help: `Optional. A fund or campaign: the payment pays the ${words.household}'s open pledges for it, oldest first. With none open it is recorded as a general gift and the memo says what it was for.`,
    },
    {
      key: "apply_to",
      header: "Apply to pledge",
      required: false,
      synonyms: ["pledge", "pledge number", "pledge no", "pledge #", "applied to", "apply to"],
      help: `Optional. A pledge number to pay, or "none" for a general gift. Empty: the ${words.household}'s open pledges, oldest first (as the Record payment sheet does).`,
    },
    {
      key: "note",
      header: "Note",
      required: false,
      synonyms: ["notes", "memo", "comment", "comments", "remarks"],
      help: `Optional. Kept on the payment and added to the reason in its history. At most ${NOTE_MAX} characters.`,
    },
  ];
}

const METHOD_WORDS: Record<string, OfflineMethod> = {
  check: "check", cheque: "check", chk: "check", chq: "check",
  cash: "cash", currency: "cash",
  ach: "ach", "bank transfer": "ach", transfer: "ach", "direct deposit": "ach", eft: "ach", "electronic transfer": "ach", "wire": "ach",
  "bank": "ach", "online banking": "ach", bacs: "ach", sepa: "ach", neft: "ach", imps: "ach", upi: "ach",
  zelle: "zelle",
  stock: "stock", shares: "stock", securities: "stock",
};
const OTHER_METHODS = /^(card|credit card|debit card|visa|mastercard|amex|paypal|venmo|apple pay|google pay|daf|donor advised fund|matching gift|employer match)$/;

/** A method as people write it; null when it is not one an upload records. */
export function readMethod(text: string): { ok: true; method: OfflineMethod } | { ok: false; error: string } {
  const t = text.trim().toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, error: "Method is empty: write check, cash, ACH, Zelle or stock." };
  const m = METHOD_WORDS[t];
  if (m) return { ok: true, method: m };
  if (OTHER_METHODS.test(t)) {
    return {
      ok: false,
      error: `Method “${text.trim()}”: card, PayPal and Venmo gifts come in through the payment provider, and donor-advised fund and matching gifts are matched under Payments › Grants to match. Upload only check, cash, ACH, Zelle or stock.`,
    };
  }
  return { ok: false, error: `Method “${text.trim()}” is not one of check, cash, ACH, Zelle or stock.` };
}

/** The template: the headings and two example rows in the community's own money and date conventions. */
export function donationTemplateRows(words: { household: string }, conv: Conventions): string[][] {
  const cols = donationColumns(words);
  const money = (cents: number) => (conv.decimal === "," ? (cents / 100).toFixed(2).replace(".", ",") : (cents / 100).toFixed(2));
  const day = conv.dateOrder === "mdy" ? "10/11/2026" : "11/10/2026";
  const values: Record<DonationColumn, [string, string]> = {
    household: ["0127", "M-0417"],
    name_check: ["Adeyemi", "Okafor"],
    amount: [money(25_000), money(10_050)],
    method: ["check", "cash"],
    received_on: [day, day],
    reference: ["1044", ""],
    envelope: ["", "112"],
    for: ["", ""],
    apply_to: ["", "none"],
    note: ["", "Sunday collection"],
  };
  return [cols.map((c) => c.header), cols.map((c) => values[c.key][0]), cols.map((c) => values[c.key][1])];
}

// ---------------------------------------------------------------------------------------------------------------------- Rows

export type DonationLine = {
  line: number;
  household: string;
  nameCheck: string;
  amountCents: number | null;
  method: OfflineMethod | null;
  receivedOn: string | null;
  reference: string;
  envelope: string;
  forText: string;
  applyTo: string;
  note: string;
  problems: string[];
};

export type ReadDonations = { columns: ColumnMap<DonationColumn>; lines: DonationLine[]; fileProblems: string[] };

export function readDonationLines(table: UploadTable, conv: Conventions, today: string, words: { household: string }): ReadDonations {
  const specs = donationColumns(words);
  const columns = mapColumns(table.headers, specs);
  const fileProblems = columns.missing.map((k) => `The file has no “${specs.find((s) => s.key === k)!.header}” column. Download the template to see the columns.`);
  const lines: DonationLine[] = table.rows.map(({ line, cells }) => {
    const get = (k: DonationColumn) => cell(cells, columns, k);
    const problems: string[] = [];
    const household = get("household");
    if (!household) problems.push(`No ${words.household}: write an ID (or a name, and pick the ${words.household}).`);
    let amountCents: number | null = null;
    const a = readAmount(get("amount"), conv, table.source);
    if (a.ok) amountCents = a.value;
    else problems.push(`Amount ${a.error}.`);
    let method: OfflineMethod | null = null;
    const m = readMethod(get("method"));
    if (m.ok) method = m.method;
    else problems.push(m.error);
    let receivedOn: string | null = null;
    const d = readDate(get("received_on"), conv);
    if (!d.ok) problems.push(`Received on ${d.error}.`);
    else if (d.value > today) problems.push("Received on is in the future: a payment is recorded on or after the day it arrived.");
    else if (!withinTenYears(d.value, today)) problems.push("Received on is more than ten years ago. Past years' history comes in through Settings › Import.");
    else receivedOn = d.value;
    const reference = get("reference");
    if (method === "stock" && !reference) problems.push("A stock gift needs the shares and their value on the day received, in the reference column.");
    if (reference.length > 120) problems.push("The check number or reference is longer than 120 characters.");
    const envelope = get("envelope");
    if (envelope.length > 40) problems.push("The envelope number is longer than 40 characters.");
    const note = get("note");
    if (note.length > NOTE_MAX) problems.push(`Note is longer than ${NOTE_MAX} characters.`);
    return { line, household, nameCheck: get("name_check"), amountCents, method, receivedOn, reference, envelope, forText: get("for"), applyTo: get("apply_to"), note, problems };
  });
  return { columns, lines, fileProblems };
}

export function donationLookupValues(lines: readonly DonationLine[]): string[] {
  return [...new Set(lines.map((l) => l.household.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------------------------------------------------- Review

/** An open pledge of a household the file names, as the allocation plan reads it. */
export type UploadPledge = DraftPledge & { campaignId: string | null; fundId: string | null };

/** A payment already recorded that a row looks like (the database says, app.giving_upload_payment_repeats). */
export type PaymentRepeat = { line: number; receiptNumber: string | null; receivedOn: string };

export type DonationLookups = {
  today: string;
  currency: string;
  locale: string;
  labels: CardLabels;
  household: string;
  /** giving.manage: rows are applied; without it they are recorded and not applied. */
  canAllocate: boolean;
  hits: HouseholdHit[];
  targets: PledgeTarget[];
  /** Open pledges of every household a row matched or may be picked as. */
  pledges: Record<string, UploadPledge[]>;
  /** Repeats the database found for the rows as the file matched them, by line. */
  repeats: PaymentRepeat[];
  /** Zelle rows: a Zelle of the same amount for the household recorded or reported near that day, by line. */
  zelle: { line: number; what: string }[];
};

export type DonationStatus = "ready" | "pick" | "check" | "repeat" | "problem";

export type DonationRow = {
  line: number;
  status: DonationStatus;
  ticked: boolean;
  family: Family | null;
  via: string | null;
  candidates: Family[];
  amountCents: number | null;
  method: OfflineMethod | null;
  receivedOn: string | null;
  checkNumber: string | null;
  envelope: string | null;
  memo: string | null;
  note: string;
  mode: AllocationMode;
  /** What the payment does, said before the click ("Pays PL-0455 in full"; "Recorded as a general gift"). */
  after: string[];
  /** The exact lines the database applies (empty: a general gift, or not applied). */
  allocations: PlannedLine[];
  problems: string[];
  warnings: string[];
  repeatOf: string | null;
};

export type DonationReview = {
  rows: DonationRow[];
  counts: Record<DonationStatus, number>;
  tickedCount: number;
  tickedCents: number;
  appliedCents: number;
};

export type DonationChoices = { picks: Record<number, string>; ticks: Record<number, boolean> };
export const NO_DONATION_CHOICES: DonationChoices = { picks: {}, ticks: {} };

const NONE_WORDS = new Set(["none", "no", "general", "general gift", "do not apply", "don't apply", "-", "n/a", "na", "unapplied"]);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The review: every row's household, what it pays and what stops it, given the person's choices so far. */
export function reviewDonations(read: ReadDonations, lookups: DonationLookups, choices: DonationChoices = NO_DONATION_CHOICES): DonationReview {
  // What the ticked rows above have paid on each pledge: each row is planned as the database will run it, after them.
  const paidSoFar = new Map<string, number>();
  const earlier: { householdId: string; amountCents: number; receivedOn: string; method: string; check: string | null; line: number }[] = [];
  const rows: DonationRow[] = read.lines.map((l) => {
    const problems = [...l.problems];
    const warnings: string[] = [];
    let family: Family | null = null;
    let via: string | null = null;
    let candidates: Family[] = [];
    let needsPick = false;
    if (l.household) {
      const m = matchHousehold(l.household, lookups.hits, lookups.labels);
      if (m.status === "matched") {
        family = m.family;
        via = m.via;
      } else if (m.status === "pick") {
        candidates = m.candidates;
        const chosen = m.candidates.find((c) => c.id === choices.picks[l.line]);
        if (chosen) {
          family = chosen;
          via = "Picked by you";
        } else {
          needsPick = true;
          warnings.push(pickReason(m, l.household));
        }
      } else {
        problems.push(`No ${lookups.household} has the ID “${l.household}”, and no ${lookups.household} name matches it. Check the ID.`);
      }
    }

    // The same checks and words as the Record payment sheet.
    let checkNumber: string | null = null;
    let memo: string | null = null;
    if (family && l.amountCents !== null && l.method && l.receivedOn) {
      const c = checkOfflinePayment(
        {
          householdId: family.id,
          amount: (l.amountCents / 100).toFixed(2),
          method: l.method,
          receivedOn: l.receivedOn,
          reference: l.reference,
          envelopeNumber: l.envelope,
          memo: l.note,
          allocation: "auto",
        },
        lookups.today,
        "record this row",
      );
      if (!c.ok) problems.push(c.error);
      else {
        checkNumber = c.value.checkNumber;
        memo = c.value.memo;
      }
    }

    // What it pays: a pledge named, the household's open pledges for a fund or campaign, none, or the oldest open pledges first.
    let mode: AllocationMode = "auto";
    let chosen: string[] | null = null;
    const pledges = (family ? (lookups.pledges[family.id] ?? []) : []).map((p) => ({ ...p, paid_cents: p.paid_cents + (paidSoFar.get(p.id) ?? 0) }));
    if (family && l.applyTo) {
      if (NONE_WORDS.has(norm(l.applyTo))) mode = "none";
      else {
        const p = pledges.find((x) => (x.pledge_number ?? "").toLowerCase() === norm(l.applyTo));
        if (!p) problems.push(`Apply to: ${l.applyTo.trim()} is not an open pledge of this ${lookups.household}. Write its pledge number as Giving shows it, “none” for a general gift, or leave it empty.`);
        else {
          mode = "choose";
          chosen = [p.id];
        }
      }
    } else if (family && l.forText) {
      const t = findTarget(l.forText, lookups.targets.filter((x) => x.kind !== "opportunity"));
      if (!t.ok) problems.push(t.error.replace("No fund, campaign or opportunity open for pledges", "No fund or campaign"));
      else if (t.target) {
        const matching = pledges.filter((p) => p.amount_cents > p.paid_cents && (t.target!.kind === "campaign" ? p.campaignId === t.target!.id : p.fundId === t.target!.id));
        if (matching.length > 0) {
          mode = "choose";
          chosen = matching.sort((a, b) => a.pledged_at.localeCompare(b.pledged_at)).map((p) => p.id);
        } else {
          mode = "none";
          memo = [memo, `For: ${t.target.name}`].filter(Boolean).join(" · ").slice(0, 500);
          warnings.push(`No open pledge for ${t.target.name}: recorded as a general gift, with “For: ${t.target.name}” in the memo.`);
        }
      }
    }
    let after: string[] = [];
    let allocations: PlannedLine[] = [];
    if (family && l.amountCents !== null && problems.length === 0) {
      const plan = planDraftAllocation({ amountCents: l.amountCents, pledges, mode, chosen, canAllocate: lookups.canAllocate, currency: lookups.currency });
      after = lookups.canAllocate ? plan.after : ["Recorded but not applied: a treasurer can apply it to the family's pledges."];
      allocations = lookups.canAllocate ? plan.stored : [];
      if (lookups.canAllocate && plan.questions.some((q) => q.kind === "not_a_gift")) {
        warnings.push(plan.questions.find((q) => q.kind === "not_a_gift")!.question);
      }
    }

    // Repeats: what the database found (for the household the file named), the Zelle check, and an earlier ticked row of this file.
    let repeatOf: string | null = null;
    if (family && l.amountCents !== null && l.method && l.receivedOn && problems.length === 0) {
      const db = via !== "Picked by you" ? lookups.repeats.find((r) => r.line === l.line) : undefined;
      const z = l.method === "zelle" && via !== "Picked by you" ? lookups.zelle.find((r) => r.line === l.line) : undefined;
      const twin = earlier.find(
        (e) =>
          e.householdId === family!.id &&
          ((e.amountCents === l.amountCents && e.receivedOn === l.receivedOn && e.method === l.method) ||
            (l.method === "check" && checkNumber && e.method === "check" && e.check === checkNumber)),
      );
      if (db) repeatOf = db.receiptNumber ? `receipt ${db.receiptNumber}` : "a payment already recorded";
      else if (twin) repeatOf = `line ${twin.line} of this file`;
      if (repeatOf) warnings.push(`Looks like a repeat of ${repeatOf}: the same ${lookups.household}, amount, day and method${l.method === "check" ? " (or check number)" : ""}. Tick it only if it is a second payment.`);
      if (z) {
        repeatOf = repeatOf ?? "a Zelle already recorded or reported";
        warnings.push(`A Zelle of this amount from this ${lookups.household} was ${z.what}. Tick it only if this is a different payment.`);
      }
    }
    if (family && l.nameCheck && nameDisagrees(l.nameCheck, family)) {
      warnings.push(`The name in the file (“${l.nameCheck}”) does not match ${familyRef(family)}. Check the ID before ticking it.`);
    }

    const status: DonationStatus = problems.length > 0 ? "problem" : needsPick ? "pick" : repeatOf ? "repeat" : warnings.length > 0 ? "check" : "ready";
    const ticked = status === "problem" || status === "pick" ? false : (choices.ticks[l.line] ?? status === "ready");
    if (ticked && family && l.amountCents !== null && l.method && l.receivedOn) {
      earlier.push({ householdId: family.id, amountCents: l.amountCents, receivedOn: l.receivedOn, method: l.method, check: checkNumber, line: l.line });
      for (const a of allocations) paidSoFar.set(a.pledge_id, (paidSoFar.get(a.pledge_id) ?? 0) + a.amount_cents);
    }
    if (status !== "problem" && !lookups.canAllocate) after = ["Recorded but not applied: a treasurer can apply it to the family's pledges."];
    return {
      line: l.line,
      status,
      ticked,
      family,
      via,
      candidates,
      amountCents: l.amountCents,
      method: l.method,
      receivedOn: l.receivedOn,
      checkNumber,
      envelope: l.envelope || null,
      memo,
      note: l.note,
      mode,
      after,
      allocations: ticked ? allocations : [],
      problems,
      warnings,
      repeatOf,
    };
  });
  const counts: Record<DonationStatus, number> = { ready: 0, pick: 0, check: 0, repeat: 0, problem: 0 };
  for (const r of rows) counts[r.status] += 1;
  const ticked = rows.filter((r) => r.ticked);
  return {
    rows,
    counts,
    tickedCount: ticked.length,
    tickedCents: ticked.reduce((s, r) => s + (r.amountCents ?? 0), 0),
    appliedCents: ticked.reduce((s, r) => s + r.allocations.reduce((t, a) => t + a.amount_cents, 0), 0),
  };
}

export function donationSummary(r: DonationReview): string {
  const parts = [`${r.counts.ready} ready`];
  if (r.counts.pick) parts.push(`${r.counts.pick} to pick`);
  if (r.counts.check) parts.push(`${r.counts.check} to check`);
  if (r.counts.repeat) parts.push(rowsWord(r.counts.repeat, "possible repeat"));
  if (r.counts.problem) parts.push(rowsWord(r.counts.problem, "problem"));
  return parts.join(" · ");
}

/** The button names how many and how much: "Record 40 payments, $8,120.00". */
export function donationButtonLabel(r: DonationReview, currency: string, locale: string): string {
  if (r.tickedCount === 0) return "Tick the rows to record";
  return `Record ${rowsWord(r.tickedCount, "payment")}, ${formatCents(r.tickedCents, currency, locale)}`;
}

/** What the database records: the ticked rows, each exactly as the review showed it. */
export type DonationUploadRow = {
  row: number;
  household_id: string;
  amount_cents: number;
  method: OfflineMethod;
  received_on: string;
  check_number: string | null;
  envelope_number: string | null;
  memo: string | null;
  note: string | null;
  allocations: PlannedLine[];
  repeat_ok: boolean;
};

export function donationUploadRows(r: DonationReview): DonationUploadRow[] {
  return r.rows
    .filter((x) => x.ticked && x.family && x.amountCents !== null && x.method && x.receivedOn && x.status !== "problem" && x.status !== "pick")
    .map((x) => ({
      row: x.line,
      household_id: x.family!.id,
      amount_cents: x.amountCents!,
      method: x.method!,
      received_on: x.receivedOn!,
      check_number: x.checkNumber,
      envelope_number: x.envelope,
      memo: x.memo,
      note: x.note || null,
      allocations: x.allocations,
      repeat_ok: x.repeatOf !== null,
    }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const optText = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);
const cents = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** The rows as the server receives them, checked for shape before they go to the database (which checks every rule again). */
export function checkDonationRows(rows: unknown, today: string): { ok: true; value: DonationUploadRow[] } | { ok: false; error: string } {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Tick at least one row to record." };
  if (rows.length > MAX_UPLOAD_ROWS) return { ok: false, error: `An upload holds at most ${MAX_UPLOAD_ROWS} rows.` };
  const bad = { ok: false as const, error: "The review changed while it was being sent. Check the file again, then record." };
  const seen = new Set<number>();
  const out: DonationUploadRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r !== "object" || r === null) return bad;
    const row = r.row;
    if (typeof row !== "number" || !Number.isInteger(row) || row < 1 || seen.has(row)) return bad;
    if (typeof r.household_id !== "string" || !UUID.test(r.household_id)) return bad;
    if (!cents(r.amount_cents) || (r.amount_cents as number) <= 0) return bad;
    if (typeof r.method !== "string" || !(OFFLINE_METHODS as readonly string[]).includes(r.method)) return bad;
    if (typeof r.received_on !== "string" || !DAY.test(r.received_on) || r.received_on > today) return bad;
    if (!optText(r.check_number, 40) || !optText(r.envelope_number, 40) || !optText(r.memo, 500) || !optText(r.note, NOTE_MAX)) return bad;
    if (typeof r.repeat_ok !== "boolean" || !Array.isArray(r.allocations)) return bad;
    let sum = 0;
    const allocations: PlannedLine[] = [];
    for (const a of r.allocations as Record<string, unknown>[]) {
      if (typeof a !== "object" || a === null || typeof a.pledge_id !== "string" || !UUID.test(a.pledge_id)) return bad;
      if (!cents(a.amount_cents) || (a.amount_cents as number) <= 0 || !cents(a.pledge_amount_cents) || !cents(a.pledge_paid_cents)) return bad;
      sum += a.amount_cents as number;
      allocations.push({
        pledge_id: a.pledge_id,
        amount_cents: a.amount_cents as number,
        pledge_amount_cents: a.pledge_amount_cents as number,
        pledge_paid_cents: a.pledge_paid_cents as number,
      });
    }
    if (sum > (r.amount_cents as number)) return bad;
    seen.add(row);
    out.push({
      row,
      household_id: (r.household_id as string).toLowerCase(),
      amount_cents: r.amount_cents as number,
      method: r.method as OfflineMethod,
      received_on: r.received_on,
      check_number: (r.check_number as string | null) ?? null,
      envelope_number: (r.envelope_number as string | null) ?? null,
      memo: (r.memo as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      allocations,
      repeat_ok: r.repeat_ok,
    });
  }
  return { ok: true, value: out };
}

/** The rows the database checks for repeats: each with the household the file named. */
export function repeatProbe(read: ReadDonations, lookups: Pick<DonationLookups, "hits" | "labels">): { row: number; household_id: string; amount_cents: number; received_on: string; method: string; check_number: string | null }[] {
  const out: { row: number; household_id: string; amount_cents: number; received_on: string; method: string; check_number: string | null }[] = [];
  for (const l of read.lines) {
    if (!l.household || l.amountCents === null || !l.method || !l.receivedOn) continue;
    const m = matchHousehold(l.household, lookups.hits, lookups.labels);
    if (m.status !== "matched") continue;
    out.push({
      row: l.line,
      household_id: m.family.id,
      amount_cents: l.amountCents,
      received_on: l.receivedOn,
      method: l.method,
      check_number: l.method === "check" ? l.reference.replace(/^#/, "").trim().slice(0, 40) || null : null,
    });
  }
  return out;
}

export const DONATION_REASONS = ["Sunday collection", "Checks received by mail", "Bank transfers", "Event donations"] as const;

export const DONATION_UPLOAD_NO_UNDO =
  "This cannot be undone here. A row recorded by mistake is fixed with a refund that a second person approves. No receipt is emailed by the upload.";

export { dateExample };
