// Automatic emails (0770): what each automatic email may say, as mail-merge placeholders.
//
// One merge language for every message Weaver sends: {{name}}, letters, digits and underscores, the same placeholders every
// platform template has used since 0220 (app.render_message_text fills them when the message is queued). A name is grouped by
// what it describes ("payment_", "pledge_", "event_") so the picker can show it in a group; the groups are words only, the
// renderer never reads a dot or a path.
//
// The lists here and app._email_placeholders (supabase/migrations/0770_automatic_emails.sql) are the same lists: the database
// refuses wording that uses a name the email does not have, and tests/merge-catalogue.test.ts keeps the two equal.
//
// Pure (no "@/" imports): the background service imports it too (worker/src/handlers/messaging.compose.ts).

export const EMAIL_TRIGGERS = ["payment_receipt", "pledge_recorded", "registration_confirmed"] as const;
export type EmailTrigger = (typeof EMAIL_TRIGGERS)[number];

export function isEmailTrigger(v: unknown): v is EmailTrigger {
  return typeof v === "string" && (EMAIL_TRIGGERS as readonly string[]).includes(v);
}

// Scheduled emails (0771): an audience the community chooses, with the data each household gets.
export const SCHEDULE_AUDIENCES = ["pledges_due_soon", "pledges_past_due", "gave_recently"] as const;
export type ScheduleAudience = (typeof SCHEDULE_AUDIENCES)[number];

export function isScheduleAudience(v: unknown): v is ScheduleAudience {
  return typeof v === "string" && (SCHEDULE_AUDIENCES as readonly string[]).includes(v);
}

/** What a placeholder list belongs to: an automatic email, or a scheduled email's audience ("schedule:pledges_due_soon"). */
export type MergeKey = EmailTrigger | `schedule:${ScheduleAudience}`;

export function scheduleKey(audience: ScheduleAudience): MergeKey {
  return `schedule:${audience}`;
}

export type Placeholder = {
  /** What goes between the braces: {{payment_amount}}. */
  name: string;
  /** The picker's words. */
  label: string;
  /** The picker's group. */
  group: "Community" | "Recipient" | "Household" | "Payment" | "Pledge" | "Event" | "Pledges" | "Gifts";
  /** A list, one line per item: in the email only, never the subject (the database refuses it there). */
  multiline?: boolean;
  /** What a preview shows when there is no record to take the value from. */
  sample: string;
  /** What the email says when the record has no value (an empty string leaves the line blank). */
  missing: string;
};

const COMMUNITY: Placeholder[] = [
  { name: "center_name", label: "Community name", group: "Community", sample: "Riverside Community Center", missing: "" },
  { name: "center_short_name", label: "Community short name", group: "Community", sample: "Riverside", missing: "" },
];

// Adults only: the person the email goes to, and the household with the first names of its members under the age of majority
// taken out of its name. A child's name never appears in an automatic email.
const PEOPLE: Placeholder[] = [
  { name: "recipient_first_name", label: "Recipient's first name", group: "Recipient", sample: "Alex", missing: "friend" },
  { name: "recipient_name", label: "Recipient's full name", group: "Recipient", sample: "Alex Rivera", missing: "" },
  { name: "household_name", label: "Household name", group: "Household", sample: "Rivera household", missing: "your household" },
  { name: "household_number", label: "Household number", group: "Household", sample: "H-1042", missing: "not numbered yet" },
];

export const PLACEHOLDERS: Record<MergeKey, Placeholder[]> = {
  payment_receipt: [
    ...COMMUNITY,
    ...PEOPLE,
    { name: "payment_amount", label: "Amount", group: "Payment", sample: "$250.00", missing: "" },
    { name: "payment_date", label: "Date received", group: "Payment", sample: "October 13, 2026", missing: "" },
    { name: "payment_method", label: "How it was paid", group: "Payment", sample: "Check", missing: "" },
    { name: "payment_receipt_number", label: "Receipt number", group: "Payment", sample: "R-100231", missing: "" },
    { name: "payment_applied_to", label: "What it was given to", group: "Payment", sample: "General Fund", missing: "the community's work" },
    { name: "payment_receipt_name", label: "Name on the receipt", group: "Payment", sample: "Alex Rivera", missing: "" },
    { name: "receipt_signed_by", label: "Signed by (Statements settings)", group: "Payment", sample: "The Treasurer", missing: "" },
    { name: "receipt_note", label: "Personal note (Statements settings)", group: "Payment", sample: "Thank you for your generosity.", missing: "" },
  ],
  pledge_recorded: [
    ...COMMUNITY,
    ...PEOPLE,
    { name: "pledge_amount", label: "Amount pledged", group: "Pledge", sample: "$1,000.00", missing: "" },
    { name: "pledge_number", label: "Pledge number", group: "Pledge", sample: "P-2087", missing: "" },
    { name: "pledge_date", label: "Date pledged", group: "Pledge", sample: "October 13, 2026", missing: "" },
    { name: "pledge_due_date", label: "Due date", group: "Pledge", sample: "December 31, 2026", missing: "no due date set" },
    { name: "pledge_for", label: "What it is for", group: "Pledge", sample: "Building Fund", missing: "the community's work" },
    { name: "pledge_balance", label: "Still to pay", group: "Pledge", sample: "$1,000.00", missing: "" },
    { name: "pledge_signed_by", label: "Signed by (Statements settings)", group: "Pledge", sample: "The Treasurer", missing: "" },
    { name: "pledge_note", label: "Personal note (Statements settings)", group: "Pledge", sample: "Thank you for your commitment.", missing: "" },
  ],
  registration_confirmed: [
    ...COMMUNITY,
    ...PEOPLE,
    { name: "event_title", label: "Event name", group: "Event", sample: "Autumn Gathering", missing: "" },
    { name: "event_number", label: "Event number", group: "Event", sample: "EV-912", missing: "" },
    { name: "event_date", label: "Date", group: "Event", sample: "Saturday, November 7, 2026", missing: "date to be announced" },
    { name: "event_time", label: "Start time", group: "Event", sample: "6:30 PM", missing: "time to be announced" },
    { name: "event_place", label: "Place", group: "Event", sample: "Main Hall", missing: "place to be announced" },
    { name: "registration_count", label: "How many are registered", group: "Event", sample: "3", missing: "" },
  ],
  "schedule:pledges_due_soon": [...COMMUNITY, ...PEOPLE, ...pledgeList("due soon")],
  "schedule:pledges_past_due": [...COMMUNITY, ...PEOPLE, ...pledgeList("past due")],
  "schedule:gave_recently": [
    ...COMMUNITY,
    ...PEOPLE,
    { name: "gifts_list", label: "The gifts, one per line", group: "Gifts", multiline: true, sample: "October 3, 2026 · $250.00 · General Fund\nOctober 10, 2026 · $100.00 · Building Fund", missing: "" },
    { name: "gifts_count", label: "How many gifts", group: "Gifts", sample: "2", missing: "" },
    { name: "gifts_total", label: "Total given", group: "Gifts", sample: "$350.00", missing: "" },
    { name: "gifts_period", label: "The dates it covers", group: "Gifts", sample: "September 13, 2026 – October 12, 2026", missing: "" },
  ],
};

function pledgeList(which: string): Placeholder[] {
  return [
    { name: "pledges_list", label: `The pledges ${which}, one per line`, group: "Pledges", multiline: true, sample: "P-2087 · Building Fund · $750.00 · December 31, 2026", missing: "" },
    { name: "pledges_count", label: "How many pledges", group: "Pledges", sample: "1", missing: "" },
    { name: "pledges_balance", label: "Total still to pay", group: "Pledges", sample: "$750.00", missing: "" },
    { name: "next_due_date", label: "The earliest due date", group: "Pledges", sample: "December 31, 2026", missing: "" },
  ];
}

export function placeholdersFor(key: MergeKey): Placeholder[] {
  return PLACEHOLDERS[key];
}

export function placeholderNames(key: MergeKey): string[] {
  return PLACEHOLDERS[key].map((p) => p.name);
}

/** The list placeholders of this email (never in a subject). */
export function multilineNames(key: MergeKey): string[] {
  return PLACEHOLDERS[key].filter((p) => p.multiline).map((p) => p.name);
}

/** The picker's groups, in order, each with its placeholders. */
export function placeholderGroups(key: MergeKey): { group: Placeholder["group"]; items: Placeholder[] }[] {
  const out: { group: Placeholder["group"]; items: Placeholder[] }[] = [];
  for (const p of PLACEHOLDERS[key]) {
    const g = out.find((x) => x.group === p.group);
    if (g) g.items.push(p);
    else out.push({ group: p.group, items: [p] });
  }
  return out;
}

/** What each automatic email is, in the owner's words. */
export const TRIGGER_INFO: Record<EmailTrigger, { title: string; when: string; module: "giving" | "events"; manage: string; view: string[] }> = {
  payment_receipt: {
    title: "Receipt for a payment",
    when: "When a payment is recorded or a card payment goes through · to the payer, else the household's adults · not for imported history, opening balances or uploaded donations (unless switched on below)",
    module: "giving",
    manage: "giving.manage",
    view: ["giving.view", "giving.manage"],
  },
  pledge_recorded: {
    title: "Pledge confirmation",
    when: "ON BY DEFAULT: when a pledge is recorded, by a member, by staff one at a time or in a bulk upload · to the household's primary member, with the pledge attached as a PDF in your branding · once per pledge · not for fees, recurring gift cycles, store orders, registrations, imported pledges or pledges dated more than 30 days ago",
    module: "giving",
    manage: "giving.manage",
    view: ["giving.view", "giving.manage"],
  },
  registration_confirmed: {
    title: "Registration confirmation",
    when: "When someone registers (RSVPs) for an event that has not started · to the adult who registered, else the household's adults, or the guest's email · not for imported registrations",
    module: "events",
    manage: "events.manage",
    view: ["events.view", "events.manage"],
  },
};

/** Each audience a scheduled email can go to, in the owner's words. */
export const AUDIENCE_INFO: Record<ScheduleAudience, { title: string; describe: (p: ScheduleParams) => string }> = {
  pledges_due_soon: {
    title: "Pledges due soon",
    describe: (p) =>
      `Households with an open pledge due in the next ${p.days ?? 7} day${(p.days ?? 7) === 1 ? "" : "s"}${p.since ? `, made on or after ${p.since}` : ""}${p.include_imported ? ", imported pledges included" : ""}`,
  },
  pledges_past_due: {
    title: "Pledges past due",
    describe: (p) => `Households with an open pledge whose due date has passed${p.since ? `, made on or after ${p.since}` : ""}${p.include_imported ? ", imported pledges included" : ", imported pledges left out"}`,
  },
  gave_recently: {
    title: "Givers since the last email",
    describe: () => "Households that gave since the previous run (the day, week, month or year before each run), with what they gave",
  },
};

export type ScheduleParams = { days?: number; since?: string | null; include_imported?: boolean };
