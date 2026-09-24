// Human-readable audit entries for Settings › Audit log: a MODULE for each
// record table (the prototype's module chips) and a plain sentence for each
// action code ("payments.insert" → "Recorded a payment"). The raw code stays
// available beside the sentence.

export const AUDIT_MODULES = [
  { key: "all", label: "All" },
  { key: "giving", label: "Giving" },
  { key: "people", label: "People" },
  { key: "events", label: "Events" },
  { key: "comms", label: "Comms" },
  { key: "accounting", label: "Accounting" },
  { key: "settings", label: "Settings" },
  { key: "content", label: "Content" },
  { key: "store", label: "Store" },
  { key: "bolis", label: "Bolis" },
  { key: "reports", label: "Reports" },
] as const;
export type AuditModule = Exclude<(typeof AUDIT_MODULES)[number]["key"], "all">;

/** Record tables per module (the audited tables, 0011 + later migrations). */
export const MODULE_TABLES: Record<AuditModule, string[]> = {
  giving: ["pledges", "payments", "payment_allocations", "recurring_gifts", "campaigns", "opportunities", "bank_transactions", "bank_accounts"],
  people: [
    "households",
    "people",
    "household_members",
    "external_ids",
    "memberships",
    "membership_applications",
    "eligibility_snapshots",
    "data_requests",
    "pathshala_enrollments",
    "gyan_signoffs",
    "background_checks",
  ],
  events: ["events", "attendees", "lunch_slots", "volunteer_shifts"],
  comms: ["comms_campaigns", "messages", "message_templates"],
  accounting: ["ledger_postings", "qbo_account_mappings", "accounting_periods", "integration_connections", "payouts"],
  settings: ["centers", "role_grants", "roles", "legal_documents", "zones"],
  content: ["content_items", "photo_albums"],
  store: ["store_items", "store_orders"],
  bolis: ["bolis", "boli_entries", "counting_sessions", "valuables_register"],
  reports: [],
};

export function isAuditModule(v: unknown): v is AuditModule {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(MODULE_TABLES, v);
}

export function auditModule(table: string | null | undefined): AuditModule | null {
  if (!table) return null;
  for (const [mod, tables] of Object.entries(MODULE_TABLES) as [AuditModule, string[]][]) {
    if (tables.includes(table)) return mod;
  }
  return null;
}

export function moduleLabel(mod: AuditModule | null): string {
  return mod ? (AUDIT_MODULES.find((m) => m.key === mod)?.label ?? mod) : "—";
}

/** Singular, plain names for record tables. */
const THING: Record<string, string> = {
  households: "a household",
  people: "a person",
  household_members: "a household member",
  external_ids: "an identifier",
  memberships: "a membership",
  membership_applications: "a membership application",
  eligibility_snapshots: "a voting-eligibility record",
  role_grants: "a role grant",
  roles: "a role",
  pledges: "a pledge",
  payments: "a payment",
  payment_allocations: "a payment allocation",
  recurring_gifts: "a recurring gift",
  ledger_postings: "a ledger posting",
  qbo_account_mappings: "a QuickBooks account mapping",
  integration_connections: "an integration",
  accounting_periods: "an accounting period",
  data_requests: "a privacy request",
  centers: "the center settings",
  bolis: "a boli",
  boli_entries: "a boli pledge",
  counting_sessions: "a counting session",
  valuables_register: "a valuables entry",
  store_items: "a store item",
  store_orders: "a store order",
  content_items: "a content item",
  comms_campaigns: "a message campaign",
  legal_documents: "a legal document",
  background_checks: "a background check",
  pathshala_enrollments: "a Pathshala enrollment",
  gyan_signoffs: "a Gyan Path sign-off",
  bank_transactions: "a bank transaction",
  bank_accounts: "a bank account",
};

const VERB: Record<string, string> = { insert: "Created", update: "Changed", delete: "Deleted" };

/** Special sentences for common actions where "Created a …" reads wrong. */
const SPECIAL: Record<string, string> = {
  "payments.insert": "Recorded a payment",
  "role_grants.insert": "Granted a role",
  "role_grants.update": "Changed or ended a role grant",
  "role_grants.delete": "Removed a role grant",
  "centers.update": "Changed the center settings",
  "centers.insert": "Created a center",
  "pledges.insert": "Recorded a pledge",
  "boli_entries.insert": "Recorded a boli pledge",
  "data_requests.insert": "Received a privacy request",
  "membership_applications.insert": "Received a membership application",
};

/**
 * "payments.insert" → "Recorded a payment". Non-trigger actions written by
 * functions ("refund.approve", "export.households") read as their words.
 */
export function describeAuditAction(action: string, table: string | null | undefined): string {
  if (SPECIAL[action]) return SPECIAL[action];
  const dot = action.lastIndexOf(".");
  const op = dot >= 0 ? action.slice(dot + 1) : "";
  const subject = dot >= 0 ? action.slice(0, dot) : action;
  const thing = THING[table ?? subject];
  if (VERB[op] && thing) return `${VERB[op]} ${thing}`;
  const words = action.replace(/[._]/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : action;
}
