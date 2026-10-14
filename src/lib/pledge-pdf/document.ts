// What the pledge PDF says, before anything is drawn. One pledge becomes an invoice-style document in the community's own words,
// money, dates and time zone, branded with the community's colours and logo. The same builder serves the Print route in the
// portal and the copy attached to the pledge email (the background service), so the two never differ in what they say.
//
// Input: what app._pledge_document_core (0791) returns, with every field optional. Output: a flat, already formatted view that
// src/lib/pledge-pdf/render.ts draws. Money is integer cents until this file formats it, at the edge.
//
// Pure (no "@/" imports, no I/O): the background service imports it too.

import { brandingUrl } from "../messaging/email";
import { PAYMENT_METHOD_LABEL, PLEDGE_STATUS_LABEL } from "../labels";
import { emailDay, emailPlace, type EmailPlace } from "../merge/format";
import { householdNameForEmail } from "../merge/household-name";
import { drawableMoney, drawer } from "./text";

export type PledgeDocAddress = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  state_region?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

/** What app._pledge_document_core returns. Every field may be missing or null. */
export type PledgeDocData = {
  center?: {
    id?: string | null;
    name?: string | null;
    short_name?: string | null;
    currency?: string | null;
    time_zone?: string | null;
    country?: string | null;
    languages?: string[] | null;
    household_label?: string | null;
    branding?: {
      logo_path?: string | null;
      email_header_path?: string | null;
      mark_path?: string | null;
      primary?: string | null;
      accent?: string | null;
      address?: string | null;
    } | null;
  } | null;
  organization?: {
    legal_name?: string | null;
    dba?: string | null;
    ein?: string | null;
    address?: PledgeDocAddress | null;
    public_email?: string | null;
    public_phone?: string | null;
    website?: string | null;
    office_hours?: string | null;
  } | null;
  pledge?: {
    id?: string | null;
    number?: string | null;
    status?: string | null;
    pledged_at?: string | null;
    due_on?: string | null;
    amount_cents?: number | null;
    paid_cents?: number | null;
    installments?: number | null;
    dedication?: string | null;
    campaign?: string | null;
    fund?: string | null;
    opportunity?: string | null;
    opportunity_option?: string | null;
    pledged_by?: string | null;
  } | null;
  household?: {
    id?: string | null;
    name?: string | null;
    number?: string | null;
    org_household_id?: string | null;
    primary_member?: string | null;
    primary_org_member_id?: string | null;
    minor_first_names?: string[] | null;
    address?: PledgeDocAddress | null;
  } | null;
  payments?: { received_on?: string | null; method?: string | null; receipt_number?: string | null; amount_cents?: number | null }[] | null;
  wording?: { signed_by?: string | null; personal_note?: string | null } | null;
};

export type PledgeDocView = {
  paper: "letter" | "a4";
  communityName: string;
  /** Under the name in the header: the legal name when it differs, the address, the contact lines. */
  communityLines: string[];
  /** Logo files in the order to try (the public branding bucket); the first PNG or JPEG that loads is drawn. */
  logoUrls: string[];
  brand: { primary: string; accent: string };
  title: string;
  number: string;
  facts: { label: string; value: string }[];
  familyHeading: string;
  family: { name: string; lines: string[] };
  /** What the pledge is for: campaign, fund, opportunity, dedication, who pledged. */
  purpose: { label: string; value: string }[];
  amounts: { label: string; value: string; strong?: boolean }[];
  balanceCents: number;
  payments: { date: string; method: string; reference: string; amount: string }[];
  paymentsEmpty: string;
  paymentsTotal: string | null;
  instalments: string | null;
  note: string | null;
  signedBy: string | null;
  howToPay: string;
  footer: string[];
  /** Said on the page when a character the built-in font cannot draw had to be replaced. */
  fontNote: string | null;
  fileName: string;
  generatedOn: string;
};

// Until a community chooses its own colours, a pledge document carries Weaver's: the kit's navy and brown (brand/tokens.json; this
// file is shared with the background service, so it cannot import the kit, and tests/brand-conformance.test.ts checks the values).
const DEFAULT_PRIMARY = "#2B2A8A";
const DEFAULT_ACCENT = "#A8400D";
const HEX = /^#?([0-9a-fA-F]{6})$/;

const LETTER_COUNTRIES = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "CR", "DO", "PA"]);

function hexOr(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const m = HEX.exec(v.trim());
  return m ? `#${m[1]!.toUpperCase()}` : fallback;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const cents = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : 0);

/** Money in the community's currency and locale, drawn with the symbol when Helvetica has it, else with the currency code. Integer cents in. */
export function pdfMoney(value: number, place: EmailPlace): string {
  const whole = Math.round(value);
  const abs = Math.abs(whole);
  const dollars = Math.trunc(abs / 100);
  const rest = abs % 100;
  const format = (display: "symbol" | "code") => {
    let formatted: string;
    try {
      const f = new Intl.NumberFormat(place.locale, { style: "currency", currency: place.currency, currencyDisplay: display, minimumFractionDigits: 2, maximumFractionDigits: 2 });
      formatted = f
        .formatToParts(dollars)
        .map((p) => (p.type === "fraction" ? String(rest).padStart(2, "0") : p.value))
        .join("");
    } catch {
      const f = new Intl.NumberFormat("en-US", { style: "currency", currency: place.currency, currencyDisplay: display, minimumFractionDigits: 2, maximumFractionDigits: 2 });
      formatted = f
        .formatToParts(dollars)
        .map((p) => (p.type === "fraction" ? String(rest).padStart(2, "0") : p.value))
        .join("");
    }
    return whole < 0 ? `-${formatted}` : formatted;
  };
  return drawableMoney(format);
}

function addressLines(a: PledgeDocAddress | null | undefined): string[] {
  if (!a) return [];
  const region = text(a.state) ?? text(a.state_region);
  const cityLine = [text(a.city), [region, text(a.postal_code)].filter(Boolean).join(" ")].filter((x) => x && x.trim() !== "").join(", ");
  return [text(a.line1), text(a.line2), cityLine, text(a.country)].filter((x): x is string => !!x && x.trim() !== "");
}

/** A file name for the PDF: "Pledge-PL-0455-Riverside-Community-Center.pdf", plain letters, digits and dashes. */
export function pledgePdfFileName(number: string | null | undefined, communityName: string | null | undefined): string {
  const clean = (s: string | null | undefined, max: number) =>
    (s ?? "")
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "");
  const parts = ["Pledge", clean(number, 30), clean(communityName, 40)].filter((p) => p !== "");
  return `${parts.join("-")}.pdf`;
}

/** The paper for a community's country: US Letter where it is used, A4 elsewhere. */
export function paperFor(country: string | null | undefined): "letter" | "a4" {
  return LETTER_COUNTRIES.has((country ?? "").trim().toUpperCase()) ? "letter" : "a4";
}

export type BuildOptions = {
  /** The Supabase project's URL, to turn a branding file path into its public address. */
  supabaseUrl?: string | null;
  /** Now, for "Prepared on". */
  now?: Date;
};

export function buildPledgeDocument(data: PledgeDocData, opts: BuildOptions = {}): PledgeDocView {
  const d = drawer();
  const place = emailPlace(data.center);
  const money = (c: number) => pdfMoney(c, place);
  const center = data.center ?? {};
  const org = data.organization ?? {};
  const p = data.pledge ?? {};
  const h = data.household ?? {};
  const branding = center.branding ?? {};

  const communityName = d.line(text(center.name) ?? "Community", 120);
  const legal = text(org.legal_name);
  const dba = text(org.dba);
  const orgAddress = addressLines(org.address);
  const address = orgAddress.length > 0 ? orgAddress : (text(branding.address) ? [text(branding.address)!] : []);
  const contact = [text(org.public_phone), text(org.public_email), text(org.website)].filter((x): x is string => !!x);
  const communityLines = [
    legal && legal.toLowerCase() !== (text(center.name) ?? "").toLowerCase() ? legal : dba && dba.toLowerCase() !== (text(center.name) ?? "").toLowerCase() ? dba : null,
    ...address,
    contact.join(" · ") || null,
  ]
    .filter((x): x is string => !!x)
    .map((x) => d.line(x, 160));

  const logoUrls = [branding.logo_path, branding.email_header_path, branding.mark_path]
    .map((path) => brandingUrl(opts.supabaseUrl ?? null, text(path)))
    .filter((u, i, all): u is string => !!u && all.indexOf(u) === i);

  const amountCents = cents(p.amount_cents);
  const paidCents = cents(p.paid_cents);
  const status = text(p.status) ?? "open";
  // A pledge that is paid, written off or cancelled owes nothing, whatever its paid-to-date says.
  const balanceCents = status === "open" || status === "partially_paid" ? Math.max(0, amountCents - paidCents) : 0;

  const number = d.line(text(p.number) ?? "Not numbered yet", 40);
  const facts: { label: string; value: string }[] = [
    { label: "Pledge number", value: number },
    { label: "Date made", value: d.line(emailDay(text(p.pledged_at), place) ?? "—", 60) },
    { label: "Due date", value: d.line(emailDay(text(p.due_on), place) ?? "—", 60) },
    { label: "Status", value: d.line(PLEDGE_STATUS_LABEL[status] ?? status.replace(/_/g, " "), 40) },
  ];

  const householdName = householdNameForEmail(text(h.name), h.minor_first_names ?? []);
  const familyLines = [
    text(h.number) ? `Household number ${h.number}` : null,
    text(h.org_household_id) ? `${text(center.household_label) ?? "Household ID"} ${h.org_household_id}` : null,
    text(h.primary_member) ? `Primary member: ${h.primary_member}` : null,
    ...addressLines(h.address),
  ]
    .filter((x): x is string => !!x)
    .map((x) => d.line(x, 160));

  const forWhat = text(p.opportunity) ? `${text(p.opportunity)}${text(p.opportunity_option) ? ` (${text(p.opportunity_option)})` : ""}` : null;
  const purpose = [
    { label: "Campaign", value: text(p.campaign) },
    { label: "Fund", value: text(p.fund) },
    { label: "For", value: forWhat },
    { label: "Dedication", value: text(p.dedication) },
    { label: "Pledged by", value: text(p.pledged_by) },
  ]
    .filter((x): x is { label: string; value: string } => !!x.value)
    .map((x) => ({ label: x.label, value: d.line(x.value, 200) }));

  const payments = (data.payments ?? []).map((x) => {
    const method = text(x.method);
    return {
      date: d.line(emailDay(text(x.received_on), place) ?? "—", 60),
      method: d.line(method ? (PAYMENT_METHOD_LABEL[method] ?? method.replace(/_/g, " ")) : "—", 40),
      reference: d.line(text(x.receipt_number) ?? "—", 40),
      amount: money(cents(x.amount_cents)),
    };
  });
  const listedCents = (data.payments ?? []).reduce((sum, x) => sum + cents(x.amount_cents), 0);

  const amounts = [
    { label: "Amount pledged", value: money(amountCents) },
    { label: "Paid to date", value: money(paidCents) },
    { label: status === "open" || status === "partially_paid" ? "Balance due" : "Balance", value: money(balanceCents), strong: true },
  ];

  const instalments = typeof p.installments === "number" && p.installments > 1 ? `To be paid in ${p.installments} instalments. The pledge is due on ${facts[2]!.value}.` : null;

  const note = text(data.wording?.personal_note);
  const signedBy = text(data.wording?.signed_by);

  const contactBits = [text(org.public_phone), text(org.public_email)].filter((x): x is string => !!x);
  const howToPay =
    `To pay this pledge, contact ${text(center.name) ?? "the community"}${contactBits.length > 0 ? ` (${contactBits.join(" or ")})` : ""} and quote pledge ${text(p.number) ?? "number"}.` +
    (text(org.office_hours) ? ` Office hours: ${text(org.office_hours)}.` : "");

  const taxId = text(org.ein);
  const footer = [
    [legal ?? text(center.name), taxId ? `${(center.country ?? "").toUpperCase() === "US" ? "EIN" : "Tax ID"} ${taxId}` : null].filter(Boolean).join(" · "),
    "This is a record of a pledge, not a receipt. A payment toward it is acknowledged by its own receipt.",
  ]
    .filter((x) => x.trim() !== "")
    .map((x) => d.line(x, 200));

  const now = opts.now ?? new Date();
  const generatedOn = emailDay(now.toISOString(), place) ?? now.toISOString().slice(0, 10);

  const view: PledgeDocView = {
    paper: paperFor(center.country),
    communityName,
    communityLines,
    logoUrls,
    brand: { primary: hexOr(branding.primary, DEFAULT_PRIMARY), accent: hexOr(branding.accent, DEFAULT_ACCENT) },
    title: "PLEDGE",
    number,
    facts,
    familyHeading: "Pledged by",
    family: { name: d.line(householdName ?? "Household", 160), lines: familyLines },
    purpose,
    amounts,
    balanceCents,
    payments,
    paymentsEmpty: "No payment has been applied to this pledge yet.",
    paymentsTotal: payments.length > 0 ? money(listedCents) : null,
    instalments: instalments ? d.line(instalments, 200) : null,
    note: note ? d.line(note, 600) : null,
    signedBy: signedBy ? d.line(signedBy, 160) : null,
    howToPay: d.line(howToPay, 400),
    footer,
    fontNote: null,
    fileName: pledgePdfFileName(text(p.number), text(center.name)),
    generatedOn: d.line(generatedOn, 60),
  };
  if (d.changed()) {
    view.fontNote = "Some letters in a name or address are drawn in a plainer form because this document uses a standard font.";
  }
  return view;
}
