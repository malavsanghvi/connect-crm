// Upload pledges (GV-U slice B; owner ask 2026-10-13: "giving should allow bulk upload of pledges"). Pure: the template, reading
// the rows, and the review the person confirms. The same checks run in the browser (as the person picks households and ticks rows)
// and on the server before anything is sent to the database, which checks every row again (app.record_pledge_upload, 0776, through
// the rules of recording a pledge by hand, 0745/0775).
//
// A row is a pledge of a household: found by an identifier of any kind, never by a name alone (a name, or an ID two households
// share, is a pick with the household card). The person who pledged is an adult of that household or nobody; a child is never
// named (a name that is not an adult's is a problem, and the problem does not repeat the name). Every pledge has a due date: the
// file's, or the community's default. A row that looks like a pledge already recorded (same household, amount, purpose and day)
// is left unticked until the person says "Record anyway".

import { familyRef, type Family } from "@/lib/giving-today/queue";
import { formatCents } from "@/lib/money";
import type { CardLabels } from "@/components/household-card";

import { matchHousehold, nameDisagrees, pickReason, type HouseholdHit } from "./households";
import {
  MAX_UPLOAD_ROWS as MAX_ROWS,
  addDays,
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

export type PledgeColumn = "household" | "name_check" | "amount" | "for" | "pledged_on" | "due_on" | "pledged_by" | "dedication" | "note";

export const DEDICATION_MAX = 200;
export const NOTE_MAX = 300;

/** The columns, in the community's words (`household`: "Household", "Family", "Member"…). */
export function pledgeColumns(words: { household: string }): ColumnSpec<PledgeColumn>[] {
  const hh = cap(words.household);
  return [
    {
      key: "household",
      header: `${hh} ID`,
      required: true,
      synonyms: [
        "household", "household id", "household number", "household no", "family id", "family number", "member id", "member number",
        "member no", "id", "identifier", "donor id", "account", "account id", "account number", "constituent id", "customer", "customer id",
        "envelope number", "family", "donor", "household name", "family name", "donor name",
      ],
      help: `Any ID of the ${words.household}: its number, a member's number, your own IDs, the old system's or the accounting system's. A name works too, but you then pick the ${words.household} yourself.`,
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
      synonyms: ["pledge", "pledge amount", "pledged", "amount pledged", "total", "commitment", "value"],
      help: "The amount pledged, in your community's currency.",
    },
    {
      key: "for",
      header: "For",
      required: false,
      synonyms: ["fund", "campaign", "opportunity", "purpose", "designation", "appeal", "project", "fund or campaign"],
      help: "Optional. The name of a fund, campaign or opportunity exactly as Giving shows it. Empty: a general pledge.",
    },
    {
      key: "pledged_on",
      header: "Pledged on",
      required: false,
      synonyms: ["pledge date", "date pledged", "date", "made on", "pledged"],
      help: "Optional. The day the pledge was made. Empty: today.",
    },
    {
      key: "due_on",
      header: "Due on",
      required: false,
      synonyms: ["due", "due date", "pay by", "payable by", "due by"],
      help: "Optional. When it is due. Empty: your community's default.",
    },
    {
      key: "pledged_by",
      header: "Pledged by",
      required: false,
      synonyms: ["pledger", "person", "member", "member name", "pledged by name"],
      help: `Optional. The adult of the ${words.household} who pledged (a name or a member ID). Empty: the ${words.household}.`,
    },
    {
      key: "dedication",
      header: "Dedication",
      required: false,
      synonyms: ["in memory of", "in honor of", "in honour of", "tribute"],
      help: `Optional. At most ${DEDICATION_MAX} characters.`,
    },
    {
      key: "note",
      header: "Note",
      required: false,
      synonyms: ["notes", "comment", "comments", "memo", "remarks"],
      help: `Optional. Added to the reason in the ${words.household}'s History. At most ${NOTE_MAX} characters.`,
    },
  ];
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The template: the headings and two example rows in the community's own money and date conventions. */
export function pledgeTemplateRows(words: { household: string }, conv: Conventions, example: { forName: string | null }): string[][] {
  const cols = pledgeColumns(words);
  const money = (cents: number) => (conv.decimal === "," ? (cents / 100).toFixed(2).replace(".", ",") : (cents / 100).toFixed(2));
  const day = conv.dateOrder === "mdy" ? "10/12/2026" : "12/10/2026";
  const due = conv.dateOrder === "mdy" ? "12/31/2026" : "31/12/2026";
  const values: Record<PledgeColumn, [string, string]> = {
    household: ["0127", "M-0417"],
    name_check: ["Adeyemi", "Okafor"],
    amount: [money(50_000), money(125_050)],
    for: [example.forName ?? "", ""],
    pledged_on: [day, day],
    due_on: [due, ""],
    pledged_by: ["", ""],
    dedication: ["", "In memory of our parents"],
    note: ["Pledge card", "By phone"],
  };
  return [cols.map((c) => c.header), cols.map((c) => values[c.key][0]), cols.map((c) => values[c.key][1])];
}

// ---------------------------------------------------------------------------------------------------------------------- Rows

/** One row as read from the file, before anything is looked up. */
export type PledgeLine = {
  /** The line in the file (the heading is line 1 when it is the first line). */
  line: number;
  household: string;
  nameCheck: string;
  amountCents: number | null;
  forText: string;
  pledgedOn: string | null;
  dueOn: string | null;
  pledgedBy: string;
  dedication: string;
  note: string;
  /** What is wrong with the row itself, in plain words. */
  problems: string[];
};

export type ReadPledges = { columns: ColumnMap<PledgeColumn>; lines: PledgeLine[]; fileProblems: string[] };

/** Read the rows. `today` is the community's day (YYYY-MM-DD). */
export function readPledgeLines(table: UploadTable, conv: Conventions, today: string, words: { household: string }): ReadPledges {
  const specs = pledgeColumns(words);
  const columns = mapColumns(table.headers, specs);
  const fileProblems: string[] = [];
  for (const k of columns.missing) {
    const spec = specs.find((s) => s.key === k)!;
    fileProblems.push(`The file has no “${spec.header}” column. Download the template to see the columns.`);
  }
  const lines: PledgeLine[] = table.rows.map(({ line, cells }) => {
    const get = (k: PledgeColumn) => cell(cells, columns, k);
    const problems: string[] = [];
    const household = get("household");
    if (!household) problems.push(`No ${words.household}: write an ID (or a name, and pick the ${words.household}).`);
    let amountCents: number | null = null;
    const a = readAmount(get("amount"), conv, table.source);
    if (a.ok) amountCents = a.value;
    else problems.push(`Amount ${a.error}.`);
    let pledgedOn: string | null = null;
    if (get("pledged_on")) {
      const d = readDate(get("pledged_on"), conv);
      if (!d.ok) problems.push(`Pledged on ${d.error}.`);
      else if (d.value > today) problems.push("Pledged on is in the future: a pledge is recorded on or after the day it was made.");
      else if (!withinTenYears(d.value, today)) problems.push("Pledged on is more than ten years ago.");
      else pledgedOn = d.value;
    }
    let dueOn: string | null = null;
    if (get("due_on")) {
      const d = readDate(get("due_on"), conv);
      if (!d.ok) problems.push(`Due on ${d.error}.`);
      else if (!withinTenYears(d.value, today)) problems.push("Due on must be within ten years of today.");
      else if (d.value < (pledgedOn ?? today)) problems.push("Due on is before the day it was pledged.");
      else dueOn = d.value;
    }
    const dedication = get("dedication");
    if (dedication.length > DEDICATION_MAX) problems.push(`Dedication is longer than ${DEDICATION_MAX} characters.`);
    const note = get("note");
    if (note.length > NOTE_MAX) problems.push(`Note is longer than ${NOTE_MAX} characters.`);
    return {
      line,
      household,
      nameCheck: get("name_check"),
      amountCents,
      forText: get("for"),
      pledgedOn,
      dueOn,
      pledgedBy: get("pledged_by"),
      dedication,
      note,
      problems,
    };
  });
  return { columns, lines, fileProblems };
}

/** The values the database looks up: every household value, and every "pledged by" value (a member ID names a person). */
export function lookupValues(lines: readonly PledgeLine[]): string[] {
  return [...new Set(lines.flatMap((l) => [l.household, l.pledgedBy]).map((v) => v.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------------------------------------------------- Review

export type PledgeTarget = { kind: "fund" | "campaign" | "opportunity"; id: string; name: string };
export type UploadAdult = { id: string; name: string };
/** A pledge already recorded, for the repeat check: its household, amount, purpose and the community's day it was made. */
export type ExistingPledge = {
  number: string | null;
  householdId: string;
  amountCents: number;
  campaignId: string | null;
  fundId: string | null;
  opportunityId: string | null;
  pledgedOn: string;
};

/** Everything the review needs, read on the server with the person's own access. */
export type PledgeLookups = {
  today: string;
  dueDays: number;
  currency: string;
  locale: string;
  labels: CardLabels;
  household: string;
  hits: HouseholdHit[];
  /** Funds in use, campaigns a pledge can be recorded to, and (when Opportunities is on) open opportunities. */
  targets: PledgeTarget[];
  /** The adults of every household a row matched or may be picked as (never a child). */
  adults: Record<string, UploadAdult[]>;
  existing: ExistingPledge[];
};

export type RowStatus = "ready" | "pick" | "check" | "repeat" | "problem";

export type ReviewRow = {
  line: number;
  status: RowStatus;
  /** Ticked rows are recorded. A problem or a pick is never ticked; a repeat or a check waits for the person. */
  ticked: boolean;
  family: Family | null;
  via: string | null;
  candidates: Family[];
  amountCents: number | null;
  target: PledgeTarget | null;
  forLabel: string;
  pledgedOn: string;
  dueOn: string;
  dueIsDefault: boolean;
  pledgedBy: UploadAdult | null;
  dedication: string;
  note: string;
  /** Why the row is not ready, in plain words. */
  problems: string[];
  /** What the person should look at before ticking it. */
  warnings: string[];
  repeatOf: string | null;
};

export type PledgeReview = {
  rows: ReviewRow[];
  counts: Record<RowStatus, number>;
  tickedCount: number;
  tickedCents: number;
};

/** What the person decided: a household for a row that needed a pick, and rows ticked or unticked by hand. */
export type ReviewChoices = { picks: Record<number, string>; ticks: Record<number, boolean> };

export const NO_CHOICES: ReviewChoices = { picks: {}, ticks: {} };

const norm = (s: string) => s.trim().toLowerCase().normalize("NFKC").replace(/\s+/g, " ");

/** What "For" names: an opportunity, then a campaign, then a fund (by name or by key). Empty is a general pledge. */
export function findTarget(text: string, targets: readonly PledgeTarget[]): { ok: true; target: PledgeTarget | null } | { ok: false; error: string } {
  const t = norm(text);
  if (!t) return { ok: true, target: null };
  for (const kind of ["opportunity", "campaign", "fund"] as const) {
    const same = targets.filter((x) => x.kind === kind && norm(x.name) === t);
    if (same.length === 1) return { ok: true, target: same[0] };
    if (same.length > 1) return { ok: false, error: `Two ${kind === "opportunity" ? "opportunities" : `${kind}s`} are called “${text.trim()}”. Rename one in Giving first.` };
  }
  return { ok: false, error: `No fund, campaign or opportunity open for pledges is called “${text.trim()}”. Write it as Giving shows it, or leave it empty for a general pledge.` };
}

/** The adult a "Pledged by" value names: a person ID that is one of the household's adults, or an adult's full or first name. */
export function findAdult(
  value: string,
  householdId: string,
  lookups: Pick<PledgeLookups, "adults" | "hits">,
): { ok: true; adult: UploadAdult | null } | { ok: false; error: string } {
  const v = norm(value);
  if (!v) return { ok: true, adult: null };
  const adults = lookups.adults[householdId] ?? [];
  const byId = lookups.hits.filter((h) => h.input === value.trim() && h.personId).map((h) => h.personId!);
  const viaId = adults.filter((a) => byId.includes(a.id));
  if (viaId.length === 1) return { ok: true, adult: viaId[0] };
  const full = adults.filter((a) => norm(a.name) === v);
  if (full.length === 1) return { ok: true, adult: full[0] };
  const first = adults.filter((a) => norm(a.name).split(" ")[0] === v);
  if (first.length === 1) return { ok: true, adult: first[0] };
  // The name is not repeated: it may be a child's.
  return { ok: false, error: "Pledged by is not one adult of this household. Write an adult's full name or member ID, or leave it empty to record the pledge for the household." };
}

function sameTarget(e: ExistingPledge, t: PledgeTarget | null): boolean {
  if (!t) return !e.campaignId && !e.fundId && !e.opportunityId;
  if (t.kind === "opportunity") return e.opportunityId === t.id;
  if (t.kind === "campaign") return e.campaignId === t.id;
  return e.fundId === t.id && !e.campaignId;
}

/** The review: every row with its household, purpose, dates, pledger and what stops it, given the person's choices so far. */
export function reviewPledges(read: ReadPledges, lookups: PledgeLookups, choices: ReviewChoices = NO_CHOICES): PledgeReview {
  const earlier: { householdId: string; amountCents: number; target: PledgeTarget | null; pledgedOn: string; line: number }[] = [];
  const rows: ReviewRow[] = read.lines.map((l) => {
    const problems = [...l.problems];
    const warnings: string[] = [];
    let family: Family | null = null;
    let via: string | null = null;
    let candidates: Family[] = [];
    let needsPick = false;
    let viaPerson: string | null = null;
    if (l.household) {
      const m = matchHousehold(l.household, lookups.hits, lookups.labels);
      if (m.status === "matched") {
        family = m.family;
        via = m.via;
        viaPerson = m.personId;
      } else if (m.status === "pick") {
        candidates = m.candidates;
        const picked = choices.picks[l.line];
        const chosen = picked ? m.candidates.find((c) => c.id === picked) : undefined;
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
    const target = findTarget(l.forText, lookups.targets);
    if (!target.ok) problems.push(target.error);
    const t = target.ok ? target.target : null;
    const pledgedOn = l.pledgedOn ?? lookups.today;
    const dueIsDefault = l.dueOn === null;
    const dueOn = l.dueOn ?? addDays(pledgedOn, lookups.dueDays);
    let pledgedBy: UploadAdult | null = null;
    if (family) {
      if (l.pledgedBy) {
        const a = findAdult(l.pledgedBy, family.id, lookups);
        if (a.ok) pledgedBy = a.adult;
        else problems.push(a.error);
      } else if (viaPerson) {
        // Found by a member's own ID: that member pledged, when they are an adult of the household (never a child).
        pledgedBy = (lookups.adults[family.id] ?? []).find((a) => a.id === viaPerson) ?? null;
      }
    }
    let repeatOf: string | null = null;
    if (family && l.amountCents !== null && problems.length === 0) {
      const old = lookups.existing.find(
        (e) => e.householdId === family!.id && e.amountCents === l.amountCents && e.pledgedOn === pledgedOn && sameTarget(e, t),
      );
      const twin = earlier.find((e) => e.householdId === family!.id && e.amountCents === l.amountCents && e.pledgedOn === pledgedOn && e.target?.id === t?.id);
      if (old) repeatOf = old.number ?? "a pledge already recorded";
      else if (twin) repeatOf = `line ${twin.line} of this file`;
      if (repeatOf) warnings.push(`Looks like a repeat of ${repeatOf}: the same ${lookups.household}, amount, purpose and day. Tick it only if it is a second pledge.`);
    }
    if (family && l.nameCheck && nameDisagrees(l.nameCheck, family)) {
      warnings.push(`The name in the file (“${l.nameCheck}”) does not match ${familyRef(family)}. Check the ID before ticking it.`);
    }
    const status: RowStatus = problems.length > 0 ? "problem" : needsPick ? "pick" : repeatOf ? "repeat" : warnings.length > 0 ? "check" : "ready";
    const defaultTick = status === "ready";
    const ticked = status === "problem" || status === "pick" ? false : (choices.ticks[l.line] ?? defaultTick);
    if (ticked && family && l.amountCents !== null) earlier.push({ householdId: family.id, amountCents: l.amountCents, target: t, pledgedOn, line: l.line });
    return {
      line: l.line,
      status,
      ticked,
      family,
      via,
      candidates,
      amountCents: l.amountCents,
      target: t,
      forLabel: t ? t.name : l.forText ? `“${l.forText}” (not found)` : "General (no fund)",
      pledgedOn,
      dueOn,
      dueIsDefault,
      pledgedBy,
      dedication: l.dedication,
      note: l.note,
      problems,
      warnings,
      repeatOf,
    };
  });
  const counts: Record<RowStatus, number> = { ready: 0, pick: 0, check: 0, repeat: 0, problem: 0 };
  for (const r of rows) counts[r.status] += 1;
  const ticked = rows.filter((r) => r.ticked);
  return { rows, counts, tickedCount: ticked.length, tickedCents: ticked.reduce((s, r) => s + (r.amountCents ?? 0), 0) };
}

/** The sentence over the review: "18 ready · 2 to pick · 1 problem". */
export function reviewSummary(r: PledgeReview): string {
  const parts = [`${r.counts.ready} ready`];
  if (r.counts.pick) parts.push(`${r.counts.pick} to pick`);
  if (r.counts.check) parts.push(`${r.counts.check} to check`);
  if (r.counts.repeat) parts.push(`${rowsWord(r.counts.repeat, "possible repeat")}`);
  if (r.counts.problem) parts.push(rowsWord(r.counts.problem, "problem"));
  return parts.join(" · ");
}

/** The button: it names how many and how much ("Record 18 pledges, $24,500.00"). */
export function recordButtonLabel(r: PledgeReview, currency: string, locale: string): string {
  if (r.tickedCount === 0) return "Tick the rows to record";
  return `Record ${rowsWord(r.tickedCount, "pledge")}, ${formatCents(r.tickedCents, currency, locale)}`;
}

/** What the database records: the ticked rows, each with the household and purpose the person saw. */
export type PledgeUploadRow = {
  row: number;
  household_id: string;
  amount_cents: number;
  fund_id: string | null;
  campaign_id: string | null;
  opportunity_id: string | null;
  pledged_on: string;
  due_on: string;
  pledged_by_person_id: string | null;
  dedication: string | null;
  note: string | null;
  repeat_ok: boolean;
};

export function uploadRows(r: PledgeReview): PledgeUploadRow[] {
  return r.rows
    .filter((x) => x.ticked && x.family && x.amountCents !== null && x.status !== "problem" && x.status !== "pick")
    .map((x) => ({
      row: x.line,
      household_id: x.family!.id,
      amount_cents: x.amountCents!,
      fund_id: x.target?.kind === "fund" ? x.target.id : null,
      campaign_id: x.target?.kind === "campaign" ? x.target.id : null,
      opportunity_id: x.target?.kind === "opportunity" ? x.target.id : null,
      pledged_on: x.pledgedOn,
      due_on: x.dueOn,
      pledged_by_person_id: x.pledgedBy?.id ?? null,
      dedication: x.dedication || null,
      note: x.note || null,
      repeat_ok: x.repeatOf !== null,
    }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const optUuid = (v: unknown) => v === null || v === undefined || (typeof v === "string" && UUID.test(v));
const optText = (v: unknown, max: number) => v === null || v === undefined || (typeof v === "string" && v.length <= max);

/**
 * The rows as the server receives them, checked for shape before they go to the database (which checks every rule again). Anything
 * unexpected is refused as a whole: the review is sent again rather than a part of it recorded.
 */
export function checkUploadRows(rows: unknown, today: string): { ok: true; value: PledgeUploadRow[] } | { ok: false; error: string } {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: "Tick at least one row to record." };
  if (rows.length > MAX_ROWS) return { ok: false, error: `An upload holds at most ${MAX_ROWS} rows.` };
  const seen = new Set<number>();
  const out: PledgeUploadRow[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const row = r?.row;
    const ok =
      typeof r === "object" &&
      r !== null &&
      typeof row === "number" &&
      Number.isInteger(row) &&
      row >= 1 &&
      !seen.has(row) &&
      typeof r.household_id === "string" &&
      UUID.test(r.household_id) &&
      typeof r.amount_cents === "number" &&
      Number.isSafeInteger(r.amount_cents) &&
      r.amount_cents > 0 &&
      optUuid(r.fund_id) &&
      optUuid(r.campaign_id) &&
      optUuid(r.opportunity_id) &&
      [r.fund_id, r.campaign_id, r.opportunity_id].filter(Boolean).length <= 1 &&
      typeof r.pledged_on === "string" &&
      DAY.test(r.pledged_on) &&
      r.pledged_on <= today &&
      typeof r.due_on === "string" &&
      DAY.test(r.due_on) &&
      r.due_on >= r.pledged_on &&
      optUuid(r.pledged_by_person_id) &&
      optText(r.dedication, DEDICATION_MAX) &&
      optText(r.note, NOTE_MAX) &&
      typeof r.repeat_ok === "boolean";
    if (!ok) return { ok: false, error: "The review changed while it was being sent. Check the file again, then record." };
    seen.add(row as number);
    out.push({
      row: row as number,
      household_id: (r.household_id as string).toLowerCase(),
      amount_cents: r.amount_cents as number,
      fund_id: (r.fund_id as string | null) ?? null,
      campaign_id: (r.campaign_id as string | null) ?? null,
      opportunity_id: (r.opportunity_id as string | null) ?? null,
      pledged_on: r.pledged_on as string,
      due_on: r.due_on as string,
      pledged_by_person_id: (r.pledged_by_person_id as string | null) ?? null,
      dedication: (r.dedication as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      repeat_ok: r.repeat_ok as boolean,
    });
  }
  return { ok: true, value: out };
}

/** The reason every pledge's History shows, with the file it came from. */
export const UPLOAD_REASONS = ["Pledge cards", "Pledges from the event", "Pledges brought over from a spreadsheet"] as const;

export const PLEDGE_UPLOAD_NO_UNDO =
  "No money moves. The whole upload can be cancelled from this page while nothing has been paid against any of its pledges; after that, each pledge is handled on its own.";

export { dateExample };
