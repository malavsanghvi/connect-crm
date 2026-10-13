// CatchTheMatch's shared employer-program directory (migrations 0765-0767, docs/CATCH_THE_MATCH.md sections 6, 7 and 9): the
// words, the formatting and the form reader that the Gift matching screens and Platform › Gift matching directory share.
// Public facts about a program only, never who works there or who gave. Pure: no I/O. The database checks every rule again
// (app._match_program_clean) and says what is wrong in plain English.

import { formatDate } from "@/lib/dates";
import { centsAsDecimal, formatCents, parseAmountToCents } from "@/lib/money";

export const PORTALS = ["benevity", "yourcause", "cybergrants", "bright_funds", "employer_form", "other"] as const;
export type Portal = (typeof PORTALS)[number];
export const PORTAL_LABEL: Record<Portal, string> = {
  benevity: "Benevity",
  yourcause: "YourCause",
  cybergrants: "CyberGrants",
  bright_funds: "Bright Funds",
  employer_form: "The employer's own form",
  other: "Another portal",
};

export const GIFT_TYPES = ["one_time", "recurring", "payroll", "stock", "donor_advised_fund", "event"] as const;
export type GiftType = (typeof GIFT_TYPES)[number];
export const GIFT_TYPE_LABEL: Record<GiftType, string> = {
  one_time: "One-time gifts",
  recurring: "Recurring gifts",
  payroll: "Payroll giving",
  stock: "Stock and securities",
  donor_advised_fund: "Grants from a donor-advised fund",
  event: "Event tickets and auctions",
};

export const ORG_KINDS = ["any_charity", "education", "arts_culture", "health", "human_services", "environment_animals", "civic_community", "international"] as const;
export type OrgKind = (typeof ORG_KINDS)[number];
export const ORG_KIND_LABEL: Record<OrgKind, string> = {
  any_charity: "Any registered charity",
  education: "Schools and universities",
  arts_culture: "Arts and culture",
  health: "Health",
  human_services: "Human services",
  environment_animals: "Environment and animals",
  civic_community: "Civic and community groups",
  international: "International aid",
};

export const RELIGIOUS_RULES = ["eligible", "non_worship_only", "excluded"] as const;
export type ReligiousRule = (typeof RELIGIOUS_RULES)[number];
/** The choice in a form. */
export const RELIGIOUS_LABEL: Record<ReligiousRule, string> = {
  eligible: "Religious organizations qualify",
  non_worship_only: "Only their programs that are not worship",
  excluded: "Religious organizations do not qualify",
};

export const DEADLINE_KINDS = ["end_of_gift_year", "months_after_gift", "date_next_year", "none"] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];
export const DEADLINE_KIND_LABEL: Record<DeadlineKind, string> = {
  end_of_gift_year: "By December 31 of the year of the gift",
  months_after_gift: "Within a number of months of the gift",
  date_next_year: "By a date in the year after the gift",
  none: "No deadline",
};

export const SOURCES = ["employer_site", "employer_document", "portal_listing", "submission", "partner", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  employer_site: "The employer's website",
  employer_document: "An employer document (a handbook or benefits guide)",
  portal_listing: "The matching portal's listing",
  submission: "What a member told a community",
  partner: "A licensed matching-gift database",
  other: "Somewhere else",
};
/** Sources Weaver's team chooses from when it enters facts itself (a submission's source is set by the database). */
export const WEAVER_SOURCES: readonly Source[] = ["employer_site", "employer_document", "portal_listing", "partner", "other"];

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export type ProgramStatus = "active" | "retired" | "merged";
export type VerifiedKind = "weaver" | "community";

/** A directory entry as the screens read it (app.match_programs). */
export type ProgramRow = {
  id: string;
  company_name: string;
  country: string | null;
  gift_match: boolean;
  volunteer_grant: boolean;
  match_ratio_bp: number | null;
  currency: string;
  min_gift_cents: number | null;
  max_gift_cents: number | null;
  max_year_cents: number | null;
  gift_types: string[];
  org_kinds: string[];
  religious_orgs: string | null;
  eligibility_note: string | null;
  portal: string | null;
  portal_url: string | null;
  deadline_kind: string | null;
  deadline_months: number | null;
  deadline_month: number | null;
  deadline_day: number | null;
  deadline_note: string | null;
  volunteer_cents_per_hour: number | null;
  volunteer_min_hours: number | null;
  volunteer_max_year_cents: number | null;
  volunteer_note: string | null;
  notes: string | null;
  source: string;
  source_url: string | null;
  last_verified_on: string | null;
  verified_by_kind: string | null;
  verified_submission_id: string | null;
  status: string;
  merged_into: string | null;
  status_reason: string | null;
  updated_at: string;
};

/** The columns the screens select. */
export const PROGRAM_COLUMNS =
  "id, company_name, country, gift_match, volunteer_grant, match_ratio_bp, currency, min_gift_cents, max_gift_cents, max_year_cents, gift_types, org_kinds, religious_orgs, eligibility_note, portal, portal_url, deadline_kind, deadline_months, deadline_month, deadline_day, deadline_note, volunteer_cents_per_hour, volunteer_min_hours, volunteer_max_year_cents, volunteer_note, notes, source, source_url, last_verified_on, verified_by_kind, verified_submission_id, status, merged_into, status_reason, updated_at";

/** The facts sent to app.save_match_program / app.submit_match_program / app.decide_match_submission (the directory's shape). */
export type ProgramFacts = {
  company_name: string;
  names: string[];
  country: string | null;
  gift_match: boolean;
  volunteer_grant: boolean;
  match_ratio_bp: number | null;
  currency: string;
  min_gift_cents: number | null;
  max_gift_cents: number | null;
  max_year_cents: number | null;
  gift_types: GiftType[];
  org_kinds: OrgKind[];
  religious_orgs: ReligiousRule | null;
  eligibility_note: string | null;
  portal: Portal | null;
  portal_url: string | null;
  deadline_kind: DeadlineKind | null;
  deadline_months: number | null;
  deadline_month: number | null;
  deadline_day: number | null;
  deadline_note: string | null;
  volunteer_cents_per_hour: number | null;
  volunteer_min_hours: number | null;
  volunteer_max_year_cents: number | null;
  volunteer_note: string | null;
  notes: string | null;
  source: Source | null;
  source_url: string | null;
  verified_on: string | null;
};

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

export function portalLabel(p: string | null | undefined): string {
  return isOneOf(PORTALS, p) ? PORTAL_LABEL[p] : "Not known yet";
}

export function sourceLabel(s: string | null | undefined): string {
  return isOneOf(SOURCES, s) ? SOURCE_LABEL[s] : "Not known";
}

/** The ratio in basis points as people say it: 10000 → "1:1", 5000 → "0.5:1", 20000 → "2:1". */
export function ratioText(bp: number | null | undefined): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp) || bp <= 0) return "Not known yet";
  const whole = Math.trunc(bp / 10000);
  const rest = String(bp % 10000).padStart(4, "0").replace(/0+$/, "");
  const r = rest ? `${whole}.${rest}` : String(whole);
  return `${r}:1 (${r} for every 1 given)`;
}

/** The ratio a person types ("1", "0.5", "2:1") as basis points, or null when it is not a clean number from 0.0001 to 10. */
export function parseRatio(input: string | null | undefined): number | null {
  const s = String(input ?? "").trim().replace(/\s*:\s*1$/, "");
  if (!s) return null;
  const m = /^(\d{1,2})(?:\.(\d{1,4}))?$/.exec(s);
  if (!m) return null;
  const bp = Number(m[1]) * 10000 + Number((m[2] ?? "").padEnd(4, "0") || "0");
  return bp >= 1 && bp <= 100000 ? bp : null;
}

/** The ratio for a form field: 10000 → "1", 5000 → "0.5". */
export function ratioInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined || bp <= 0) return "";
  const whole = Math.trunc(bp / 10000);
  const rest = String(bp % 10000).padStart(4, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : String(whole);
}

/** Cents for a form field ("25.00"), or empty. */
export function amountInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "" : centsAsDecimal(cents);
}

export function moneyText(cents: number | null | undefined, currency: string): string {
  return cents === null || cents === undefined ? "No limit given" : formatCents(cents, currency || "USD");
}

/** When the match must be asked for, in plain words. */
export function deadlineText(p: Pick<ProgramRow, "deadline_kind" | "deadline_months" | "deadline_month" | "deadline_day">): string {
  switch (p.deadline_kind) {
    case "end_of_gift_year":
      return DEADLINE_KIND_LABEL.end_of_gift_year;
    case "months_after_gift": {
      const n = p.deadline_months ?? 0;
      return `Within ${n} ${n === 1 ? "month" : "months"} of the gift`;
    }
    case "date_next_year": {
      const month = p.deadline_month && p.deadline_month >= 1 && p.deadline_month <= 12 ? MONTHS[p.deadline_month - 1] : "?";
      return `By ${month} ${p.deadline_day ?? "?"} of the year after the gift`;
    }
    case "none":
      return DEADLINE_KIND_LABEL.none;
    default:
      return "Not known yet";
  }
}

/** Whether religious organizations qualify, as a sentence a member reads before asking. */
export function religiousSentence(rule: string | null | undefined): string {
  switch (rule) {
    case "eligible":
      return "Religious organizations qualify, worship included.";
    case "non_worship_only":
      return "Religious organizations qualify only for programs that are not worship, such as a food bank, classes or community services.";
    case "excluded":
      return "Religious organizations do not qualify.";
    default:
      return "Not known yet whether religious organizations qualify. Check with the employer before asking for a match.";
  }
}

export function orgKindsText(kinds: readonly string[]): string {
  const words = kinds.filter((k): k is OrgKind => isOneOf(ORG_KINDS, k)).map((k) => ORG_KIND_LABEL[k]);
  return words.length ? words.join(", ") : "Not known yet";
}

export function giftTypesText(types: readonly string[]): string {
  const words = types.filter((t): t is GiftType => isOneOf(GIFT_TYPES, t)).map((t) => GIFT_TYPE_LABEL[t]);
  return words.length ? words.join(", ") : "Not known yet";
}

/**
 * Who checked the facts, and when: "Checked by Weaver's team on Oct 1, 2026", "Verified by a community on …" (another
 * community's check never names it), "Verified by your community on …", or "Not checked yet".
 */
export function verifiedText(p: { kind: string | null | undefined; on: string | null | undefined; ownCommunity?: boolean }): string {
  if (!p.on || !p.kind) return "Not checked yet";
  const when = formatDate(p.on, "UTC");
  if (p.kind === "weaver") return `Checked by Weaver's team on ${when}`;
  return p.ownCommunity ? `Verified by your community on ${when}` : `Verified by a community on ${when}`;
}

export function statusText(status: string): string {
  if (status === "retired") return "Ended (retired)";
  if (status === "merged") return "Merged into another entry";
  return "Active";
}

export type SubmissionStatus = "pending" | "forwarded" | "approved" | "rejected" | "merged";
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  pending: "Waiting for a decision",
  forwarded: "With Weaver's team",
  approved: "In the directory",
  rejected: "Rejected",
  merged: "A duplicate",
};
export function submissionStatusText(s: string): string {
  return isOneOf(Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[], s) ? SUBMISSION_STATUS_LABEL[s] : s;
}

// ── Reading the shared form ──────────────────────────────────────────────────

export type FormResult = { ok: true; facts: ProgramFacts } | { ok: false; error: string };

function text(fd: FormData, key: string, max: number, label: string, oneLine = true): string | null | { error: string } {
  const raw = String(fd.get(key) ?? "");
  const v = (oneLine ? raw.replace(/\s+/g, " ") : raw).trim();
  if (!v) return null;
  if (v.length > max) return { error: `${label} can be at most ${max} characters.` };
  return v;
}

function isError(v: unknown): v is { error: string } {
  return typeof v === "object" && v !== null && "error" in v;
}

function httpsOrNull(v: string | null, label: string): string | null | { error: string } {
  if (!v) return null;
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/i.test(v)) return { error: `${label} must be a full web address that starts with https://.` };
  return v;
}

function amount(fd: FormData, key: string, label: string, min: number): number | null | { error: string } {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  const cents = parseAmountToCents(raw);
  if (cents === null || cents < min) return { error: `${label} must be an amount like 25 or 1,000.00.` };
  return cents;
}

function wholeNumber(fd: FormData, key: string, label: string, min: number, max: number): number | null | { error: string } {
  const raw = String(fd.get(key) ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return { error: `${label} must be a whole number.` };
  const n = Number(raw);
  if (n < min || n > max) return { error: `${label} must be from ${min} to ${max}.` };
  return n;
}

/**
 * The program's facts from the shared form (src/components/matching/program-fields.tsx). Facts that do not apply are dropped:
 * the gift rules when it matches no gifts, the volunteer rules when it pays no grants, the deadline's numbers its kind does
 * not use. `context` "weaver" needs a source and reads the date the facts were checked; "community" leaves the source to the
 * database ("What a member told a community").
 */
export function programFromForm(fd: FormData, context: "weaver" | "community"): FormResult {
  const fail = (error: string): FormResult => ({ ok: false, error });
  const name = text(fd, "company_name", 160, "The company's name");
  if (isError(name)) return fail(name.error);
  if (!name) return fail("Enter the company's name.");
  const names: string[] = [];
  for (const line of String(fd.get("names") ?? "").split(/[\r\n]+/)) {
    const v = line.replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (v.length > 160) return fail("Each other name can be at most 160 characters.");
    if (!names.some((n) => n.toLowerCase() === v.toLowerCase()) && v.toLowerCase() !== name.toLowerCase()) names.push(v);
  }
  if (names.length > 30) return fail("A company can have at most 30 other names.");

  const countryRaw = text(fd, "country", 60, "The country");
  if (isError(countryRaw)) return fail(countryRaw.error);
  if (countryRaw && !/^[A-Za-z]{2}$/.test(countryRaw)) return fail("The country is a two-letter code, like US, IN or GB.");
  const currencyRaw = text(fd, "currency", 60, "The currency");
  if (isError(currencyRaw)) return fail(currencyRaw.error);
  const currency = (currencyRaw ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return fail("The currency is a three-letter code, like USD, INR or GBP.");

  const giftMatch = fd.get("gift_match") === "on";
  const volunteer = fd.get("volunteer_grant") === "on";
  if (!giftMatch && !volunteer) return fail("Say what the program does: it matches gifts, pays volunteer grants, or both.");

  let ratio: number | null = null;
  let minGift: number | null = null;
  let maxGift: number | null = null;
  let maxYear: number | null = null;
  let giftTypes: GiftType[] = [];
  if (giftMatch) {
    const ratioRaw = String(fd.get("ratio") ?? "").trim();
    ratio = parseRatio(ratioRaw);
    if (ratioRaw && ratio === null) return fail("The match ratio is what the employer gives for each 1 given, like 1, 0.5 or 2 (at most 10).");
    const a = amount(fd, "min_gift", "The minimum gift", 0);
    if (isError(a)) return fail(a.error);
    const b = amount(fd, "max_gift", "The maximum matched per gift", 1);
    if (isError(b)) return fail(b.error);
    const c = amount(fd, "max_year", "The maximum matched per year", 1);
    if (isError(c)) return fail(c.error);
    minGift = a;
    maxGift = b;
    maxYear = c;
    if (minGift !== null && maxGift !== null && minGift > maxGift) return fail("The minimum gift is more than the maximum matched per gift.");
    giftTypes = fd.getAll("gift_types").filter((t): t is GiftType => isOneOf(GIFT_TYPES, t));
  }
  const orgKinds = fd.getAll("org_kinds").filter((k): k is OrgKind => isOneOf(ORG_KINDS, k));
  const relRaw = String(fd.get("religious_orgs") ?? "");
  const religious = isOneOf(RELIGIOUS_RULES, relRaw) ? relRaw : null;
  const eligNote = text(fd, "eligibility_note", 500, "The note on which organizations qualify", false);
  if (isError(eligNote)) return fail(eligNote.error);

  const portalRaw = String(fd.get("portal") ?? "");
  const portal = isOneOf(PORTALS, portalRaw) ? portalRaw : null;
  const portalUrlText = text(fd, "portal_url", 500, "The portal's link");
  if (isError(portalUrlText)) return fail(portalUrlText.error);
  const portalUrl = httpsOrNull(portalUrlText, "The portal's link");
  if (isError(portalUrl)) return fail(portalUrl.error);

  const kindRaw = String(fd.get("deadline_kind") ?? "");
  const deadlineKind = isOneOf(DEADLINE_KINDS, kindRaw) ? kindRaw : null;
  let months: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  if (deadlineKind === "months_after_gift") {
    const m = wholeNumber(fd, "deadline_months", "The months after the gift", 1, 36);
    if (isError(m)) return fail(m.error);
    if (m === null) return fail("Say how many months after the gift the match must be asked for.");
    months = m;
  } else if (deadlineKind === "date_next_year") {
    const mo = wholeNumber(fd, "deadline_month", "The deadline's month", 1, 12);
    if (isError(mo)) return fail(mo.error);
    const d = wholeNumber(fd, "deadline_day", "The deadline's day", 1, 31);
    if (isError(d)) return fail(d.error);
    if (mo === null || d === null) return fail("Give the deadline's month and day in the year after the gift.");
    const probe = new Date(Date.UTC(2000, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1) return fail(`The deadline is not a real date (${MONTHS[mo - 1]} ${d}).`);
    month = mo;
    day = d;
  }
  const deadlineNote = text(fd, "deadline_note", 300, "The note on the deadline", false);
  if (isError(deadlineNote)) return fail(deadlineNote.error);

  let vRate: number | null = null;
  let vHours: number | null = null;
  let vYear: number | null = null;
  let vNote: string | null = null;
  if (volunteer) {
    const r = amount(fd, "volunteer_per_hour", "The volunteer grant per hour", 1);
    if (isError(r)) return fail(r.error);
    const h = wholeNumber(fd, "volunteer_min_hours", "The minimum volunteer hours", 1, 1000);
    if (isError(h)) return fail(h.error);
    const y = amount(fd, "volunteer_max_year", "The maximum volunteer grant per year", 1);
    if (isError(y)) return fail(y.error);
    const n = text(fd, "volunteer_note", 300, "The note on volunteer grants", false);
    if (isError(n)) return fail(n.error);
    vRate = r;
    vHours = h;
    vYear = y;
    vNote = n;
  }
  const notes = text(fd, "notes", 1000, "The notes", false);
  if (isError(notes)) return fail(notes.error);

  let source: Source | null = null;
  let verifiedOn: string | null = null;
  if (context === "weaver") {
    const s = String(fd.get("source") ?? "");
    if (!isOneOf(SOURCES, s)) return fail("Say where the facts come from.");
    source = s;
    const on = String(fd.get("verified_on") ?? "").trim();
    if (on) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) return fail("The date the facts were checked must be a date.");
      verifiedOn = on;
    }
  } else {
    const s = String(fd.get("source") ?? "");
    source = isOneOf(SOURCES, s) ? s : null;
  }
  const sourceUrlText = text(fd, "source_url", 500, "The source's link");
  if (isError(sourceUrlText)) return fail(sourceUrlText.error);
  const sourceUrl = httpsOrNull(sourceUrlText, "The source's link");
  if (isError(sourceUrl)) return fail(sourceUrl.error);

  return {
    ok: true,
    facts: {
      company_name: name,
      names,
      country: countryRaw ? countryRaw.toUpperCase() : null,
      gift_match: giftMatch,
      volunteer_grant: volunteer,
      match_ratio_bp: ratio,
      currency,
      min_gift_cents: minGift,
      max_gift_cents: maxGift,
      max_year_cents: maxYear,
      gift_types: giftTypes,
      org_kinds: orgKinds,
      religious_orgs: religious,
      eligibility_note: eligNote,
      portal,
      portal_url: portalUrl,
      deadline_kind: deadlineKind,
      deadline_months: months,
      deadline_month: month,
      deadline_day: day,
      deadline_note: deadlineNote,
      volunteer_cents_per_hour: vRate,
      volunteer_min_hours: vHours,
      volunteer_max_year_cents: vYear,
      volunteer_note: vNote,
      notes,
      source,
      source_url: sourceUrl,
      verified_on: verifiedOn,
    },
  };
}

/** A submission's facts (jsonb) read back as a row the form and the facts list can show. Unknown values become empty. */
export function factsAsRow(j: unknown, fallbackName = ""): Omit<ProgramRow, "id" | "status" | "merged_into" | "status_reason" | "updated_at" | "verified_submission_id" | "last_verified_on" | "verified_by_kind"> & { names: string[] } {
  const o = (typeof j === "object" && j !== null && !Array.isArray(j) ? j : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" && o[k] ? (o[k] as string) : null);
  const num = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const list = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : []);
  return {
    company_name: str("company_name") ?? fallbackName,
    names: list("names"),
    country: str("country"),
    gift_match: o.gift_match !== false,
    volunteer_grant: o.volunteer_grant === true,
    match_ratio_bp: num("match_ratio_bp"),
    currency: str("currency") ?? "USD",
    min_gift_cents: num("min_gift_cents"),
    max_gift_cents: num("max_gift_cents"),
    max_year_cents: num("max_year_cents"),
    gift_types: list("gift_types"),
    org_kinds: list("org_kinds"),
    religious_orgs: str("religious_orgs"),
    eligibility_note: str("eligibility_note"),
    portal: str("portal"),
    portal_url: str("portal_url"),
    deadline_kind: str("deadline_kind"),
    deadline_months: num("deadline_months"),
    deadline_month: num("deadline_month"),
    deadline_day: num("deadline_day"),
    deadline_note: str("deadline_note"),
    volunteer_cents_per_hour: num("volunteer_cents_per_hour"),
    volunteer_min_hours: num("volunteer_min_hours"),
    volunteer_max_year_cents: num("volunteer_max_year_cents"),
    volunteer_note: str("volunteer_note"),
    notes: str("notes"),
    source: str("source") ?? "submission",
    source_url: str("source_url"),
  };
}

/** The search RPC's rows (app.match_program_search). */
export type SearchRow = {
  id: string;
  company_name: string;
  country: string | null;
  gift_match: boolean;
  volunteer_grant: boolean;
  match_ratio_bp: number | null;
  currency: string;
  max_gift_cents: number | null;
  max_year_cents: number | null;
  portal: string | null;
  religious_orgs: string | null;
  last_verified_on: string | null;
  verified_by_kind: string | null;
  status: string;
  matched_name: string | null;
  how: "same_name" | "part_of_name" | null;
};

export function parseSearch(j: unknown): { total: number; rows: SearchRow[] } {
  const o = (typeof j === "object" && j !== null ? j : {}) as { total?: unknown; rows?: unknown };
  const rows = Array.isArray(o.rows) ? (o.rows as SearchRow[]).filter((r) => r && typeof r.id === "string") : [];
  return { total: typeof o.total === "number" ? o.total : rows.length, rows };
}

/** "Same name" / "Part of the name" / "Chosen from the directory". */
export function howText(how: string | null | undefined): string {
  if (how === "same_name") return "Same name";
  if (how === "part_of_name") return "Part of the name";
  if (how === "chosen") return "Chosen from the directory";
  return "";
}
