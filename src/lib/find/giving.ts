// The Giving lane of the one find box (docs/GIVING_REDESIGN.md section 4, "The one box"; docs/UNIFIED_BOX.md section 5, Giving
// re-pointed without losing the parser). BY RULES, on the page: no model. It reads what was typed into what the person wants
// ("200 check patel" is a check to record; "R-2026-0388" a receipt or pledge number; "refund R-2026-0388" a refund to ask for) and
// turns what the database found into rows. Pure: the server lookup (src/lib/data/find-giving.ts), the dev preview and the tests use it.
//
// NOTHING HERE SAVES. A row only ever opens something: the Record payment sheet filled in (whose own button records), a family's
// giving, or a list. Every row about a family carries its household card line, never a name alone, and a child is never named.
// Built for every organization: no community's words, numbers or currency are assumed (receipt and pledge numbers are matched by
// shape, not by a prefix, and amounts are read in the community's own number convention).

import type { HouseholdCard } from "@/lib/commands/types";
import { currencySymbol, type CommunityFormat } from "@/lib/community-format";
import { formatDate } from "@/lib/dates";
import type { PledgeDesignation, RecordPledgeRequest } from "@/lib/giving-actions/record-pledge";
import { householdRef, methodWord, type RecordPaymentRequest } from "@/lib/giving-actions/record-sheet";
import {
  paymentDetail,
  paymentTitle,
  pledgeDetail,
  pledgeTitle,
  statusWord,
  type FamilyFocus,
  type GivingHousehold,
} from "@/lib/giving-actions/family-giving";
import { quickCreateHref, readCreateCommand, type CreateCommand } from "@/lib/giving-campaigns/quick";
import type { GivingExportList } from "@/lib/giving-export/csv";
import { familyFrom } from "@/lib/giving-today/queue";
import { parsePaymentAsk, readDate, type PaymentAsk } from "@/lib/giving-workspace/ask";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { isQuestion, squeeze } from "./classify";
import { householdCardLine } from "./labels";

/** Where the box is: on Giving pages a family opens its giving and the Giving rows come first; elsewhere a family opens its page. */
export type FindScope = "people" | "giving";

export type GivingIntent =
  /** Record a payment: the Record payment sheet opens filled in. `who` is what to look the family up by (never used to pick one). */
  | { kind: "record"; ask: PaymentAsk; who: string | null; cents: number | null }
  /** Record a pledge: the Record pledge sheet opens filled in (slice 7). `who` holds the family and fund words ("patel building fund"). */
  | { kind: "pledge"; cents: number | null; who: string | null }
  /** Ask for a refund: Payments opens on that receipt. */
  | { kind: "refund"; token: string | null; who: string | null }
  /** Ask for a write-off: Pledges opens on that pledge. */
  | { kind: "write_off"; token: string | null; who: string | null }
  /** "new campaign Building fund", "new opportunity Gala tables": the quick-create sheet opens, named (slice 6). */
  | { kind: "create"; cmd: CreateCommand }
  /** "export payments 2026": the list opens, filtered, with its Export sheet open (slice 9). Nothing is exported until its button. */
  | { kind: "export"; list: GivingExportList; year: number | null }
  /** Find: a receipt or pledge number, an amount (on a date), or words (campaigns, bank descriptions and payer names). */
  | { kind: "lookup"; code: string | null; numbered: { field: "receipt" | "pledge"; value: string } | null; cents: number | null; date: string | null; words: string | null };

const PAYMENT_VERB = /\b(?:record(?:ed)?|receiv(?:e|ed)|got|paid|pays?|gave|gifts?|donations?|donated|payments?)\b/i;
const REFUND = /\brefund(?:s|ed)?\b/i;
const WRITE_OFF = /\bwrite[\s-]?offs?\b|\bwritten[\s-]off\b/i;
const PLEDGE_START = /^(?:(?:record|add|new|make)\s+(?:a\s+)?)?pledge[ds]?\b/i;
const NUMBERED = /\b(receipt|rcpt|pledge)\s*(?:number|no\.?|num\.?|#)?\s*:?\s*#?\s*(\d{2,20})\b/i;
/** "ref ZL88412", "confirmation 7781-A": a payment's own reference (a check number is read by the payment reader itself). */
const REF_WORD = /\b(?:ref(?:erence)?|confirmation|conf|txn|transaction)\s*(?:number|no\.?|num\.?|id|#)?\s*:?\s*#?\s*([A-Za-z0-9][A-Za-z0-9-]{0,39})\b/i;

/** Words that only carry the sentence; what is left after them is who the payment is from. */
const FILLER = new Set(
  (
    "record recorded receive received got paid pay pays gave gift gifts donation donations donated payment payments a an the from for of by in on to at " +
    "with and via using check checks cheque cheques cash zelle ach transfer wire direct deposit bank stock stocks share shares number no no. num ref " +
    "reference confirmation conf txn transaction dated today yesterday last this household family member please just refund refunds write off " +
    "write-off writeoff written-off pledge pledges receipt rcpt dollars " +
    "dollar rupees rupee pounds pound euros euro rand shillings shilling naira pesos peso francs franc"
  ).split(" "),
);
const DAY_WORDS = /^(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$|^\d{1,2}(?:st|nd|rd|th)$/i;

/** True when the community writes a decimal comma ("200,50"): the portal writes English in the community's country (en-DE, en-ZA…). */
export function usesDecimalComma(locale: string): boolean {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value === ",";
  } catch {
    return false;
  }
}

/**
 * Amounts written with a decimal comma ("1.234,56", "1 234,56", "200,50") become "1234.56" and "200.50"; other text is left alone.
 * Only for a community that writes a decimal comma: elsewhere "2,00,000" and "1,250.50" are already read as they are meant.
 */
export function normalizeAmounts(text: string, decimalComma: boolean): string {
  if (!decimalComma) return text;
  return text.replace(/(?<![\d.,])(?:\d{1,3}(?:[.   ]\d{3})+(?:,\d{1,2})?|\d+,\d{1,2})(?![\d.,])/g, (m) => m.replace(/[.   ]/g, "").replace(",", "."));
}

/** The community's own ways of writing its currency ("KES", "Ksh", "₹"), to leave them out of a name. */
function currencyWords(fmt: CommunityFormat): Set<string> {
  const out = new Set([fmt.currency.toLowerCase()]);
  const sym = currencySymbol(fmt).replace(/\./g, "").toLowerCase();
  if (sym) out.add(sym);
  return out;
}

function cleanToken(w: string): string {
  return w.replace(/^[#("“'‘]+|[)"”'’,.;:!?]+$/g, "");
}

/** Receipt and pledge numbers by their shape: letters with digits ("R-2026-0388", "PL20455") or digits joined ("2026-0388"). */
export function codeTokens(text: string): string[] {
  return text
    .split(" ")
    .map(cleanToken)
    .filter((w) => w.length >= 3 && w.length <= 40 && /\d/.test(w))
    .filter((w) => !/^\d+(?:st|nd|rd|th)$/i.test(w) && !/^\p{Sc}/u.test(w))
    .filter((w) => (/\p{L}/u.test(w) && /^[\p{L}\p{N}][\p{L}\p{N}._/#-]*$/u.test(w) && /^\p{L}|-|\d\p{L}|\p{L}\d/u.test(w)) || /^\d{2,}[-/]\d{2,}$/.test(w));
}

/** Who a sentence is about, when the reader did not find "from …": the words left after the amount, method, date and fillers. */
export function leftoverWho(text: string, ask: PaymentAsk, fmt: CommunityFormat, today: string): string | null {
  let rest = text;
  if (ask.reference) rest = rest.replace(ask.reference, " ");
  const date = readDate(rest, today);
  if (date) rest = rest.replace(date.match, " ");
  if (ask.about) rest = rest.replace(ask.about, " ");
  const money = currencyWords(fmt);
  const words = rest
    .split(" ")
    .map(cleanToken)
    .filter(Boolean)
    .filter((w) => {
      const lower = w.toLowerCase();
      if (FILLER.has(lower) || money.has(lower.replace(/\./g, "")) || DAY_WORDS.test(w)) return false;
      if (/^\p{Sc}*[\d.,]+\p{Sc}*$/u.test(w) || /^\p{Sc}+$/u.test(w)) return false;
      if (/^[\p{L}]{1,4}\d[\d.,]*$/u.test(w) && money.has(lower.replace(/[\d.,]+$/, ""))) return false;
      return true;
    });
  const who = words.join(" ").trim();
  return who.length >= 2 && /\p{L}|\d/u.test(who) && who.length <= 80 ? who : null;
}

const AMOUNT_ONLY = /^(?:[\p{L}]{0,4}\.?\s?)?\p{Sc}?\s?(\d[\d,]*(?:\.\d{1,2})?)\s?\p{Sc}?(?:\s?[\p{L}]{0,4})?$/u;

/** A text that is only an amount ("$200", "200.00", "KES 5,000"), in minor units; null otherwise. A bare number counts only when `bare`. */
function amountOnly(text: string, fmt: CommunityFormat, bare: boolean): number | null {
  const m = AMOUNT_ONLY.exec(text);
  if (!m) return null;
  const letters = text.replace(/[\d.,\s\p{Sc}]/gu, "").toLowerCase();
  const money = currencyWords(fmt);
  if (letters && !money.has(letters)) return null;
  const marked = /\p{Sc}/u.test(text) || (letters !== "" && money.has(letters));
  if (!marked && !bare) return null;
  const cents = parseAmountToCents(m[1]);
  return cents !== null && cents > 0 ? cents : null;
}

/**
 * What a typed text asks of Giving, or null when it asks nothing of it. A payment needs a payment word ("record", "received",
 * "gave"…) or a method word with an amount ("200 check patel"), as in docs/UNIFIED_BOX.md. Outside Giving a bare number is a member
 * number, not an amount: an amount needs its currency there ("$200").
 */
export function readGivingIntent(raw: string, o: { today: string; fmt: CommunityFormat; scope: FindScope }): GivingIntent | null {
  const text = normalizeAmounts(squeeze(raw), usesDecimalComma(o.fmt.locale));
  if (text.length < 2 || isQuestion(text)) return null;
  const read = parsePaymentAsk(text, o.today);
  const ask: PaymentAsk = read.reference ? read : { ...read, reference: REF_WORD.exec(text)?.[1] ?? null };
  const codes = codeTokens(text);
  const numbered = NUMBERED.exec(text);
  const token = codes[0] ?? numbered?.[2] ?? null;
  const othersThan = (t: string | null) => leftoverWho(t ? text.replace(t, " ") : text, { ...ask, reference: null }, o.fmt, o.today);

  const exportCmd = readExportCommand(text, o.today);
  if (exportCmd) return exportCmd;
  const create = readCreateCommand(text);
  if (create) return { kind: "create", cmd: create };
  if (REFUND.test(text)) return { kind: "refund", token, who: token ? null : othersThan(null) };
  if (WRITE_OFF.test(text)) return { kind: "write_off", token, who: token ? null : othersThan(null) };

  const amount = ask.amount ? parseAmountToCents(ask.amount) : null;
  const cents = amount !== null && amount > 0 ? amount : null;
  // "pledge 500 patel building fund" records a pledge; "pledge 20455" looks one up.
  if (PLEDGE_START.test(text) && codes.length === 0) {
    const who = leftoverWho(text, ask, o.fmt, o.today);
    if (who || /\p{Sc}/u.test(text)) return { kind: "pledge", cents, who };
  }
  // A check or Zelle reference ("ref ZL12345") is part of the payment, not a number to look up.
  const lookupCodes = codes.filter((c) => c !== ask.reference);
  if (lookupCodes.length === 0 && !numbered && (PAYMENT_VERB.test(text) || (ask.method !== null && cents !== null))) {
    return { kind: "record", ask, who: ask.who ?? leftoverWho(text, ask, o.fmt, o.today), cents };
  }

  const date = readDate(text, o.today);
  const rest = squeeze(date ? text.replace(date.match, " ") : text);
  const lookupCents = token ? null : amountOnly(rest, o.fmt, o.scope === "giving");
  const words = o.scope === "giving" && !token && lookupCents === null && /\p{L}/u.test(text) ? text : null;
  if (!token && lookupCents === null && !words) return null;
  return {
    kind: "lookup",
    code: codes[0] ?? null,
    numbered: !codes[0] && numbered ? { field: numbered[1].toLowerCase() === "pledge" ? "pledge" : "receipt", value: numbered[2] } : null,
    cents: lookupCents,
    date: lookupCents !== null ? (date?.date ?? null) : null,
    words,
  };
}

const EXPORT_START = /^(?:export|download)\b/i;

/**
 * "export payments 2026", "download pledges", "export bank lines", "export year-end totals 2025": which Giving list to export and the
 * year, or null when the text does not start with export or names no Giving list.
 */
export function readExportCommand(text: string, today: string): Extract<GivingIntent, { kind: "export" }> | null {
  if (!EXPORT_START.test(text.trim())) return null;
  const rest = text.trim().replace(EXPORT_START, " ").toLowerCase();
  const list: GivingExportList | null = /\byear[\s-]?end\b|\bstatements?\b|\btotals?\b/.test(rest)
    ? "year_end_totals"
    : /\bbank\b/.test(rest)
      ? "bank_lines"
      : /\bpledges?\b/.test(rest)
        ? "pledges"
        : /\bpayments?\b|\bgifts?\b|\bdonations?\b|\bgiving\b/.test(rest)
          ? "payments"
          : null;
  if (!list) return null;
  const y = /\b(\d{4})\b/.exec(rest);
  const year = y && Number(y[1]) >= 1990 && Number(y[1]) <= Number(today.slice(0, 4)) + 1 ? Number(y[1]) : null;
  return { kind: "export", list, year };
}

/** Where the export command opens: the list, filtered, with ?export=1 so its Export sheet is open. */
export function exportCommandTarget(i: Extract<GivingIntent, { kind: "export" }>): { title: string; where: string; href: string } {
  switch (i.list) {
    case "payments":
      return i.year
        ? { title: `Export payments received in ${i.year}`, where: `Payments for ${i.year}`, href: `/giving/payments?year=${i.year}&export=1` }
        : { title: "Export every payment", where: "Payments", href: "/giving/payments?export=1" };
    case "pledges":
      return { title: "Export every pledge", where: "Pledges (All)", href: "/giving/pledges?status=all&export=1" };
    case "bank_lines":
      return { title: "Export the matched bank lines", where: "Bank › History (switch the view to export another one)", href: "/giving/payments/bank?view=history&export=1" };
    case "year_end_totals":
      return i.year
        ? { title: `Export the year-end totals for ${i.year}`, where: `Statements for ${i.year}`, href: `/giving/statements?year=${i.year}&export=1` }
        : { title: "Export the year-end totals", where: "Statements", href: "/giving/statements?export=1" };
  }
}

// ---------------------------------------------------------------------------------------------------------------- What was found

export type PaymentHit = {
  id: string;
  receipt: string | null;
  amountCents: number;
  refundedCents: number;
  method: string;
  status: string;
  receivedOn: string | null;
  householdId: string | null;
};
export type PledgeHit = { id: string; number: string | null; campaign: string | null; amountCents: number; paidCents: number; status: string; householdId: string | null };
export type BankHit = { id: string; postedOn: string; amountCents: number; description: string; payerName: string | null; status: string };
export type CampaignHit = { id: string; name: string; status: string; goalCents: number | null };

export type GivingFound = {
  /** The families `who` matched, best first, each with its card (the ones whose card could not be read are not here). */
  families: GivingHousehold[];
  /** More families matched than are listed. */
  moreFamilies: boolean;
  payments: PaymentHit[];
  pledges: PledgeHit[];
  bank: BankHit[];
  campaigns: CampaignHit[];
  /** Cards of the families the payments and pledges belong to. */
  cards: ReadonlyMap<string, GivingHousehold>;
  /** For a pledge: the fund, campaign or opportunity the typed words named ("building fund"), when exactly one did. */
  designation?: PledgeDesignation | null;
  /** For a pledge: the words the families were looked up by once the fund's words were taken out ("patel"); null when none were left. */
  pledgeWho?: string | null;
};

export const EMPTY_FOUND: GivingFound = { families: [], moreFamilies: false, payments: [], pledges: [], bank: [], campaigns: [], cards: new Map() };

/** One row of the Giving lane. Every row about a family carries the family with its card line. */
export type GivingRow =
  | { kind: "record"; key: string; title: string; detail: string; household: GivingHousehold | null; request: RecordPaymentRequest; best: boolean }
  | { kind: "record_pledge"; key: string; title: string; detail: string; household: GivingHousehold | null; request: RecordPledgeRequest; best: boolean }
  | { kind: "payment"; key: string; id: string; title: string; detail: string; household: GivingHousehold | null; householdId: string | null; href: string }
  | { kind: "pledge"; key: string; id: string; title: string; detail: string; household: GivingHousehold | null; householdId: string | null; href: string }
  | { kind: "bank"; key: string; id: string; title: string; detail: string; href: string }
  | { kind: "campaign"; key: string; id: string; title: string; detail: string; href: string }
  | { kind: "go"; key: string; title: string; detail: string; household: GivingHousehold | null; href: string };

export type GivingLane = {
  /** "record a $200.00 check for the Patel household 0127". */
  understood: string;
  rows: GivingRow[];
  /** Plain lines that cannot be chosen ("Recording a pledge here is coming next."). */
  notes: string[];
  /** The Giving rows go above the families and people (the text was about money, or a number only Giving has). */
  first: boolean;
};

/** A card from the database as the Giving lane's family: adults only, with its one-line card. */
export function givingHousehold(card: HouseholdCard): GivingHousehold {
  return { ...familyFrom(card), cardLine: householdCardLine(card) };
}

/** Where a found payment or pledge opens when it is not opened in place: its list, searched for it (Pledges and Payments, slice 3). */
export function paymentsHref(q: string | null): string {
  return q ? `/giving/payments?q=${encodeURIComponent(q)}` : "/giving/payments";
}
export function pledgesHref(q: string | null): string {
  return q ? `/giving/pledges?q=${encodeURIComponent(q)}` : "/giving/pledges";
}
export const BANK_HREF = "/giving/payments/bank";
// The New look's Campaigns & opportunities tab (slice 6); the classic look is sent on to its Campaigns list.
export const CAMPAIGNS_HREF = "/giving/campaigns";

const MAX_FAMILY_ROWS = 5;

type LaneOptions = {
  currency: string;
  locale?: string;
  timeZone: string;
  canRecord: boolean;
  /** Who may start a campaign or an opportunity from the box (campaignsManage; Opportunities on for the second). */
  canCreate?: { campaign: boolean; opportunity: boolean };
  /** giving.manage: may record a pledge by hand (slice 7). Left out: may not. */
  canRecordPledge?: boolean;
  /** data.export: may export a Giving list (slice 9). Left out: may not. */
  canExport?: boolean;
  /** Why a list cannot be exported here (its add-on is switched off), said instead of a row. */
  exportBlocked?: Partial<Record<GivingExportList, string>>;
};

function recordPrefill(i: Extract<GivingIntent, { kind: "record" }>): RecordPaymentRequest["prefill"] {
  return { amount: i.cents ? (i.cents / 100).toFixed(2) : null, method: i.ask.method, receivedOn: i.ask.receivedOn, reference: i.ask.reference, about: i.ask.about };
}

function recordWhat(i: Extract<GivingIntent, { kind: "record" }>, o: LaneOptions): string {
  const method = i.ask.method ? methodWord(i.ask.method) : "payment";
  return i.cents ? `${formatCents(i.cents, o.currency, o.locale)} ${method}` : method;
}

function recordRows(i: Extract<GivingIntent, { kind: "record" }>, found: GivingFound, o: LaneOptions): { rows: GivingRow[]; understood: string; notes: string[] } {
  const what = recordWhat(i, o);
  // "record a $200.00 check", "record an ACH payment", "record $50.00 cash".
  const article = i.ask.method === "cash" && i.cents ? "" : /^[aeiou]/i.test(what) ? "an " : "a ";
  const prefill = recordPrefill(i);
  const details = [i.ask.receivedOn ? `received ${formatDate(i.ask.receivedOn, o.timeZone)}` : null, i.ask.reference ? `reference ${i.ask.reference}` : null, i.ask.about ? `for ${i.ask.about}` : null]
    .filter(Boolean)
    .join(" · ");
  if (!o.canRecord) {
    return { rows: [], understood: `record ${article}${what}`, notes: ["Recording a payment needs the giving.record_offline or giving.manage permission."] };
  }
  const families = found.families.slice(0, MAX_FAMILY_ROWS);
  const opens = "Opens the Record payment sheet filled in; its own button records it.";
  if (families.length === 1) {
    const f = families[0];
    return {
      understood: `record ${article}${what} for ${householdRef(f)}`,
      notes: [],
      rows: [{ kind: "record", key: `record-${f.id}`, title: `Record ${what} for ${householdRef(f)}`, detail: details || opens, household: f, request: { household: f, prefill }, best: true }],
    };
  }
  if (families.length > 1) {
    const n = found.moreFamilies ? `${families.length}+` : String(families.length);
    const choose: GivingRow = {
      kind: "record",
      key: "record-choose",
      title: `Record ${what}: choose the family`,
      detail: `${n} families match “${i.who ?? ""}”. The sheet shows each household card to choose from.`,
      household: null,
      request: { candidates: families, prefill },
      best: true,
    };
    const each: GivingRow[] = families.map((f) => ({
      kind: "record",
      key: `record-${f.id}`,
      title: `Record ${what} for ${householdRef(f)}`,
      detail: details || opens,
      household: f,
      request: { household: f, prefill },
      best: false,
    }));
    return { understood: `record ${article}${what} · ${n} families match`, notes: [], rows: [choose, ...each] };
  }
  const none = i.who ? `No family matches “${i.who}”. The sheet opens on the family search.` : "Choose the family in the sheet.";
  return {
    understood: `record ${article}${what}`,
    notes: [],
    rows: [{ kind: "record", key: "record-none", title: `Record ${what}`, detail: details ? `${details} · ${none}` : none, household: null, request: { prefill }, best: true }],
  };
}

/** A row that opens a sheet to record something (a payment or a pledge): drawn large, first, with "Opens the sheet". */
export function isRecordRow(row: GivingRow): row is Extract<GivingRow, { kind: "record" | "record_pledge" }> {
  return row.kind === "record" || row.kind === "record_pledge";
}

/**
 * "pledge 500 patel building fund": the Record pledge sheet, filled in with the amount, the fund the words named and the family (one
 * row per matching family, each with its card; never a family by name alone). Nothing is recorded until the sheet's own button.
 */
function pledgeRows(i: Extract<GivingIntent, { kind: "pledge" }>, found: GivingFound, o: LaneOptions): { rows: GivingRow[]; understood: string; notes: string[] } {
  const amount = i.cents ? formatCents(i.cents, o.currency, o.locale) : null;
  const what = amount ? `a ${amount} pledge` : "a pledge";
  const designation = found.designation ?? null;
  const to = designation ? ` to ${designation.name}` : "";
  if (!o.canRecordPledge) {
    return { rows: [], understood: `record ${what}`, notes: ["Recording a pledge needs the giving.manage permission."] };
  }
  const prefill: RecordPledgeRequest["prefill"] = { amount: i.cents ? (i.cents / 100).toFixed(2) : null, designation };
  const opens = `${designation ? `For ${designation.name}. ` : ""}Opens the Record pledge sheet filled in; its own button records it.`;
  const families = found.families.slice(0, MAX_FAMILY_ROWS);
  const one = (f: GivingHousehold, best: boolean): GivingRow => ({
    kind: "record_pledge",
    key: `pledge-${f.id}`,
    title: `Record ${what} for ${householdRef(f)}`,
    detail: opens,
    household: f,
    request: { household: f, prefill },
    best,
  });
  if (families.length === 1) {
    return { understood: `record ${what} for ${householdRef(families[0])}${to}`, notes: [], rows: [one(families[0], true)] };
  }
  if (families.length > 1) {
    const n = found.moreFamilies ? `${families.length}+` : String(families.length);
    const choose: GivingRow = {
      kind: "record_pledge",
      key: "pledge-choose",
      title: `Record ${what}${to}: choose the family`,
      detail: `${n} families match. The sheet shows each household card to choose from.`,
      household: null,
      request: { candidates: families, prefill },
      best: true,
    };
    return { understood: `record ${what}${to} · ${n} families match`, notes: [], rows: [choose, ...families.map((f) => one(f, false))] };
  }
  const who = found.pledgeWho !== undefined ? found.pledgeWho : i.who;
  const none = who ? `No family matches “${who}”. The sheet opens on the family search.` : "Choose the family in the sheet.";
  return {
    understood: `record ${what}${to}`,
    notes: [],
    rows: [{ kind: "record_pledge", key: "pledge-none", title: `Record ${what}${to}`, detail: none, household: null, request: { prefill }, best: true }],
  };
}

function paymentRow(p: PaymentHit, found: GivingFound, o: LaneOptions): GivingRow {
  const household = p.householdId ? (found.cards.get(p.householdId) ?? null) : null;
  const who = household ? null : p.householdId ? "Household card not available to your role" : "No household on this payment";
  return {
    kind: "payment",
    key: `pay-${p.id}`,
    id: p.id,
    title: paymentTitle(p, o.currency, o.locale),
    detail: [paymentDetail(p, o.currency, o.timeZone, o.locale), who].filter(Boolean).join(" · "),
    household,
    householdId: household ? p.householdId : null,
    href: paymentsHref(p.receipt),
  };
}

function pledgeRow(p: PledgeHit, found: GivingFound, o: LaneOptions): GivingRow {
  const household = p.householdId ? (found.cards.get(p.householdId) ?? null) : null;
  const open = Math.max(0, p.amountCents - p.paidCents);
  return {
    kind: "pledge",
    key: `pl-${p.id}`,
    id: p.id,
    title: pledgeTitle(p),
    detail: [pledgeDetail({ amountCents: p.amountCents, openCents: open, status: p.status }, o.currency, o.locale), household ? null : "Household card not available to your role"].filter(Boolean).join(" · "),
    household,
    householdId: household ? p.householdId : null,
    href: pledgesHref(p.number),
  };
}

function bankRow(b: BankHit, o: LaneOptions): GivingRow {
  return {
    kind: "bank",
    key: `bank-${b.id}`,
    id: b.id,
    title: `${formatCents(b.amountCents, o.currency, o.locale)} · ${b.description}`,
    detail: [formatDate(b.postedOn, o.timeZone), b.payerName, b.status === "unmatched" ? "Not matched yet" : statusWord(b.status)].filter(Boolean).join(" · "),
    href: BANK_HREF,
  };
}

function campaignRow(c: CampaignHit, o: LaneOptions): GivingRow {
  return {
    kind: "campaign",
    key: `camp-${c.id}`,
    id: c.id,
    title: c.name,
    detail: [`Campaign · ${statusWord(c.status)}`, c.goalCents ? `goal ${formatCents(c.goalCents, o.currency, o.locale)}` : null].filter(Boolean).join(" · "),
    href: CAMPAIGNS_HREF,
  };
}

/**
 * The Giving lane's rows for one intent and what the database found. Money words come first; a lookup by words (a campaign, a bank
 * description) goes below the families. Rows whose family card cannot be read keep the money facts and say so; they never show a name.
 */
export function buildGivingLane(intent: GivingIntent, found: GivingFound, o: LaneOptions): GivingLane {
  const money = (c: number) => formatCents(c, o.currency, o.locale);
  if (intent.kind === "record") {
    const r = recordRows(intent, found, o);
    return { understood: r.understood, rows: r.rows, notes: r.notes, first: true };
  }
  if (intent.kind === "export") {
    const target = exportCommandTarget(intent);
    const understood = `an export of ${target.title.replace(/^Export (the )?/, "")}`;
    if (!o.canExport) return { understood, rows: [], notes: ["Exporting needs the data-export permission (treasurers hold it)."], first: true };
    const blocked = o.exportBlocked?.[intent.list];
    if (blocked) return { understood, rows: [], notes: [blocked], first: true };
    const go: GivingRow = {
      kind: "go",
      key: `go-export-${intent.list}`,
      title: target.title,
      detail: `Opens ${target.where} with the Export sheet: a new code from your authenticator app, then the file. The export is recorded in the audit log.`,
      household: null,
      href: target.href,
    };
    return { understood, rows: [go], notes: [], first: true };
  }
  if (intent.kind === "create") {
    const { what, name } = intent.cmd;
    const thing = what === "campaign" ? "campaign" : "opportunity";
    const understood = `a new ${thing}${name ? ` “${name}”` : ""}`;
    if (!o.canCreate?.[what]) return { understood, rows: [], notes: [`Starting a new ${thing} needs giving.manage${what === "opportunity" ? " and the Opportunities module" : ""}.`], first: true };
    const go: GivingRow = {
      kind: "go",
      key: `go-new-${what}`,
      title: `New ${thing}${name ? ` “${name}”` : ""}`,
      detail: what === "campaign" ? "Opens the New campaign sheet, named. It is created as a draft: members see nothing until you publish it." : "Opens the New opportunity sheet, named: four questions, the rest later.",
      household: null,
      href: quickCreateHref(intent.cmd),
    };
    return { understood, rows: [go], notes: [], first: true };
  }
  if (intent.kind === "pledge") {
    const r = pledgeRows(intent, found, o);
    return { understood: r.understood, rows: r.rows, notes: r.notes, first: true };
  }
  if (intent.kind === "refund") {
    const q = intent.token ?? intent.who;
    const hit = intent.token ? found.payments.find((p) => (p.receipt ?? "").toLowerCase() === intent.token?.toLowerCase()) : undefined;
    const household = hit?.householdId ? (found.cards.get(hit.householdId) ?? null) : null;
    const title = hit
      ? `Ask for a refund of ${hit.receipt ?? "this payment"} (${money(hit.amountCents)})${household ? ` for ${householdRef(household)}` : ""}`
      : `Ask for a refund${q ? ` of ${q}` : ""}`;
    const go: GivingRow = { kind: "go", key: "go-refund", title, detail: "Opens Payments on it, with the refund request ready. A second person approves every refund.", household, href: paymentsHref(q) };
    return { understood: `a refund${q ? ` of ${q}` : ""}`, rows: [go, ...found.payments.map((p) => paymentRow(p, found, o))], notes: [], first: true };
  }
  if (intent.kind === "write_off") {
    const q = intent.token ?? intent.who;
    const hit = intent.token ? found.pledges.find((p) => (p.number ?? "").toLowerCase() === intent.token?.toLowerCase()) : undefined;
    const household = hit?.householdId ? (found.cards.get(hit.householdId) ?? null) : null;
    const title = hit
      ? `Ask to write off ${hit.number ?? "this pledge"} (${money(Math.max(0, hit.amountCents - hit.paidCents))} open)${household ? ` for ${householdRef(household)}` : ""}`
      : `Ask for a write-off${q ? ` of ${q}` : ""}`;
    const go: GivingRow = { kind: "go", key: "go-writeoff", title, detail: "Opens Pledges on it, with the write-off request ready. A second person approves every write-off.", household, href: pledgesHref(q) };
    return { understood: `a write-off${q ? ` of ${q}` : ""}`, rows: [go, ...found.pledges.map((p) => pledgeRow(p, found, o))], notes: [], first: true };
  }
  const rows: GivingRow[] = [
    ...found.payments.map((p) => paymentRow(p, found, o)),
    ...found.pledges.map((p) => pledgeRow(p, found, o)),
    ...found.bank.map((b) => bankRow(b, o)),
    ...found.campaigns.map((c) => campaignRow(c, o)),
  ];
  const understood =
    intent.code || intent.numbered
      ? "a receipt or pledge number"
      : intent.cents !== null
        ? `an amount: ${money(intent.cents)}${intent.date ? ` on ${formatDate(intent.date, o.timeZone)}` : ""}`
        : "a name or words";
  return { understood, rows, notes: [], first: !!(intent.code || intent.numbered || intent.cents !== null) };
}

/** What Enter (or a click) does on a Giving row: open the sheet, the family's giving, or a list. Never a save. */
export type GivingEnter =
  | { type: "record-payment"; request: RecordPaymentRequest; href: string }
  | { type: "record-pledge"; request: RecordPledgeRequest; href: string }
  | { type: "family-giving"; householdId: string; focus: FamilyFocus | null; href: string }
  | { type: "open"; href: string };

export function givingEnter(row: GivingRow): GivingEnter {
  switch (row.kind) {
    case "record": {
      const id = row.request.household?.id ?? null;
      return { type: "record-payment", request: row.request, href: id ? `/giving/payments?household=${id}` : "/giving/payments" };
    }
    case "record_pledge": {
      // There is no Record pledge screen to fall back to: without the sheets the family's Pledges tab (or Pledges) opens.
      const id = row.request.household?.id ?? null;
      return { type: "record-pledge", request: row.request, href: id ? `/households/${id}?tab=pledges` : "/giving/pledges" };
    }
    case "payment":
    case "pledge":
      return row.householdId && row.household
        ? { type: "family-giving", householdId: row.householdId, focus: { kind: row.kind, id: row.id }, href: row.href }
        : { type: "open", href: row.href };
    default:
      return { type: "open", href: row.href };
  }
}
