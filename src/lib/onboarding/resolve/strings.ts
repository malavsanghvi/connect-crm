// Every sentence a person reads from the resolve engine. English now; the Gujarati (gu) and Hindi (hi) keys are present and
// empty, and a missing translation falls back to English, so nothing is ever blank. Plain words, no jargon.
// Placeholders: {n} is a count; plural variants end in ".one".

export type Locale = "en" | "gu" | "hi";

type Entry = { en: string; gu: string | null; hi: string | null };
const s = (en: string): Entry => ({ en, gu: null, hi: null });

export const STRINGS = {
  // --- the question shell
  "q.same_for_rest": s("Use the same answer for the other {n}"),
  "q.same_for_rest.one": s("Use the same answer for the other one"),
  "q.same_for_rest.no_hold": s("Each of these needs its own answer, because it involves money"),
  "q.remember": s("Remember this answer so I am not asked again"),
  "q.not_remembered_hold": s("Answers about children and money are never remembered"),
  "q.route.treasurer": s("Send this to the treasurer"),
  "q.route.membership": s("Send this to the membership coordinator"),
  "q.skip": s("Ask me later"),

  // --- tier C questions
  "q.spouse_maiden_name.title": s("{n} rows list someone at the same address as a household, but under a different family name (for example a spouse using a maiden name). Are they part of that household?"),
  "q.spouse_maiden_name.title.one": s("1 row lists someone at the same address as a household, but under a different family name (for example a spouse using a maiden name). Is this person part of that household?"),
  "q.spouse_maiden_name.detail": s("The address matches. The family names differ."),
  "q.shared_phone_households.title": s("{n} rows share a phone number with a household that has a different address and family name. Are they the same household?"),
  "q.shared_phone_households.title.one": s("1 row shares a phone number with a household that has a different address and family name. Are they the same household?"),
  "q.shared_phone_households.detail": s("The phone number matches. Nothing else does."),
  "q.address_unit_differs.title": s("{n} rows are at the same street address as another household, but in a different apartment or unit. Are they the same household?"),
  "q.address_unit_differs.title.one": s("1 row is at the same street address as another household, but in a different apartment or unit. Are they the same household?"),
  "q.address_unit_differs.detail": s("The street address matches. The apartment or unit differs."),
  "q.shared_email_households.title": s("{n} rows use an e-mail address that also belongs to another household. Are they the same household?"),
  "q.shared_email_households.title.one": s("1 row uses an e-mail address that also belongs to another household. Is it the same household?"),
  "q.shared_email_households.detail": s("The e-mail address matches. Nothing else does."),
  "q.name_only.title": s("{n} rows have the same name as someone already known, with nothing else to compare (no phone, e-mail or address). Are they the same person?"),
  "q.name_only.title.one": s("1 row has the same name as someone already known, with nothing else to compare (no phone, e-mail or address). Is it the same person?"),
  "q.name_only.detail": s("Only the name matches. A name alone is never enough to join two records."),
  "q.birth_year_differs.title": s("{n} pairs share contact details but have different birth years or Jr/Sr marks (often a parent and child with the same name). Are they the same person?"),
  "q.birth_year_differs.title.one": s("1 pair shares contact details but has different birth years or Jr/Sr marks (often a parent and child with the same name). Are they the same person?"),
  "q.birth_year_differs.detail": s("The contact details match, but the birth years or Jr/Sr marks disagree."),
  "q.ids_differ.title": s("{n} pairs look like one person but carry different IDs in the same system. Are they the same person?"),
  "q.ids_differ.title.one": s("1 pair looks like one person but carries different IDs in the same system. Are they the same person?"),
  "q.ids_differ.detail": s("The details match, but the two records have different IDs in the system they came from."),
  "q.id_name_differs.title": s("{n} pairs have the same ID but different names. Are they the same person?"),
  "q.id_name_differs.title.one": s("1 pair has the same ID but different names. Is it the same person?"),
  "q.id_name_differs.detail": s("The ID matches. The names differ."),
  "q.duplicate_gift_two_sources.title": s("{n} gifts may appear in both sources (same amount, same date), but the donor details do not fully match. Is each one the same gift?"),
  "q.duplicate_gift_two_sources.title.one": s("1 gift may appear in both sources (same amount, same date), but the donor details do not fully match. Is it the same gift?"),
  "q.duplicate_gift_two_sources.detail": s("The amount and date match. If it is the same gift it should be loaded once."),
  "q.low_confidence_read.title": s("{n} rows were read from a photo or page, and some values may be wrong. Please check them beside the picture."),
  "q.low_confidence_read.title.one": s("1 row was read from a photo or page, and some values may be wrong. Please check it beside the picture."),
  "q.low_confidence_read.detail": s("The reader was not sure about at least one value on each row."),
  "q.linked_through_another_record.title": s("{n} rows would be linked only through a third row that disagrees with them. Are they in the same household?"),
  "q.linked_through_another_record.title.one": s("1 row would be linked only through a third row that disagrees with it. Is it in the same household?"),
  "q.linked_through_another_record.detail": s("Each link looks right on its own, but the rows at the two ends contradict each other."),

  // --- tier D (held)
  "q.amount_differs_cents.title": s("{n} gifts appear in both sources, but the amounts differ by a few cents. Which amount is right?"),
  "q.amount_differs_cents.title.one": s("1 gift appears in both sources, but the amounts differ by a few cents. Which amount is right?"),
  "q.amount_differs_cents.detail": s("This is money, so a person decides each one. Nothing is loaded until then."),
  "q.amount_differs.title": s("{n} gifts appear in both sources with different amounts. Which amount is right?"),
  "q.amount_differs.title.one": s("1 gift appears in both sources with different amounts. Which amount is right?"),
  "q.amount_differs.detail": s("This is money, so a person decides each one. Nothing is loaded until then."),
  "q.minor_record.title": s("{n} rows are about people under 18. They are held for a person; nothing about them is sent to an AI service."),
  "q.minor_record.title.one": s("1 row is about a person under 18. It is held for a person; nothing about it is sent to an AI service."),
  "q.minor_record.detail": s("Children are never matched or decided by software."),
  "q.uncertain_type.title": s("{n} rows could not be told apart as a person, a household or a gift. What are they?"),
  "q.uncertain_type.title.one": s("1 row could not be told apart as a person, a household or a gift. What is it?"),
  "q.uncertain_type.detail": s("Nobody guesses the kind of a record."),
  "q.unreadable_money.title": s("{n} gifts have an amount that is blank, zero, negative or could not be read. Please fix them."),
  "q.unreadable_money.title.one": s("1 gift has an amount that is blank, zero, negative or could not be read. Please fix it."),
  "q.unreadable_money.detail": s("A gift is never loaded without a clear amount."),

  // --- answers
  "a.same_household": s("Yes, same household"),
  "a.same_person": s("Yes, same person"),
  "a.separate": s("No, keep them separate"),
  "a.same_gift": s("Yes, load it once"),
  "a.different_gifts": s("No, they are different gifts. Load both"),
  "a.use_first": s("Use the amount from the first source"),
  "a.use_second": s("Use the amount from the second source"),
  "a.hold": s("Leave it on hold for the treasurer"),
  "a.person_will_add": s("A person will add them with their family"),
  "a.ignore_row": s("Leave them out of this import"),
  "a.is_person": s("They are people"),
  "a.is_household": s("They are households"),
  "a.confirm_read": s("The values were read correctly"),
  "a.fix_in_source": s("I will fix them in the source file"),

  // --- evidence and budget lines
  "e.row": s("Row {row} of {source}"),
  "e.row.held": s("Row {row} of {source} (details withheld)"),
  "b.within": s("{questions} questions for {rows} rows ({per1000} per 1,000). That is within the target of {target}."),
  "b.over": s("{questions} questions for {rows} rows ({per1000} per 1,000). The target is {target}."),
} as const satisfies Record<string, Entry>;

export type StringKey = keyof typeof STRINGS;

/** The text for a key in a locale, falling back to English. `{name}` placeholders are filled from `params`. */
export function text(key: StringKey, locale: Locale = "en", params: Record<string, string | number> = {}): string {
  let k: StringKey = key;
  if (params.n === 1 && `${key}.one` in STRINGS) k = `${key}.one` as StringKey;
  const entry: Entry = STRINGS[k];
  const raw = (locale === "gu" ? entry.gu : locale === "hi" ? entry.hi : entry.en) ?? entry.en;
  return raw.replace(/\{(\w+)\}/g, (_m, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

/** Every key has an English string and gu / hi slots, so a translator can fill them in without touching code. */
export function missingTranslations(locale: "gu" | "hi"): StringKey[] {
  return (Object.keys(STRINGS) as StringKey[]).filter((k) => STRINGS[k as StringKey][locale] === null);
}
