// From the facts the database hands over (app._email_facts, 0770) to the values of one email's placeholders. The background
// service fills the email with them (worker/src/handlers/messaging.compose.ts); the portal's preview uses the same function on
// a recent real record, so what the preview shows is what the email says.
//
// Pure (no "@/" imports): the background service imports it too.

import { PAYMENT_METHOD_LABEL } from "../labels";
import { PLACEHOLDERS, type EmailTrigger } from "./catalogue";
import { emailDay, emailEventDay, emailList, emailMoney, emailPlace, emailTime, type EmailPlace } from "./format";
import { householdNameForEmail, withoutChildNames } from "./household-name";
import { oneLine } from "./render";

export type EmailRecipient = {
  person_id: string | null;
  address: string;
  first_name: string | null;
  name: string | null;
  language: string | null;
};

/** What app._email_facts returns (every field may be missing or null). */
export type EmailFacts = {
  trigger?: string;
  skip?: string | null;
  center?: { name?: string | null; short_name?: string | null; currency?: string | null; time_zone?: string | null; country?: string | null; languages?: string[] | null } | null;
  household?: { id?: string | null; name?: string | null; number?: string | null; minor_first_names?: string[] | null } | null;
  payment?: { amount_cents?: number | null; received_on?: string | null; method?: string | null; receipt_number?: string | null; receipt_name?: string | null; applied_to?: string[] | null } | null;
  pledge?: { amount_cents?: number | null; paid_cents?: number | null; number?: string | null; pledged_at?: string | null; due_on?: string | null; for?: string | null } | null;
  event?: { name?: string | null; number?: string | null; starts_at?: string | null; venue?: string | null } | null;
  registration?: { count?: number | null } | null;
  wording?: { signed_by?: string | null; personal_note?: string | null } | null;
  recipients?: EmailRecipient[] | null;
  automation?: { id?: string; key?: string; template_key?: string } | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Values for one email: null where the record has none. Recipient null = the preview's first recipient. */
export function factValues(trigger: EmailTrigger, facts: EmailFacts, recipient: EmailRecipient | null, place: EmailPlace = emailPlace(facts.center)): Record<string, string | null> {
  const r = recipient ?? facts.recipients?.[0] ?? null;
  const minors = facts.household?.minor_first_names ?? [];
  const v: Record<string, string | null> = {
    center_name: text(facts.center?.name),
    center_short_name: text(facts.center?.short_name) ?? text(facts.center?.name),
    recipient_first_name: text(r?.first_name),
    recipient_name: text(r?.name),
    household_name: householdNameForEmail(text(facts.household?.name), minors),
    household_number: text(facts.household?.number),
  };
  if (trigger === "payment_receipt") {
    const p = facts.payment ?? {};
    const method = text(p.method);
    v.payment_amount = emailMoney(p.amount_cents, place);
    v.payment_date = emailDay(p.received_on, place);
    v.payment_method = method ? (PAYMENT_METHOD_LABEL[method] ?? method.replace(/_/g, " ")) : null;
    v.payment_receipt_number = text(p.receipt_number);
    v.payment_applied_to = emailList(p.applied_to ?? [], place);
    v.payment_receipt_name = text(p.receipt_name);
    v.receipt_signed_by = text(facts.wording?.signed_by);
    v.receipt_note = text(facts.wording?.personal_note);
  } else if (trigger === "pledge_recorded") {
    const p = facts.pledge ?? {};
    const amount = typeof p.amount_cents === "number" ? p.amount_cents : null;
    v.pledge_amount = emailMoney(amount, place);
    v.pledge_number = text(p.number);
    v.pledge_date = emailDay(p.pledged_at, place);
    v.pledge_due_date = emailDay(p.due_on, place);
    v.pledge_for = text(p.for);
    v.pledge_balance = amount === null ? null : emailMoney(Math.max(0, amount - (Number(p.paid_cents) || 0)), place);
    v.pledge_signed_by = text(facts.wording?.signed_by);
    v.pledge_note = text(facts.wording?.personal_note);
  } else {
    const e = facts.event ?? {};
    const n = facts.registration?.count;
    v.event_title = text(e.name);
    v.event_number = text(e.number);
    v.event_date = emailEventDay(e.starts_at, place);
    v.event_time = emailTime(e.starts_at, place);
    v.event_place = text(e.venue);
    v.registration_count = typeof n === "number" && n > 0 ? new Intl.NumberFormat(place.locale).format(n) : null;
  }
  return guardChildren(v, minors);
}

// A child's name never appears in an automatic email: any value that still mentions one (a fund named after a child, a name
// typed into an event title) has it replaced. The recipient is an adult whose first name is not on the list (the database
// leaves out a first name an adult of the household shares).
function guardChildren(values: Record<string, string | null>, minorFirstNames: readonly string[]): Record<string, string | null> {
  if (minorFirstNames.length === 0) return values;
  const out: Record<string, string | null> = {};
  for (const [k, val] of Object.entries(values)) out[k] = val === null || k.startsWith("recipient_") ? val : withoutChildNames(val, minorFirstNames) || null;
  return out;
}

/** What the email says for each placeholder: the value, else the email's own wording for a value the record lacks. */
export function sendValues(trigger: EmailTrigger, values: Readonly<Record<string, string | null>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PLACEHOLDERS[trigger]) {
    const val = values[p.name];
    out[p.name] = oneLine(val === null || val === undefined || val === "" ? p.missing : val);
  }
  return out;
}

/** The email's wording for a value the record lacks, by name. */
export function missingWords(trigger: EmailTrigger): Record<string, string> {
  return Object.fromEntries(PLACEHOLDERS[trigger].map((p) => [p.name, p.missing]));
}

/** Made-up values for a preview when the community has no record of this kind yet. */
export function sampleValues(trigger: EmailTrigger): Record<string, string> {
  return Object.fromEntries(PLACEHOLDERS[trigger].map((p) => [p.name, p.sample]));
}
