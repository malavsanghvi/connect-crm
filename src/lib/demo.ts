// Setup › Demo data (onboarding stream o-demo): pure helpers for the screen.
// The database decides everything that matters (app.demo_center_problem, the
// RPCs activate_demo_pack / reset_sandbox / clear_sandbox); this file only
// words it for people.

import type { Json } from "@/lib/database.types";

export type DemoStatus = "empty" | "loading" | "loaded" | "clearing" | "failed";

export const DEMO_STATUS_LABEL: Record<DemoStatus, string> = {
  empty: "No demo data",
  loading: "Loading the demo pack",
  loaded: "Demo pack loaded",
  clearing: "Clearing the sandbox",
  failed: "The last run failed",
};

export function demoStatus(v: string | null | undefined): DemoStatus {
  return v === "loading" || v === "loaded" || v === "clearing" || v === "failed" ? v : "empty";
}

/** A load or clear is under way (the page refreshes itself and the buttons wait). */
export function isDemoBusy(status: DemoStatus): boolean {
  return status === "loading" || status === "clearing";
}

/** The refusal every screen shows in production (the database says the same, SQLSTATE CCDMO). */
export const DEMO_ONLY_SANDBOX = "Demo data is only for sandboxes.";

/** What an admin types to confirm a reset or a clear: the short name, else the web name (app.demo_confirm_word). */
export function demoConfirmWord(center: { short_name: string | null; slug: string }): string {
  const s = (center.short_name ?? "").trim();
  return s || center.slug;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * What Reset and Clear remove, said plainly: everything the organization entered, not only
 * the demo data. A sandbox that holds the organization's own records (JSH, entitlement
 * promotion.in_place) is told that those records go too, with the current counts.
 */
export function clearScope(orgName: string, counts: Record<string, number>, holdsOwnRecords: boolean): { title: string; body: string } {
  const people = counts.people ?? 0;
  const households = counts.households ?? 0;
  if (holdsOwnRecords) {
    return {
      title: `${orgName}'s own records are not demo data — clearing removes them too`,
      body:
        `${orgName} holds ${plural(people, "person", "people")} and ${plural(households, "household", "households")} entered by the organization. ` +
        "Reset and Clear remove every record the organization entered — people, households, giving history, events, classes and setup lists — not only the demo data. " +
        "Loading the demo pack adds demo records next to yours, and the only way to remove them again is Clear. This cannot be undone.",
    };
  }
  return {
    title: "Reset and Clear remove everything entered here",
    body: "Every person, household, payment, event and setup list the organization entered or loaded is removed — not only the demo data. This cannot be undone.",
  };
}

/** The confirmation text for Reset ("reset") or Clear ("clear"). */
export function clearConfirmMessage(kind: "reset" | "clear", orgName: string): string {
  const what = `Every record ${orgName} entered — people, households, payments and setup lists, not only the demo data — is removed`;
  return kind === "reset" ? `Reset ${orgName}?\n${what}, then the demo pack is loaded again. This cannot be undone.` : `Clear ${orgName}?\n${what}. This cannot be undone.`;
}

/** The typed confirmation matches, ignoring case and spaces around it (as the database does). */
export function confirmMatches(typed: string | null | undefined, word: string): boolean {
  return (typed ?? "").trim().toLowerCase() === word.trim().toLowerCase() && word.trim() !== "";
}

/** "4 of 10 steps" and a percentage for the progress bar. */
export function demoProgress(state: { status: string; steps_done: number; steps_total: number } | null): { pct: number; text: string } {
  if (!state) return { pct: 0, text: "" };
  const s = demoStatus(state.status);
  if (s === "clearing") return { pct: 0, text: "Removing the sandbox's records" };
  if (s === "loaded") return { pct: 100, text: `${state.steps_total} of ${state.steps_total} steps` };
  const total = Math.max(state.steps_total, 0);
  const done = Math.min(Math.max(state.steps_done, 0), total);
  return { pct: total === 0 ? 0 : Math.round((done / total) * 100), text: `${done} of ${total} steps` };
}

// ── What the pack contains ───────────────────────────────────────────────────

/** Plain names for the tables the pack fills (anything else shows its table name, spaced). */
const TABLE_LABEL: Record<string, string> = {
  households: "Households",
  people: "People",
  household_members: "Family members",
  person_emails: "Email addresses",
  external_ids: "Legacy IDs",
  special_days: "Special days",
  consents: "Consents",
  zones: "Zones",
  merge_candidates: "Possible duplicates",
  household_change_requests: "Family change requests",
  staff_invitations: "Staff invitations",
  custom_field_definitions: "Custom fields",
  custom_staff_values: "Staff-only custom values",
  memberships: "Memberships",
  membership_types: "Membership types",
  membership_applications: "Applications",
  eligibility_snapshots: "Voting eligibility",
  events: "Events",
  rsvps: "RSVPs",
  attendees: "Tickets",
  scan_log: "Check-ins",
  lunch_slots: "Lunch slots",
  actions: "Event checklist items",
  event_templates: "Event templates",
  event_template_items: "Template items",
  funds: "Funds",
  campaigns: "Campaigns",
  opportunities: "Sponsorship options",
  pledges: "Pledges",
  payments: "Payments (history)",
  payment_allocations: "Allocations",
  recurring_gifts: "Recurring gifts",
  labh_options: "Labh options",
  labh_fulfillments: "Labh fulfillments",
  bank_accounts: "Bank accounts",
  bank_transactions: "Bank lines to match",
  center_payment_methods: "Payment methods",
  bolis: "Bolis",
  boli_entries: "Boli pledges",
  store_categories: "Store categories",
  store_items: "Store items",
  pickup_windows: "Pickup windows",
  store_orders: "Store orders",
  store_order_lines: "Order lines",
  inventory_movements: "Stock movements",
  pathshala_terms: "Terms",
  pathshala_tracks: "Tracks",
  pathshala_levels: "Levels",
  pathshala_classes: "Classes",
  pathshala_teachers: "Teachers",
  pathshala_enrollments: "Enrollments",
  pathshala_sessions: "Class days",
  pathshala_attendance: "Attendance marks",
  pathshala_progress_reports: "Progress reports",
  class_announcements: "Class announcements",
  teacher_positions: "Teaching positions",
  teacher_applications: "Teacher applications",
  gyan_goals: "Gyan Path goals",
  gyan_levels: "Gyan Path levels",
  gyan_steps: "Gyan Path steps",
  gyan_progress: "Steps completed",
  gyan_signoffs: "Teacher sign-offs",
  practices: "Practices",
  practice_selections: "Practices chosen",
  practice_logs: "Practice logs",
  points_ledger: "Points",
  streaks: "Streaks",
  saathi_settings: "Saathi settings",
  anumodana: "Anumodana",
  daily_timings: "Daily timings",
  content_items: "Library items",
  guide_sections: "Guide sections",
  role_roster: "Committee roster",
  photo_albums: "Photo albums",
  calendar_layers: "Calendar layers",
  calendar_entries: "Calendar entries",
  tithi_days: "Tithi days",
  inboxes: "Inboxes",
  threads: "Inbox threads",
  thread_messages: "Thread messages",
  comms_campaigns: "Newsletters and announcements",
  messages: "Messages (history)",
  alerts: "Alerts",
  channel_optins: "Email opt-ins",
  whatsapp_groups: "WhatsApp groups",
  whatsapp_join_requests: "WhatsApp join requests",
  surveys: "Surveys",
  survey_responses: "Survey responses",
  saved_segments: "Saved segments",
  volunteer_groups: "Volunteer groups",
  volunteer_shifts: "Volunteer shifts",
  volunteer_assignments: "Shift sign-ups",
  volunteer_interests: "Volunteer interests",
  background_checks: "Background checks",
  accounting_periods: "Accounting months",
  public_kpi_settings: "Public dashboard figures",
  niva_conversations: "Niva questions",
  resolutions: "Resolutions",
  concerns: "Concerns",
};

export function demoTableLabel(table: string): string {
  return TABLE_LABEL[table] ?? table.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type PackModule = { module: string; label: string; rows: { table: string; label: string; count: number }[]; total: number };

/** demo_packs.contents → modules with their rows, biggest first inside each module. Bad entries are skipped, never invented. */
export function packModules(contents: Json | null | undefined): PackModule[] {
  if (!Array.isArray(contents)) return [];
  const out: PackModule[] = [];
  for (const m of contents) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const o = m as Record<string, Json | undefined>;
    const rowsObj = o.rows;
    if (typeof o.module !== "string" || !rowsObj || typeof rowsObj !== "object" || Array.isArray(rowsObj)) continue;
    const rows = Object.entries(rowsObj)
      .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
      .map(([table, count]) => ({ table, label: demoTableLabel(table), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    out.push({ module: o.module, label: typeof o.label === "string" ? o.label : o.module, rows, total: rows.reduce((s, r) => s + r.count, 0) });
  }
  return out;
}

/** The headline rows of a module for a one-line summary ("25 households · 76 people · …"). */
export function moduleSummary(m: PackModule, max = 4): string {
  return m.rows
    .slice(0, max)
    .map((r) => `${r.count.toLocaleString("en-US")} ${r.label.toLowerCase()}`)
    .join(" · ");
}

/** {table: rows} from demo_data_counts / detail.loaded, numbers only. */
export function countsOf(v: Json | null | undefined): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === "number") out[k] = n;
  return out;
}

/** Sum of rows in the tables of one module, from a {table: rows} map. */
export function moduleCount(m: PackModule, counts: Record<string, number>): number {
  return m.rows.reduce((s, r) => s + (counts[r.table] ?? 0), 0);
}
