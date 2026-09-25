// The import tool's entity registry: one entry per data type in
// ONBOARDING_PLAN Appendix A that is loaded by upload (setup data, records and
// history). QuickBooks lists are pulled from QuickBooks, never uploaded, so
// they are not here. Pure data — used by the browser (templates, mapping,
// Check), the server (staging) and a test that keeps the database's allow-list
// (app.import_entities, migration 0192) in step with it.
//
// Each field says:
//   column   the database column it fills (sent in the staged row's `data`), or
//   extra    a side value the database applies (a household link, a legacy ID,
//            an email opt-in, an allocation), sent in `extra`;
//   type     how the cell is read (transforms.ts);
//   ref      for a link to another record: how the database finds it (never by
//            a person's or household's name — ARCHITECTURE "Names are never enough").

import type { ModuleKey } from "@/lib/modules";

export type Tier = "setup" | "records" | "history";

export type FieldType =
  | "id"
  | "text"
  | "longtext"
  | "name"
  | "fullname"
  | "email"
  | "phone"
  | "date"
  | "datetime"
  | "time"
  | "money"
  | "integer"
  | "number"
  | "boolean"
  | "enum"
  | "list"
  | "ref";

/** How the database resolves a link (app.import_ref). */
export type RefSpec =
  | { kind: "household"; by?: "legacy" | "number" }
  | { kind: "person"; by?: "legacy" | "number" | "email" }
  | { kind: "pledge" }
  | { kind: "payment" }
  | { kind: "event" }
  | { kind: "gyan_level" }
  | { kind: "pathshala_level" }
  | { kind: "lookup"; table: string; by: string };

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  column?: string;
  extra?: string;
  required?: boolean;
  /** Other header names this column is known by (exports from Neon, NamoCRM, spreadsheets). */
  synonyms?: readonly string[];
  description: string;
  example: string;
  options?: readonly { value: string; label: string }[];
  /** Built-in translations from other systems' words ("Life Member" → life). */
  valueMap?: Readonly<Record<string, string>>;
  ref?: RefSpec;
  /** Personal data: masked before anything leaves for mapping suggestions. */
  personal?: boolean;
  /** Allow zero / negative money. */
  allowZero?: boolean;
};

export type EntityDef = {
  key: string;
  label: string;
  tier: Tier;
  /** Position in Appendix B's load order (lower loads first). */
  order: number;
  table: string;
  module: ModuleKey | null;
  /** The table's own write permission (0010 policies): only people who can manage a data type can import it. */
  writePerms: readonly string[];
  dependsOn: readonly string[];
  description: string;
  /** How an existing record is found, in plain English (shown on the Map and Preview steps). */
  matchNote: string;
  /** Field keys whose values identify a row across re-imports (legacy ID first). */
  sourceKey: readonly string[];
  fields: readonly FieldDef[];
  /** Money fields reconciled against the file. */
  moneyFields?: readonly string[];
  /** Plain note shown on the entity (limits, what is not imported). */
  note?: string;
};

const YES_NO = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
] as const;
void YES_NO;

const TIERS = [
  { value: "community", label: "Community" },
  { value: "yearly", label: "Yearly" },
  { value: "life", label: "Life" },
] as const;

const TIER_WORDS = {
  "Life Member": "life",
  "Lifetime": "life",
  "Life Membership": "life",
  "Annual": "yearly",
  "Annual Member": "yearly",
  "Yearly Member": "yearly",
  "Regular": "yearly",
  "Community Member": "community",
  "Associate": "community",
  "Friend": "community",
} as const;

const MEMBERSHIP_STATUS = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "lapsed", label: "Lapsed" },
  { value: "suspended", label: "Suspended" },
  { value: "ended", label: "Ended" },
] as const;

const PLEDGE_STATUS = [
  { value: "open", label: "Open" },
  { value: "partially_paid", label: "Partially paid" },
  { value: "paid", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
  { value: "written_off", label: "Written off" },
] as const;

const PLEDGE_SOURCE = [
  { value: "general", label: "General" },
  { value: "boli", label: "Boli" },
  { value: "sponsorship", label: "Sponsorship" },
  { value: "pujan", label: "Pujan" },
  { value: "labh", label: "Labh" },
  { value: "construction", label: "Construction" },
  { value: "membership_fee", label: "Membership fee" },
  { value: "pathshala_fee", label: "Pathshala fee" },
  { value: "recurring", label: "Recurring" },
  { value: "other", label: "Other" },
] as const;

const METHODS = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "ach", label: "ACH" },
  { value: "zelle", label: "Zelle" },
  { value: "stock", label: "Stock" },
  { value: "daf", label: "Donor-advised fund" },
  { value: "matching_gift", label: "Matching gift" },
  { value: "apple_pay", label: "Apple Pay" },
  { value: "google_pay", label: "Google Pay" },
  { value: "other", label: "Other" },
] as const;

const METHOD_WORDS = {
  "Credit Card": "card",
  "Visa": "card",
  "Mastercard": "card",
  "Amex": "card",
  "Debit Card": "card",
  "Cheque": "check",
  "Bank Transfer": "ach",
  "EFT": "ach",
  "Wire": "ach",
  "DAF": "daf",
  "Fidelity Charitable": "daf",
  "Schwab Charitable": "daf",
  "Benevity": "matching_gift",
  "Matching": "matching_gift",
  "In Kind": "other",
  "PayPal": "other",
} as const;

const PAYMENT_STATUS = [
  { value: "settled", label: "Settled" },
  { value: "captured", label: "Captured" },
  { value: "failed", label: "Failed" },
  { value: "voided", label: "Voided" },
] as const;

const ROLES = [
  { value: "primary", label: "Primary" },
  { value: "spouse", label: "Spouse" },
  { value: "child", label: "Child" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
] as const;

const ROLE_WORDS = {
  "Head of Household": "primary",
  "Head": "primary",
  "Self": "primary",
  "Husband": "spouse",
  "Wife": "spouse",
  "Partner": "spouse",
  "Son": "child",
  "Daughter": "child",
  "Kid": "child",
  "Dependent": "child",
  "Father": "parent",
  "Mother": "parent",
  "Grandparent": "parent",
  "Brother": "sibling",
  "Sister": "sibling",
} as const;

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
] as const;

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "gu", label: "Gujarati" },
  { value: "hi", label: "Hindi" },
] as const;

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "Text message" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "push", label: "Push" },
] as const;

const ID_KINDS = [
  { value: "org_member", label: "Organization person ID" },
  { value: "org_household", label: "Organization household ID" },
  { value: "crm", label: "Legacy CRM ID" },
  { value: "accounting", label: "Accounting (QuickBooks) customer" },
  { value: "bank_payer", label: "Bank payer name" },
  { value: "payment_provider", label: "Payment-provider customer" },
  { value: "other", label: "Other" },
] as const;

// ── Field helpers ───────────────────────────────────────────────────────────
type Opt = Omit<FieldDef, "key" | "label" | "type" | "description" | "example">;
const col = (key: string, label: string, type: FieldType, description: string, example: string, o: Opt = {}): FieldDef => ({
  key,
  label,
  type,
  column: o.column ?? (o.extra ? undefined : key),
  description,
  example,
  ...o,
});
const extra = (key: string, label: string, type: FieldType, description: string, example: string, o: Opt = {}): FieldDef => ({
  key,
  label,
  type,
  extra: key,
  description,
  example,
  ...o,
});
/** Where a link goes: a database column, or a side value (`extra`) the database applies itself. */
type Target = { column: string } | { extra: string };
const target = (t: Target) => ("column" in t ? { column: t.column } : { extra: t.extra, column: undefined });
const householdRef = (t: Target, required = true): FieldDef =>
  col("household_legacy_id", "Household ID (old system)", "ref", "The household's ID in your old system or register. Import households first.", "0212", {
    ...target(t),
    required,
    ref: { kind: "household", by: "legacy" },
    synonyms: ["household id", "household", "family id", "household number", "account id", "hh id", "jsh household id"],
  });
const personRef = (t: Target, required: boolean, label = "Person ID (old system)"): FieldDef =>
  col("person_legacy_id", label, "ref", "The person's ID in your old system or register. Import people first.", "0417", {
    ...target(t),
    required,
    ref: { kind: "person", by: "legacy" },
    synonyms: ["person id", "member id", "contact id", "individual id", "constituent id", "jsh member id"],
  });
const lookup = (
  key: string,
  label: string,
  t: Target | string,
  table: string,
  by: string,
  description: string,
  example: string,
  required = false,
  synonyms: string[] = [],
): FieldDef =>
  col(key, label, "ref", description, example, {
    ...target(typeof t === "string" ? { column: t } : t),
    required,
    ref: { kind: "lookup", table, by },
    synonyms,
  });
const legacyId = (description = "This record's ID in your old system. Re-importing the same ID updates the record instead of adding it twice.", column?: string): FieldDef =>
  col("legacy_id", "ID (old system)", "id", description, "P-1042", {
    column,
    extra: column ? undefined : "legacy_id",
    synonyms: ["id", "legacy id", "old id", "external id", "record id", "neon id", "crm id"],
  });

// ── The registry ────────────────────────────────────────────────────────────
export const ENTITIES: readonly EntityDef[] = [
  // ======================= Tier 3 · setup data =======================
  {
    key: "zones",
    label: "Zones and ZIP codes",
    tier: "setup",
    order: 30,
    table: "zones",
    module: "people",
    writePerms: ["settings.manage"],
    dependsOn: [],
    description: "Geographic zones (for zone leads and messages) with the ZIP codes each covers.",
    matchNote: "Matched on the zone name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Zone name", "name", "The zone's name.", "Sugar Land", { required: true, synonyms: ["zone", "area", "region"] }),
      col("zip_codes", "ZIP codes", "list", "ZIP codes in the zone, separated by semicolons.", "77478; 77479", { synonyms: ["zips", "postal codes"] }),
    ],
  },
  {
    key: "inboxes",
    label: "Inboxes",
    tier: "setup",
    order: 31,
    table: "inboxes",
    module: "comms",
    writePerms: ["settings.manage"],
    dependsOn: [],
    description: "Shared inboxes members write to (office, membership, finance, …).",
    matchNote: "Matched on the inbox key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Inbox key", "id", "A short code, letters and underscores.", "office", { required: true }),
      col("name", "Inbox name", "name", "What members see.", "Office", { required: true }),
      col("response_target_hours", "Response target (hours)", "integer", "How quickly the team aims to answer.", "48"),
    ],
  },
  {
    key: "bank_accounts",
    label: "Bank accounts",
    tier: "setup",
    order: 32,
    table: "bank_accounts",
    module: "giving",
    writePerms: ["accounting.manage"],
    dependsOn: [],
    description: "The organization's bank accounts and their statement formats. Never account numbers — only the last four digits.",
    matchNote: "Matched on the account name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Account name", "name", "How the treasurer refers to it.", "Operating account", { required: true }),
      col("institution", "Bank", "text", "The bank's name.", "Chase"),
      col("last4", "Last 4 digits", "id", "Only the last four digits of the account number.", "0421"),
      col("statement_format", "Statement format", "enum", "The CSV format the bank exports.", "chase_csv", {
        options: [
          { value: "chase_csv", label: "Chase CSV" },
          { value: "generic_csv", label: "Generic CSV" },
          { value: "ofx", label: "OFX" },
        ],
      }),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "funds",
    label: "Funds",
    tier: "setup",
    order: 33,
    table: "funds",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: [],
    description: "Funds gifts are given to, restricted or not, with their QuickBooks class.",
    matchNote: "Matched on the fund key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Fund key", "id", "A short code, unique in your organization.", "general", { required: true, synonyms: ["fund code", "code", "fund id"] }),
      col("name", "Fund name", "name", "What people see.", "General fund", { required: true, synonyms: ["fund", "fund name"] }),
      col("restricted", "Restricted", "boolean", "Yes when donors restricted its use.", "No"),
      col("qbo_class_id", "QuickBooks class", "id", "The QuickBooks class ID, if you use classes.", "2000000001"),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "membership_types",
    label: "Membership types",
    tier: "setup",
    order: 34,
    table: "membership_types",
    module: "membership",
    writePerms: ["settings.manage"],
    dependsOn: [],
    description: "Membership types with tier, fee, period, reference and approval rules and voting wait.",
    matchNote: "Matched on the type key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Type key", "id", "A short code.", "life_family", { required: true, synonyms: ["code", "type code", "membership code"] }),
      col("name", "Type name", "name", "What members see.", "Life membership (family)", { required: true, synonyms: ["membership type", "membership", "type"] }),
      col("tier", "Tier", "enum", "Community, yearly or life. Your own words are translated (\"Life Member\" becomes life).", "life", {
        required: true,
        options: TIERS,
        valueMap: TIER_WORDS,
        synonyms: ["level", "membership level"],
      }),
      col("fee_cents", "Fee", "money", "The fee in dollars.", "$2,500.00", { allowZero: true, synonyms: ["fee", "price", "dues", "amount"] }),
      col("period_months", "Period (months)", "integer", "Blank for life memberships.", "12"),
      col("includes_spouse", "Includes spouse", "boolean", "Yes or no.", "Yes"),
      col("reference_required", "Reference required", "boolean", "Does a new member need a reference?", "Yes"),
      col("ec_approval_required", "Committee approval required", "boolean", "Does the executive committee approve?", "No"),
      col("voting_wait_days", "Voting wait (days)", "integer", "Days before a new member may vote.", "180"),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "store_categories",
    label: "Store categories",
    tier: "setup",
    order: 35,
    table: "store_categories",
    module: "store",
    writePerms: ["store.manage"],
    dependsOn: [],
    description: "Satvik Store menu categories.",
    matchNote: "Matched on the category name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Category", "name", "The category name.", "Sweets", { required: true, synonyms: ["category"] }),
      col("sort_order", "Order", "integer", "Position on the menu.", "1"),
    ],
  },
  {
    key: "calendar_layers",
    label: "Calendar layers",
    tier: "setup",
    order: 36,
    table: "calendar_layers",
    module: "calendar",
    writePerms: ["content.manage"],
    dependsOn: [],
    description: "Calendar layers members can switch on (festivals, school district, …).",
    matchNote: "Matched on the layer key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Layer key", "id", "A short code.", "school_district", { required: true }),
      col("name", "Layer name", "name", "What members see.", "Fort Bend ISD", { required: true }),
      col("kind", "Kind", "enum", "What the layer holds.", "school_district", {
        required: true,
        options: [
          { value: "tithi", label: "Tithi" },
          { value: "festival", label: "Festival" },
          { value: "pathshala", label: "Pathshala" },
          { value: "events", label: "Events" },
          { value: "school_district", label: "School district" },
          { value: "custom", label: "Custom" },
        ],
      }),
      col("source_url", "Source link", "text", "An iCal link, if any.", "https://…/calendar.ics"),
      col("default_on", "On by default", "boolean", "Yes or no.", "No"),
      col("color", "Colour", "text", "A hex colour.", "#5B4B8A"),
    ],
  },
  {
    key: "pathshala_tracks",
    label: "Pathshala tracks",
    tier: "setup",
    order: 37,
    table: "pathshala_tracks",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: [],
    description: "Pathshala tracks (for example Gujarati, English).",
    matchNote: "Matched on the track key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Track key", "id", "A short code.", "english", { required: true }),
      col("name", "Track name", "name", "What families see.", "English track", { required: true }),
    ],
  },
  {
    key: "pathshala_terms",
    label: "Pathshala terms",
    tier: "setup",
    order: 38,
    table: "pathshala_terms",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: [],
    description: "Terms with dates, registration windows and fees (fees are billed per child as pledges).",
    matchNote: "Matched on the term name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Term name", "name", "The term's name.", "2026–27", { required: true }),
      col("starts_on", "Starts", "date", "First day.", "2026-09-06", { required: true }),
      col("ends_on", "Ends", "date", "Last day.", "2027-05-23", { required: true }),
      col("registration_opens_at", "Registration opens", "datetime", "Date (and time).", "2026-08-01"),
      col("registration_closes_at", "Registration closes", "datetime", "Date (and time).", "2026-09-01"),
      col("membership_required", "Membership required", "boolean", "Yes or no.", "Yes"),
      col("fee_per_child_cents", "Fee per child", "money", "Dollars.", "$150.00", { allowZero: true }),
      col("fee_per_family_cap_cents", "Family cap", "money", "Dollars.", "$400.00", { allowZero: true }),
      col("sibling_discount_pct", "Sibling discount %", "integer", "Whole percent.", "10"),
      col("status", "Status", "enum", "Draft, registration, active or closed.", "active", {
        options: [
          { value: "draft", label: "Draft" },
          { value: "registration", label: "Registration" },
          { value: "active", label: "Active" },
          { value: "closed", label: "Closed" },
        ],
      }),
    ],
  },
  {
    key: "practices",
    label: "Practices (My Jain Way)",
    tier: "setup",
    order: 39,
    table: "practices",
    module: "jain_way",
    writePerms: ["content.manage"],
    dependsOn: [],
    description: "The practices catalog with points.",
    matchNote: "Matched on the practice key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Practice key", "id", "A short code.", "navkarsi", { required: true }),
      col("name", "Practice", "name", "What members see.", "Navkarsi", { required: true }),
      col("category", "Category", "text", "Group on the screen.", "Tap", { required: true }),
      col("description", "Description", "longtext", "A short explanation.", "Eat after 48 minutes past sunrise."),
      col("default_minutes", "Minutes", "integer", "Typical minutes.", "0"),
      col("points", "Points", "integer", "Points per day.", "5"),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "gyan_goals",
    label: "Gyan Path goals",
    tier: "setup",
    order: 40,
    table: "gyan_goals",
    module: "gyan_path",
    writePerms: ["content.manage"],
    dependsOn: [],
    description: "Gyan Path goals (usually from the tradition pack).",
    matchNote: "Matched on the goal key.",
    sourceKey: ["key"],
    fields: [
      col("key", "Goal key", "id", "A short code.", "navkar", { required: true }),
      col("name", "Goal", "name", "What members see.", "Navkar Mantra", { required: true }),
      col("description", "Description", "longtext", "A short explanation.", "Learn the Navkar."),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("recommended", "Recommended", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "campaigns",
    label: "Campaigns",
    tier: "setup",
    order: 50,
    table: "campaigns",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["funds"],
    description: "Giving campaigns with fund, goal and dates.",
    matchNote: "Matched on the campaign name.",
    sourceKey: ["name"],
    moneyFields: ["goal_cents"],
    fields: [
      col("name", "Campaign", "name", "The campaign's name.", "Paryushan 2026", { required: true, synonyms: ["campaign name", "appeal", "campaign"] }),
      col("kind", "Kind", "enum", "What it is for.", "general", {
        required: true,
        options: [
          { value: "general", label: "General" },
          { value: "boli", label: "Boli" },
          { value: "sponsorship", label: "Sponsorship" },
          { value: "construction", label: "Construction" },
          { value: "pathshala", label: "Pathshala" },
          { value: "event", label: "Event" },
          { value: "membership", label: "Membership" },
          { value: "store", label: "Store" },
          { value: "other", label: "Other" },
        ],
        synonyms: ["type", "campaign type"],
      }),
      lookup("fund_key", "Fund key", "fund_id", "funds", "key", "The fund's key (import funds first).", "general", false, ["fund", "fund code", "fund key", "fund id"]),
      col("description", "Description", "longtext", "Optional.", "Annual Paryushan appeal"),
      col("goal_cents", "Goal", "money", "Dollars.", "$50,000", { allowZero: true, synonyms: ["goal", "target"] }),
      col("starts_on", "Starts", "date", "First day.", "2026-08-20", { synonyms: ["start date", "start"] }),
      col("ends_on", "Ends", "date", "Last day.", "2026-09-30", { synonyms: ["end date", "end"] }),
      col("status", "Status", "enum", "Draft, published, closed or archived.", "published", {
        options: [
          { value: "draft", label: "Draft" },
          { value: "published", label: "Published" },
          { value: "closed", label: "Closed" },
          { value: "archived", label: "Archived" },
        ],
        valueMap: { Active: "published", Open: "published", Inactive: "closed", Ended: "closed" },
      }),
    ],
  },
  {
    key: "event_templates",
    label: "Event templates",
    tier: "setup",
    order: 51,
    table: "event_templates",
    module: "events",
    writePerms: ["events.manage"],
    dependsOn: [],
    description: "Event templates (their checklist items load next).",
    matchNote: "Matched on the template name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Template", "name", "The template's name.", "Mahavir Janma Kalyanak", { required: true }),
      col("description", "Description", "longtext", "Optional.", "Annual celebration"),
    ],
  },
  {
    key: "event_template_items",
    label: "Event template checklist items",
    tier: "setup",
    order: 52,
    table: "event_template_items",
    module: "events",
    writePerms: ["events.manage"],
    dependsOn: ["event_templates"],
    description: "Checklist items of each event template.",
    matchNote: "Matched on template and item name.",
    sourceKey: ["template_name", "name"],
    fields: [
      lookup("template_name", "Template", "template_id", "event_templates", "name", "The template's name (import templates first).", "Mahavir Janma Kalyanak", true),
      col("phase", "Phase", "enum", "Before, during or after the event.", "pre", {
        required: true,
        options: [
          { value: "pre", label: "Before" },
          { value: "during", label: "During" },
          { value: "after", label: "After" },
        ],
      }),
      col("name", "Item", "name", "What needs doing.", "Book the hall", { required: true }),
      col("priority", "Priority", "enum", "Low, medium, high or critical.", "high", {
        options: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "critical", label: "Critical" },
        ],
      }),
      col("offset_days", "Days from the event", "integer", "Negative is before.", "-30"),
      col("sort_order", "Order", "integer", "Position.", "1"),
    ],
  },
  {
    key: "volunteer_groups",
    label: "Volunteer groups",
    tier: "setup",
    order: 53,
    table: "volunteer_groups",
    module: "volunteers",
    writePerms: ["volunteers.manage"],
    dependsOn: [],
    description: "Volunteer groups and whether they need a background check.",
    matchNote: "Matched on the group name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Group", "name", "The group's name.", "Kitchen", { required: true }),
      col("requires_background_check", "Background check needed", "boolean", "Yes or no.", "No"),
      col("requires_waiver_kind", "Waiver needed", "text", "The waiver kind, if any.", "youth_waiver"),
    ],
  },
  {
    key: "pathshala_levels",
    label: "Pathshala levels",
    tier: "setup",
    order: 54,
    table: "pathshala_levels",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: ["pathshala_tracks"],
    description: "Levels within each Pathshala track.",
    matchNote: "Matched on track and level key.",
    sourceKey: ["track_key", "key"],
    fields: [
      lookup("track_key", "Track key", "track_id", "pathshala_tracks", "key", "The track's key (import tracks first).", "english", true),
      col("key", "Level key", "id", "A short code, unique in the track.", "level_1", { required: true }),
      col("name", "Level", "name", "What families see.", "Level 1", { required: true }),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("min_age", "Minimum age", "integer", "Years.", "5"),
      col("max_age", "Maximum age", "integer", "Years.", "7"),
    ],
  },
  {
    key: "gyan_levels",
    label: "Gyan Path levels",
    tier: "setup",
    order: 55,
    table: "gyan_levels",
    module: "gyan_path",
    writePerms: ["content.manage"],
    dependsOn: ["gyan_goals"],
    description: "Levels within each Gyan Path goal.",
    matchNote: "Matched on goal and level key.",
    sourceKey: ["goal_key", "key"],
    fields: [
      lookup("goal_key", "Goal key", "goal_id", "gyan_goals", "key", "The goal's key (import goals first).", "navkar", true),
      col("key", "Level key", "id", "A short code, unique in the goal.", "basics", { required: true }),
      col("name", "Level", "name", "What members see.", "The basics", { required: true }),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("points", "Points", "integer", "Points for finishing it.", "50"),
      col("requires_teacher_signoff", "Teacher sign-off", "boolean", "Yes or no.", "No"),
      col("chapter", "Chapter", "text", "Optional.", "1"),
    ],
  },
  {
    key: "gyan_steps",
    label: "Gyan Path steps",
    tier: "setup",
    order: 60,
    table: "gyan_steps",
    module: "gyan_path",
    writePerms: ["content.manage"],
    dependsOn: ["gyan_levels"],
    description: "Steps within each Gyan Path level.",
    matchNote: "Matched on level and step title.",
    sourceKey: ["level", "title"],
    fields: [
      col("level", "Level (goal key/level key)", "ref", "The goal key and level key, separated by a slash.", "navkar/basics", {
        column: "level_id",
        required: true,
        ref: { kind: "gyan_level" },
      }),
      col("kind", "Kind", "enum", "Read, listen, recite, quiz, video or practice.", "read", {
        required: true,
        options: [
          { value: "read", label: "Read" },
          { value: "listen", label: "Listen" },
          { value: "recite", label: "Recite" },
          { value: "quiz", label: "Quiz" },
          { value: "video", label: "Video" },
          { value: "practice", label: "Practice" },
        ],
      }),
      col("title", "Step", "name", "What members see.", "Read the first line", { required: true }),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("points", "Points", "integer", "Points for the step.", "5"),
    ],
  },
  {
    key: "opportunities",
    label: "Opportunities and sponsorships",
    tier: "setup",
    order: 70,
    table: "opportunities",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["campaigns"],
    description: "Sponsorship menus (tiers, pujans, amounts) within a campaign.",
    matchNote: "Matched on campaign and opportunity name.",
    sourceKey: ["campaign_name", "name"],
    moneyFields: ["amount_cents"],
    fields: [
      lookup("campaign_name", "Campaign", "campaign_id", "campaigns", "name", "The campaign's name (import campaigns first).", "Paryushan 2026", true),
      col("name", "Opportunity", "name", "What donors see.", "Snatra Puja sponsor", { required: true }),
      col("description", "Description", "longtext", "Optional.", "Sponsor the morning puja"),
      col("kind", "Kind", "enum", "Fixed amount, tiers, several takers, any amount, or open.", "fixed", {
        options: [
          { value: "fixed", label: "Fixed" },
          { value: "tier", label: "Tier" },
          { value: "multi", label: "Multi" },
          { value: "amount", label: "Amount" },
          { value: "open", label: "Open" },
        ],
      }),
      col("amount_cents", "Amount", "money", "Dollars.", "$1,101"),
      col("min_amount_cents", "Minimum amount", "money", "Dollars.", "$251"),
      col("quantity_available", "How many", "integer", "Blank for unlimited.", "1"),
      col("status", "Status", "enum", "Draft, open, taken or closed.", "open", {
        options: [
          { value: "draft", label: "Draft" },
          { value: "open", label: "Open" },
          { value: "taken", label: "Taken" },
          { value: "closed", label: "Closed" },
        ],
      }),
      col("sort_order", "Order", "integer", "Position.", "1"),
    ],
  },
  {
    key: "labh_options",
    label: "Labh options",
    tier: "setup",
    order: 71,
    table: "labh_options",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["funds", "campaigns"],
    description: "Labh options with amount and fund.",
    matchNote: "Matched on the option name.",
    sourceKey: ["name"],
    moneyFields: ["amount_cents"],
    fields: [
      col("name", "Labh", "name", "What members see.", "Aarti labh", { required: true }),
      col("amount_cents", "Amount", "money", "Dollars.", "$151", { required: true }),
      lookup("fund_key", "Fund key", "fund_id", "funds", "key", "Optional.", "general", false, ["fund", "fund code", "fund key", "fund id"]),
      lookup("campaign_name", "Campaign", "campaign_id", "campaigns", "name", "Optional.", "Paryushan 2026"),
      col("sort_order", "Order", "integer", "Position.", "1"),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },
  {
    key: "pickup_windows",
    label: "Store pickup windows",
    tier: "setup",
    order: 72,
    table: "pickup_windows",
    module: "store",
    writePerms: ["store.manage"],
    dependsOn: [],
    description: "Satvik Store pickup windows with order cut-off.",
    matchNote: "Matched on the start time.",
    sourceKey: ["starts_at"],
    fields: [
      col("starts_at", "Starts", "datetime", "Date and time.", "2026-10-18 11:00", { required: true }),
      col("ends_at", "Ends", "datetime", "Date and time.", "2026-10-18 13:00", { required: true }),
      col("order_cutoff_at", "Order cut-off", "datetime", "Date and time.", "2026-10-16 20:00", { required: true }),
      col("capacity", "Capacity", "integer", "Orders.", "60"),
      col("location", "Location", "text", "Where.", "Temple kitchen door"),
    ],
  },
  {
    key: "pathshala_classes",
    label: "Pathshala classes",
    tier: "setup",
    order: 73,
    table: "pathshala_classes",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: ["pathshala_terms", "pathshala_levels"],
    description: "Classes for a term and level, with room, capacity and times.",
    matchNote: "Matched on term and class name.",
    sourceKey: ["term_name", "name"],
    fields: [
      lookup("term_name", "Term", "term_id", "pathshala_terms", "name", "The term's name (import terms first).", "2026–27", true),
      col("level", "Level (track key/level key)", "ref", "The track key and level key, separated by a slash.", "english/level_1", {
        column: "level_id",
        required: true,
        ref: { kind: "pathshala_level" },
      }),
      col("name", "Class", "name", "The class name.", "Level 1 · Sunday", { required: true }),
      col("room", "Room", "text", "Optional.", "Room 3"),
      col("capacity", "Capacity", "integer", "Students.", "15"),
      col("meets_on", "Meets on", "text", "Day of the week.", "Sunday"),
      col("starts_time", "Starts", "time", "Time.", "10:00"),
      col("ends_time", "Ends", "time", "Time.", "11:30"),
    ],
  },
  {
    key: "whatsapp_groups",
    label: "WhatsApp groups",
    tier: "setup",
    order: 74,
    table: "whatsapp_groups",
    module: "comms",
    writePerms: ["comms.send"],
    dependsOn: ["zones"],
    description: "WhatsApp groups members can ask to join.",
    matchNote: "Matched on the group name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Group", "name", "The group's name.", "Sugar Land families", { required: true }),
      col("description", "Description", "longtext", "Optional.", "News for Sugar Land"),
      col("audience", "Audience", "enum", "Who may join.", "zone", {
        options: [
          { value: "public", label: "Public" },
          { value: "members", label: "Members" },
          { value: "zone", label: "Zone" },
          { value: "pathshala", label: "Pathshala" },
          { value: "volunteers", label: "Volunteers" },
        ],
      }),
      lookup("zone_name", "Zone", "zone_id", "zones", "name", "Optional.", "Sugar Land"),
      col("active", "Active", "boolean", "Yes or no.", "Yes"),
    ],
  },

  // ======================= Tier 4 · records =======================
  {
    key: "households",
    label: "Households",
    tier: "records",
    order: 100,
    table: "households",
    module: "people",
    writePerms: ["people.manage"],
    dependsOn: ["zones"],
    description: "Households: name, address, zone, directory and mail preferences and the old system's household ID.",
    matchNote: "Matched on the old household ID, then the Connect household number. Never on the household name: a name-only look-alike goes to merge review.",
    sourceKey: ["legacy_id"],
    fields: [
      extra("legacy_id", "Household ID (old system)", "id", "Your register's or old CRM's household ID, exactly as issued (leading zeros kept).", "0212", {
        required: true,
        synonyms: ["household id", "family id", "account id", "household number", "hh id", "jsh household id"],
      }),
      extra("crm_id", "Legacy CRM ID", "id", "The household's ID in a second old system (for example Neon), if any.", "4374", { synonyms: ["neon id", "crm id", "neon account id"] }),
      col("display_name", "Household name", "name", "How the household is addressed.", "Rahul & Mira Shah", {
        required: true,
        synonyms: ["household name", "family name", "account name", "name", "addressee"],
      }),
      col("household_number", "Connect household number", "id", "Only when adopting your existing numbers as Connect numbers; otherwise leave blank.", "JSH-H-2041"),
      col("address_line1", "Address", "text", "Street address.", "12 Lotus Lane", { personal: true, synonyms: ["address line 1", "street", "address 1", "street address"] }),
      col("address_line2", "Address line 2", "text", "Apartment, suite.", "Apt 4", { personal: true, synonyms: ["address 2"] }),
      col("city", "City", "text", "City.", "Sugar Land", { synonyms: ["town"] }),
      col("state_region", "State", "text", "State.", "TX", { synonyms: ["state", "state/province", "province", "region"] }),
      col("postal_code", "ZIP", "id", "ZIP code (leading zeros kept).", "77478", { synonyms: ["zip", "zip code", "postal code", "postcode"] }),
      lookup("zone_name", "Zone", "zone_id", "zones", "name", "The zone's name (import zones first).", "Sugar Land", false, ["zone"]),
      col("directory_opt_in", "In the directory", "boolean", "Yes to list the household in the member directory.", "Yes", { synonyms: ["directory", "list in directory"] }),
      col("physical_mail_opt_in", "Wants postal mail", "boolean", "Yes or no.", "No", { synonyms: ["mail", "postal mail", "send mail"] }),
      col("notes", "Notes", "longtext", "Staff notes.", "Moved from Katy in 2019", { personal: true }),
    ],
  },
  {
    key: "people",
    label: "People",
    tier: "records",
    order: 101,
    table: "people",
    module: "people",
    writePerms: ["people.manage"],
    dependsOn: ["households"],
    description: "People with names, birth date, contact details, language, profession and their household (relationship).",
    matchNote: "Matched on the old person ID, then email, then mobile. Never on a name alone: a name-only look-alike goes to merge review.",
    sourceKey: ["legacy_id"],
    fields: [
      extra("legacy_id", "Person ID (old system)", "id", "Your register's or old CRM's person ID, exactly as issued (leading zeros kept).", "0417", {
        required: true,
        synonyms: ["person id", "member id", "contact id", "individual id", "constituent id", "jsh member id", "account id"],
      }),
      extra("crm_id", "Legacy CRM ID", "id", "The person's ID in a second old system (for example Neon), if any.", "4374", { synonyms: ["neon id", "crm id"] }),
      householdRef({ extra: "household_id" }, false),
      extra("relationship", "Relationship", "enum", "Their place in the household. Your words are translated (\"Wife\" becomes spouse).", "spouse", {
        options: ROLES,
        valueMap: ROLE_WORDS,
        synonyms: ["relationship to head", "role", "household role", "relation"],
      }),
      extra("is_primary", "Primary contact", "boolean", "Yes for the household's main contact.", "Yes", { synonyms: ["primary", "head of household"] }),
      extra("full_name", "Full name", "fullname", "Used only when there are no separate first and last name columns.", "Mira Shah", { personal: true, synonyms: ["name", "full name", "contact name"] }),
      col("first_name", "First name", "name", "Given name.", "Mira", { personal: true, synonyms: ["first", "given name", "forename"] }),
      col("last_name", "Last name", "name", "Family name.", "Shah", { personal: true, synonyms: ["last", "surname", "family name"] }),
      col("preferred_name", "Preferred name", "name", "What they like to be called.", "Mira", { personal: true, synonyms: ["nickname", "goes by"] }),
      col("date_of_birth", "Birth date", "date", "Decides who is a minor. Under 13 cannot sign in until a parent consents.", "1986-04-12", {
        personal: true,
        synonyms: ["dob", "birthday", "date of birth", "birthdate"],
      }),
      col("gender", "Gender", "enum", "Female, male or other.", "female", { options: GENDERS, valueMap: { F: "female", M: "male", Woman: "female", Man: "male" } }),
      col("email", "Email", "email", "Their main email (sign-in matches on it).", "mira@example.com", {
        personal: true,
        synonyms: ["email address", "email 1", "primary email", "e-mail"],
      }),
      extra("other_emails", "Other emails", "list", "More email addresses, separated by semicolons.", "mira@work.example", { personal: true, synonyms: ["email 2", "secondary email"] }),
      col("phone_e164", "Mobile", "phone", "Their mobile number; put into international format (+1…).", "(713) 555-0142", {
        personal: true,
        synonyms: ["phone", "mobile", "cell", "phone 1", "phone 1 number", "mobile phone", "cell phone"],
      }),
      col("language", "Language", "enum", "English, Gujarati or Hindi.", "en", { options: LANGUAGES }),
      col("profession", "Profession", "text", "Optional.", "Physician", { synonyms: ["occupation", "job title"] }),
      col("employer", "Employer", "text", "Optional.", "Memorial Hermann", { synonyms: ["company", "organization"] }),
      col("is_deceased", "Deceased", "boolean", "Yes when the person has passed away.", "No", { synonyms: ["deceased"] }),
      col("member_number", "Connect member number", "id", "Only when adopting your existing numbers as Connect numbers; otherwise leave blank.", "JSH-10421"),
      extra("email_opt_in", "Email opt-in", "boolean", "Yes only when they explicitly opted in. No (or unsubscribed) is always imported.", "Yes", {
        synonyms: ["email opt in", "subscribed", "email subscription", "opt in", "newsletter"],
      }),
      extra("email_opt_in_date", "Opt-in date", "date", "When they opted in or out. An opt-in without a date does not count.", "2024-03-01", { synonyms: ["opt in date", "subscribed on"] }),
      extra("email_opt_in_source", "Opt-in source", "text", "Where they opted in (form, event sign-up sheet…). An opt-in without a source does not count.", "Website form", {
        synonyms: ["opt in source", "subscription source"],
      }),
    ],
  },
  {
    key: "household_members",
    label: "Household members and relationships",
    tier: "records",
    order: 110,
    table: "household_members",
    module: "people",
    writePerms: ["people.manage"],
    dependsOn: ["people", "households"],
    description: "Extra links between people and households (the people file already links each person to one household).",
    matchNote: "Matched on person and household.",
    sourceKey: ["person_legacy_id", "household_legacy_id"],
    fields: [
      personRef({ column: "person_id" }, true),
      householdRef({ column: "household_id" }),
      col("role", "Relationship", "enum", "Their place in this household.", "child", { required: true, options: ROLES, valueMap: ROLE_WORDS }),
      col("is_primary", "Primary contact", "boolean", "Yes or no.", "No"),
      col("joined_at", "Joined", "date", "Optional.", "2019-06-01"),
      col("left_at", "Left", "date", "Optional.", "2024-08-15"),
    ],
  },
  {
    key: "external_ids",
    label: "Identifiers",
    tier: "records",
    order: 111,
    table: "external_ids",
    module: "people",
    writePerms: ["people.manage", "giving.manage"],
    dependsOn: ["people", "households"],
    description: "More identifiers per person or household: QuickBooks customer IDs, bank payer names, payment-provider customer IDs, other CRMs.",
    matchNote: "Matched on kind, system and value.",
    sourceKey: ["kind", "system", "value"],
    fields: [
      col("person_legacy_id", "Person ID (old system)", "ref", "The person (or leave blank and give a household).", "0417", { column: "person_id", ref: { kind: "person", by: "legacy" } }),
      col("household_legacy_id", "Household ID (old system)", "ref", "The household.", "0212", { column: "household_id", ref: { kind: "household", by: "legacy" } }),
      col("kind", "Kind", "enum", "What kind of identifier.", "accounting", { required: true, options: ID_KINDS }),
      col("system", "System", "id", "Which system issued it.", "quickbooks", { required: true }),
      col("value", "Value", "id", "Exactly as the other system shows it.", "1187", { required: true }),
      col("label", "Label", "text", "Optional.", "QuickBooks customer"),
    ],
  },
  {
    key: "channel_optins",
    label: "Consents, opt-ins and opt-outs",
    tier: "records",
    order: 112,
    table: "channel_optins",
    module: "comms",
    writePerms: ["comms.send"],
    dependsOn: ["people"],
    description: "Channel opt-ins with date and source, and opt-outs (always imported).",
    matchNote: "Each row is one record; re-importing the same person, channel, address and date updates it.",
    sourceKey: ["person_legacy_id", "channel", "address", "recorded_at"],
    fields: [
      personRef({ column: "person_id" }, true),
      col("channel", "Channel", "enum", "Email, text message, WhatsApp or push.", "email", { required: true, options: CHANNELS }),
      col("address", "Address", "text", "The email address or phone number.", "mira@example.com", { required: true, personal: true }),
      col("opted_in", "Opted in", "boolean", "Yes for an explicit opt-in; No for an opt-out.", "No", { required: true, synonyms: ["subscribed", "status"] }),
      col("source", "Source", "text", "Where it was given. Required for an opt-in to count.", "Website form"),
      col("recorded_at", "Date", "datetime", "When. Required for an opt-in to count.", "2024-03-01"),
    ],
    note: "Only explicit opt-ins with a date and a source count; an opt-in without them is left out with a warning. Opt-outs are always imported.",
  },
  {
    key: "special_days",
    label: "Special days",
    tier: "records",
    order: 120,
    table: "special_days",
    module: "people",
    writePerms: ["people.manage"],
    dependsOn: ["people", "households"],
    description: "Birthdays, anniversaries, punyatithi.",
    matchNote: "Matched on household, person, kind and date.",
    sourceKey: ["household_legacy_id", "person_legacy_id", "kind", "calendar_date", "tithi"],
    fields: [
      householdRef({ column: "household_id" }),
      personRef({ column: "person_id" }, false),
      col("kind", "Kind", "enum", "Birthday, anniversary, punyatithi, diksha or other.", "punyatithi", {
        required: true,
        options: [
          { value: "birthday", label: "Birthday" },
          { value: "anniversary", label: "Anniversary" },
          { value: "punyatithi", label: "Punyatithi" },
          { value: "diksha", label: "Diksha" },
          { value: "other", label: "Other" },
        ],
      }),
      col("label", "Label", "text", "Optional.", "Ba's punyatithi"),
      col("calendar_date", "Date", "date", "Calendar date (or give a tithi).", "2019-11-02"),
      col("tithi", "Tithi", "text", "For tithi-based days.", "Sud 5"),
      col("tithi_month", "Tithi month", "text", "For tithi-based days.", "Kartak"),
    ],
  },
  {
    key: "memberships",
    label: "Memberships (current and past)",
    tier: "records",
    order: 121,
    table: "memberships",
    module: "membership",
    writePerms: ["people.manage"],
    dependsOn: ["households", "membership_types"],
    description: "Current memberships, and past ones (status ended) for voting history.",
    matchNote: "Matched on the old membership ID, then household + type + start date.",
    sourceKey: ["legacy_id"],
    fields: [
      col("legacy_id", "Membership ID (old system)", "id", "Re-importing the same ID updates it.", "M-2210", { column: "crm_external_id", synonyms: ["membership id", "id"] }),
      householdRef({ column: "household_id" }),
      col("person_legacy_id", "Person ID (old system)", "ref", "For a personal membership; blank for the household.", "0417", { column: "person_id", ref: { kind: "person", by: "legacy" } }),
      lookup("membership_type", "Membership type", "membership_type_id", "membership_types", "key_or_name", "The type's key or name (import membership types first).", "life_family", true, [
        "membership type",
        "membership level",
        "type",
        "level",
      ]),
      col("status", "Status", "enum", "Pending, active, lapsed, suspended or ended.", "active", {
        options: MEMBERSHIP_STATUS,
        valueMap: { Current: "active", Expired: "lapsed", Past: "ended", Cancelled: "ended", Inactive: "lapsed" },
      }),
      col("starts_on", "Starts", "date", "First day.", "2012-01-01", { required: true, synonyms: ["start date", "member since", "join date"] }),
      col("ends_on", "Ends", "date", "Blank for life.", "2026-12-31", { synonyms: ["end date", "expiration date", "expires"] }),
      col("notes", "Notes", "longtext", "Optional.", "Converted from yearly in 2015"),
    ],
  },
  {
    key: "pathshala_enrollments",
    label: "Pathshala enrollments",
    tier: "records",
    order: 122,
    table: "pathshala_enrollments",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: ["pathshala_terms", "pathshala_classes", "people", "households"],
    description: "Current enrollments of children in classes.",
    matchNote: "Matched on term and child.",
    sourceKey: ["term_name", "person_legacy_id"],
    fields: [
      lookup("term_name", "Term", "term_id", "pathshala_terms", "name", "The term's name.", "2026–27", true),
      personRef({ column: "student_person_id" }, true, "Child's person ID (old system)"),
      householdRef({ column: "household_id" }),
      lookup("class_name", "Class", "class_id", "pathshala_classes", "name", "The class name.", "Level 1 · Sunday"),
      col("status", "Status", "enum", "Requested, waitlisted, placed, active, withdrawn or completed.", "active", {
        options: [
          { value: "requested", label: "Requested" },
          { value: "waitlisted", label: "Waitlisted" },
          { value: "placed", label: "Placed" },
          { value: "active", label: "Active" },
          { value: "withdrawn", label: "Withdrawn" },
          { value: "completed", label: "Completed" },
        ],
      }),
      col("notes", "Notes", "longtext", "Optional.", "Allergic to nuts"),
    ],
  },
  {
    key: "pathshala_teachers",
    label: "Pathshala teachers",
    tier: "records",
    order: 123,
    table: "pathshala_teachers",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: ["pathshala_classes", "people"],
    description: "Teachers, assistants and substitutes per class.",
    matchNote: "Matched on class and person.",
    sourceKey: ["class_name", "person_legacy_id"],
    fields: [
      lookup("class_name", "Class", "class_id", "pathshala_classes", "name", "The class name.", "Level 1 · Sunday", true),
      personRef({ column: "person_id" }, true),
      col("role", "Role", "enum", "Teacher, assistant or substitute.", "teacher", {
        options: [
          { value: "teacher", label: "Teacher" },
          { value: "assistant", label: "Assistant" },
          { value: "substitute", label: "Substitute" },
        ],
      }),
    ],
  },
  {
    key: "volunteer_interests",
    label: "Volunteer interests",
    tier: "records",
    order: 124,
    table: "volunteer_interests",
    module: "volunteers",
    writePerms: ["volunteers.manage"],
    dependsOn: ["volunteer_groups", "people"],
    description: "Who volunteers in which group.",
    matchNote: "Matched on person and group.",
    sourceKey: ["person_legacy_id", "group_name"],
    fields: [
      personRef({ column: "person_id" }, true),
      lookup("group_name", "Group", "group_id", "volunteer_groups", "name", "The group's name.", "Kitchen", true),
      col("status", "Status", "enum", "Interested, active or inactive.", "active", {
        options: [
          { value: "interested", label: "Interested" },
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      }),
    ],
  },
  {
    key: "background_checks",
    label: "Background checks",
    tier: "records",
    order: 125,
    table: "background_checks",
    module: "volunteers",
    writePerms: ["safety.manage"],
    dependsOn: ["people"],
    description: "Background checks with their expiry.",
    matchNote: "Matched on person, provider and cleared date.",
    sourceKey: ["person_legacy_id", "provider", "cleared_on"],
    fields: [
      personRef({ column: "person_id" }, true),
      col("provider", "Provider", "text", "Who ran it.", "Sterling"),
      col("status", "Status", "enum", "Requested, clear, flagged or expired.", "clear", {
        required: true,
        options: [
          { value: "requested", label: "Requested" },
          { value: "clear", label: "Clear" },
          { value: "flagged", label: "Flagged" },
          { value: "expired", label: "Expired" },
        ],
      }),
      col("cleared_on", "Cleared on", "date", "Date.", "2025-08-01"),
      col("expires_on", "Expires on", "date", "Date.", "2027-08-01"),
    ],
  },
  {
    key: "store_items",
    label: "Store items and opening stock",
    tier: "records",
    order: 130,
    table: "store_items",
    module: "store",
    writePerms: ["store.manage"],
    dependsOn: ["store_categories"],
    description: "Items with SKU, price, tax and opening stock (photos are added on the Store screen).",
    matchNote: "Matched on the SKU.",
    sourceKey: ["sku"],
    moneyFields: ["price_cents"],
    fields: [
      col("sku", "SKU", "id", "Your item code, unique.", "SW-001", { required: true, synonyms: ["item code", "code", "product code"] }),
      col("name", "Item", "name", "What members see.", "Mohanthal (500 g)", { required: true, synonyms: ["item", "product", "item name"] }),
      col("description", "Description", "longtext", "Optional.", "Made fresh on Fridays"),
      lookup("category_name", "Category", "category_id", "store_categories", "name", "The category name.", "Sweets"),
      col("price_cents", "Price", "money", "Dollars.", "$12.00", { required: true, allowZero: true, synonyms: ["price", "unit price"] }),
      col("pack_size", "Pack size", "text", "Optional.", "500 g"),
      col("taxable", "Taxable", "boolean", "Yes or no.", "No"),
      col("track_inventory", "Track stock", "boolean", "Yes or no.", "Yes"),
      extra("opening_stock", "Opening stock", "integer", "Stock on hand today; set only for new items.", "40", { synonyms: ["stock", "on hand", "quantity"] }),
      col("low_stock_threshold", "Low-stock alert at", "integer", "Optional.", "5"),
      col("status", "Status", "enum", "Active, paused or retired.", "active", {
        options: [
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
          { value: "retired", label: "Retired" },
        ],
      }),
      col("qbo_item_id", "QuickBooks item", "id", "Optional.", "31"),
    ],
  },

  // ======================= Tier 5 · history =======================
  {
    key: "pledges",
    label: "Pledges",
    tier: "history",
    order: 200,
    table: "pledges",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["households", "campaigns", "funds"],
    description: "Open and closed pledges with amount, paid so far, campaign or fund, dates and the legacy pledge number.",
    matchNote: "Matched on the old pledge number (kept as an external ID), then the Connect pledge number.",
    sourceKey: ["legacy_id"],
    moneyFields: ["amount_cents", "paid_so_far"],
    fields: [
      col("legacy_id", "Pledge number (old system)", "id", "Kept as the pledge's external ID; re-importing it updates the pledge.", "PL-2019-0042", {
        column: "crm_external_id",
        required: true,
        synonyms: ["pledge id", "pledge number", "pledge #", "commitment id"],
      }),
      col("pledge_number", "Connect pledge number", "id", "Only when adopting your existing numbers; otherwise leave blank.", "JSH-P-1042"),
      householdRef({ column: "household_id" }),
      col("person_legacy_id", "Pledged by (person ID)", "ref", "Optional.", "0417", { column: "pledged_by_person_id", ref: { kind: "person", by: "legacy" } }),
      lookup("campaign_name", "Campaign", "campaign_id", "campaigns", "name", "The campaign's name.", "Paryushan 2026", false, ["campaign", "appeal"]),
      lookup("fund_key", "Fund key", "fund_id", "funds", "key", "The fund's key.", "general", false, ["fund", "fund code", "fund key", "fund id"]),
      col("source", "Kind", "enum", "What the pledge is for.", "general", { options: PLEDGE_SOURCE, valueMap: { Donation: "general", Sponsorship: "sponsorship", Dues: "membership_fee" } }),
      col("amount_cents", "Amount", "money", "Dollars.", "$5,000.00", { required: true, synonyms: ["amount", "pledge amount", "total"] }),
      extra("paid_so_far", "Paid so far", "money", "What the old system shows as paid; checked at Reconcile against the imported payments.", "$2,500.00", {
        allowZero: true,
        synonyms: ["paid", "amount paid", "total paid"],
      }),
      col("status", "Status", "enum", "Open, partially paid, paid, cancelled or written off.", "partially_paid", {
        options: PLEDGE_STATUS,
        valueMap: {
          Fulfilled: "paid", Complete: "paid", Completed: "paid", Partial: "partially_paid", Outstanding: "open", Void: "cancelled",
          "Written off": "written_off", "Written-off": "written_off", "Write-off": "written_off", "Write off": "written_off", "Bad debt": "written_off",
        },
      }),
      col("pledged_at", "Pledged on", "datetime", "Date.", "2019-08-30", { synonyms: ["pledge date", "date"] }),
      col("due_on", "Due", "date", "Optional.", "2020-08-30", { synonyms: ["due date"] }),
      col("closed_at", "Closed / written off on", "datetime", "Optional. For a written-off pledge, the day it was written off.", "2020-06-01", {
        synonyms: ["closed on", "write-off date", "written off on", "date written off"],
      }),
      col("written_off_by_name", "Written off by", "text", "Written-off pledges: who wrote it off in the old system (a name).", "R. Mehta", {
        synonyms: ["written off by", "write-off by", "approved by"],
      }),
      col("write_off_reason", "Write-off reason", "text", "Written-off pledges: why it was written off.", "Family moved away", {
        synonyms: ["write-off reason", "reason written off", "write off reason"],
      }),
      col("dedication", "Dedication", "text", "Optional.", "In memory of Ba"),
      col("anonymous", "Anonymous", "boolean", "Yes or no.", "No"),
    ],
    note:
      "Written-off pledges import as written off: closed and unpaid, with who wrote them off and why when the file says so (history: nothing is posted to QuickBooks). " +
      "What was paid before your payment history starts comes in as one opening-balance line per pledge — after importing the payments, use Bring in opening balances on this import.",
  },
  {
    key: "payments",
    label: "Payments (history)",
    tier: "history",
    order: 210,
    table: "payments",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["households", "pledges"],
    description: "Past payments: date, amount, method, check and receipt numbers. Imported payments are history and never post to QuickBooks.",
    matchNote: "Matched on the old payment or receipt number (kept as an external ID).",
    sourceKey: ["legacy_id"],
    moneyFields: ["amount_cents"],
    fields: [
      col("legacy_id", "Payment number (old system)", "id", "Kept as the payment's external ID; re-importing it updates the payment.", "R-2019-0331", {
        column: "crm_external_id",
        required: true,
        synonyms: ["payment id", "payment number", "donation id", "gift id", "receipt id", "transaction id"],
      }),
      col("receipt_number", "Receipt number", "id", "The receipt number the donor was given (kept as is).", "10331", { synonyms: ["receipt #", "receipt no"] }),
      householdRef({ column: "household_id" }),
      col("person_legacy_id", "Paid by (person ID)", "ref", "Optional.", "0417", { column: "payer_person_id", ref: { kind: "person", by: "legacy" } }),
      col("amount_cents", "Amount", "money", "Dollars.", "$1,001.00", { required: true, synonyms: ["amount", "gift amount", "donation amount", "total"] }),
      col("method", "Method", "enum", "Check, cash, card, ACH, Zelle, stock, DAF, matching gift…", "check", {
        required: true,
        options: METHODS,
        valueMap: METHOD_WORDS,
        synonyms: ["payment method", "tender", "payment type"],
      }),
      col("received_on", "Received on", "date", "Date.", "2019-09-02", { required: true, synonyms: ["date", "payment date", "gift date", "donation date"] }),
      col("check_number", "Check number", "id", "Kept as is.", "1044", { synonyms: ["check #", "check no", "cheque number"] }),
      col("provider_ref", "Processor reference", "id", "The card processor's reference, if any.", "ch_3Nx…"),
      col("memo", "Memo", "text", "Optional.", "Paryushan"),
      col("status", "Status", "enum", "Settled unless it failed or was voided.", "settled", { options: PAYMENT_STATUS }),
      col("pledge_legacy_id", "Paid pledge (old pledge number)", "ref", "The pledge this payment paid, as the old system recorded it.", "PL-2019-0042", {
        extra: "allocate_to",
        column: undefined,
        ref: { kind: "pledge" },
        synonyms: ["pledge id", "pledge number", "applied to"],
      }),
      extra("allocation_cents", "Amount applied to the pledge", "money", "Blank means the whole payment.", "$1,001.00"),
    ],
    note: "Every imported payment is marked as history: it is never posted to QuickBooks. Allocations are imported as given, never re-run.",
  },
  {
    key: "payment_allocations",
    label: "Payment allocations",
    tier: "history",
    order: 220,
    table: "payment_allocations",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["payments", "pledges"],
    description: "Which payment paid which pledge, exactly as the old system recorded it (for payments that paid several pledges).",
    matchNote: "Matched on payment and pledge.",
    sourceKey: ["payment_legacy_id", "pledge_legacy_id"],
    moneyFields: ["amount_cents"],
    fields: [
      col("payment_legacy_id", "Payment number (old system)", "ref", "The payment.", "R-2019-0331", { column: "payment_id", required: true, ref: { kind: "payment" } }),
      col("pledge_legacy_id", "Pledge number (old system)", "ref", "The pledge.", "PL-2019-0042", { column: "pledge_id", required: true, ref: { kind: "pledge" } }),
      col("amount_cents", "Amount", "money", "Dollars.", "$500.00", { required: true }),
    ],
  },
  {
    key: "recurring_gifts",
    label: "Recurring gifts",
    tier: "history",
    order: 230,
    table: "recurring_gifts",
    module: "giving",
    writePerms: ["giving.manage"],
    dependsOn: ["households", "campaigns", "funds"],
    description: "Active recurring schedules. Card details stay with the old processor: members are asked to re-enter their card once.",
    matchNote: "Matched on the old schedule ID.",
    sourceKey: ["legacy_id"],
    moneyFields: ["amount_cents"],
    fields: [
      legacyId(),
      householdRef({ column: "household_id" }),
      col("person_legacy_id", "Person ID (old system)", "ref", "Optional.", "0417", { column: "person_id", ref: { kind: "person", by: "legacy" } }),
      lookup("campaign_name", "Campaign", "campaign_id", "campaigns", "name", "Optional.", "Paryushan 2026"),
      lookup("fund_key", "Fund key", "fund_id", "funds", "key", "Optional.", "general", false, ["fund", "fund code", "fund key", "fund id"]),
      col("amount_cents", "Amount", "money", "Dollars per gift.", "$51.00", { required: true }),
      col("frequency", "Frequency", "enum", "Weekly, monthly, quarterly or yearly.", "monthly", {
        required: true,
        options: [
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "quarterly", label: "Quarterly" },
          { value: "yearly", label: "Yearly" },
        ],
        valueMap: { Annually: "yearly", Annual: "yearly" },
      }),
      col("method", "Method", "enum", "How it was paid.", "card", { options: METHODS, valueMap: METHOD_WORDS }),
      col("starts_on", "Started", "date", "Date.", "2024-01-01"),
      col("next_charge_on", "Next gift", "date", "Date.", "2026-10-01"),
    ],
    note: "Imported schedules start as \"waiting for a payment method\": the card stays with the old processor, so the member re-enters it once (or the processor moves the saved cards).",
  },
  {
    key: "bolis",
    label: "Past bolis",
    tier: "history",
    order: 240,
    table: "bolis",
    module: "bolis",
    writePerms: ["bolis.manage"],
    dependsOn: ["events", "campaigns"],
    description: "Past bolis (their results load next, as boli results).",
    matchNote: "Matched on the boli name.",
    sourceKey: ["name"],
    fields: [
      col("name", "Boli", "name", "The boli's name.", "Snatra Puja 2019", { required: true }),
      col("kind", "Kind", "enum", "Digital or in person.", "in_person", {
        options: [
          { value: "in_person", label: "In person" },
          { value: "digital", label: "Digital" },
        ],
      }),
      lookup("campaign_name", "Campaign", "campaign_id", "campaigns", "name", "Optional.", "Paryushan 2019"),
      col("event_legacy_id", "Event (old ID)", "ref", "Optional.", "EV-2019-07", { column: "event_id", ref: { kind: "event" } }),
      col("closes_at", "Closed at", "datetime", "Optional.", "2019-09-01 12:00"),
    ],
    note: "Imported bolis are closed.",
  },
  {
    key: "boli_entries",
    label: "Boli results",
    tier: "history",
    order: 241,
    table: "boli_entries",
    module: "bolis",
    writePerms: ["bolis.manage"],
    dependsOn: ["bolis", "households"],
    description: "The pledges made in past bolis.",
    matchNote: "Matched on the old entry ID.",
    sourceKey: ["legacy_id"],
    moneyFields: ["amount_cents"],
    fields: [
      legacyId(),
      lookup("boli_name", "Boli", "boli_id", "bolis", "name", "The boli's name.", "Snatra Puja 2019", true),
      householdRef({ column: "household_id" }),
      col("person_legacy_id", "Person ID (old system)", "ref", "Optional.", "0417", { column: "person_id", ref: { kind: "person", by: "legacy" } }),
      col("amount_cents", "Amount", "money", "Dollars.", "$2,101", { required: true }),
      col("display_name", "Shown as", "text", "Optional.", "Shah family"),
      col("entered_at", "When", "datetime", "Optional.", "2019-09-01 11:40"),
    ],
  },
  {
    key: "events",
    label: "Past events",
    tier: "history",
    order: 242,
    table: "events",
    module: "events",
    writePerms: ["events.manage"],
    dependsOn: [],
    description: "Past events (attendance loads next).",
    matchNote: "Matched on the old event ID.",
    sourceKey: ["legacy_id"],
    fields: [
      legacyId(),
      col("name", "Event", "name", "The event's name.", "Mahavir Jayanti 2025", { required: true }),
      col("starts_at", "Starts", "datetime", "Date and time.", "2025-04-10 10:00", { required: true }),
      col("ends_at", "Ends", "datetime", "Optional.", "2025-04-10 14:00"),
      col("venue", "Venue", "text", "Optional.", "Main hall"),
      col("program_year", "Program year", "text", "Optional.", "2025"),
      col("description", "Description", "longtext", "Optional.", "Annual celebration"),
    ],
    note: "Imported events are completed.",
  },
  {
    key: "attendees",
    label: "Event attendance",
    tier: "history",
    order: 243,
    table: "attendees",
    module: "events",
    writePerms: ["events.manage"],
    dependsOn: ["events", "people", "households"],
    description: "Who attended past events.",
    matchNote: "Matched on event and person.",
    sourceKey: ["event_legacy_id", "person_legacy_id"],
    fields: [
      col("event_legacy_id", "Event (old ID)", "ref", "The event.", "EV-2025-04", { column: "event_id", required: true, ref: { kind: "event" } }),
      householdRef({ extra: "household_id" }, true),
      personRef({ column: "person_id" }, true),
      col("checked_in_at", "Checked in at", "datetime", "Optional.", "2025-04-10 10:12"),
    ],
  },
  {
    key: "pathshala_attendance",
    label: "Pathshala attendance",
    tier: "history",
    order: 244,
    table: "pathshala_attendance",
    module: "pathshala",
    writePerms: ["pathshala.manage"],
    dependsOn: ["pathshala_classes", "pathshala_enrollments"],
    description: "Past class attendance.",
    matchNote: "Matched on class, date and child.",
    sourceKey: ["class_name", "held_on", "person_legacy_id"],
    fields: [
      lookup("class_name", "Class", { extra: "class_id" }, "pathshala_classes", "name", "The class.", "Level 1 · Sunday", true),
      extra("held_on", "Date", "date", "The class date.", "2025-10-05", { required: true }),
      personRef({ extra: "student_person_id" }, true, "Child's person ID (old system)"),
      col("status", "Status", "enum", "Present, late, absent or excused.", "present", {
        required: true,
        options: [
          { value: "present", label: "Present" },
          { value: "late", label: "Late" },
          { value: "absent", label: "Absent" },
          { value: "excused", label: "Excused" },
        ],
      }),
      col("note", "Note", "text", "Optional.", "Left early"),
    ],
  },
];

/**
 * Columns that identify an existing row of setup data and the other simple
 * types (the database matches on them, case-insensitively). People, households,
 * memberships, pledges, payments and the linked types have their own matching
 * in the database (identifiers first, never a name alone).
 */
export const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  zones: ["name"],
  inboxes: ["key"],
  bank_accounts: ["name"],
  funds: ["key"],
  membership_types: ["key"],
  store_categories: ["name"],
  calendar_layers: ["key"],
  pathshala_tracks: ["key"],
  pathshala_terms: ["name"],
  practices: ["key"],
  gyan_goals: ["key"],
  campaigns: ["name"],
  event_templates: ["name"],
  event_template_items: ["template_id", "name"],
  volunteer_groups: ["name"],
  pathshala_levels: ["track_id", "key"],
  gyan_levels: ["goal_id", "key"],
  gyan_steps: ["level_id", "title"],
  opportunities: ["campaign_id", "name"],
  labh_options: ["name"],
  pickup_windows: ["starts_at"],
  pathshala_classes: ["term_id", "name"],
  whatsapp_groups: ["name"],
  pathshala_enrollments: ["term_id", "student_person_id"],
  pathshala_teachers: ["class_id", "person_id"],
  volunteer_interests: ["person_id", "group_id"],
  store_items: ["sku"],
  payment_allocations: ["payment_id", "pledge_id"],
  bolis: ["name"],
};

/** Tables without their own center_id (the center comes through the parent). */
export const NO_CENTER_TABLES: readonly string[] = ["gyan_levels", "gyan_steps"];

export const TIER_LABEL: Record<Tier, string> = {
  setup: "Setup data",
  records: "Records",
  history: "History and transactions",
};

export function entityDef(key: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.key === key);
}

/** Entities in Appendix B order. */
export function entitiesInOrder(): EntityDef[] {
  return [...ENTITIES].sort((a, b) => a.order - b.order);
}

/** Database columns an entity may write (the database keeps the same allow-list). */
export function entityColumns(e: EntityDef): string[] {
  return [...new Set(e.fields.map((f) => f.column).filter((c): c is string => Boolean(c)))].sort();
}

/** Side values an entity may carry. */
export function entityExtras(e: EntityDef): string[] {
  return [...new Set(e.fields.map((f) => f.extra).filter((c): c is string => Boolean(c)))].sort();
}

/** True when the user may import this data type (UI convenience; the database checks again). */
export function canImportEntity(perms: { permissions: readonly string[]; isPlatformAdmin: boolean }, e: EntityDef): boolean {
  return perms.isPlatformAdmin || e.writePerms.some((p) => perms.permissions.includes(p));
}
