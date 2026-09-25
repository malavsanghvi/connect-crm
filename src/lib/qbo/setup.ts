// QuickBooks setup screen (Accounting › QuickBooks setup): what app.qbo_status
// returns, and the pure helpers the screen uses. Tested in tests/qbo.test.ts.

import type { Json } from "@/lib/database.types";

export type QboWarning = { level: "error" | "warning"; purpose?: string; fund_id?: string; text: string };
export type QboTestResult = { entity: string; ok: boolean; qbo_id?: string; doc_number?: string | null; total_cents?: number; error?: string; checked?: string[] };

export type QboStatus = {
  environment: "production" | "sandbox";
  entitlement: Json;
  module_on: boolean;
  can_connect: boolean;
  can_manage: boolean;
  connection: null | {
    id: string;
    provider: "quickbooks_online" | "intuit_sandbox";
    status: "disconnected" | "connected" | "expiring" | "error";
    display_name: string | null;
    realm_id: string | null;
    company: "real" | "sandbox";
    read_only: boolean;
    mode: string | null;
    connected_at: string | null;
    connected_by: string | null;
    token_expires_at: string | null;
    access_expires_at: string | null;
    last_refresh_at: string | null;
    connect_state: string | null;
    last_error: string | null;
    alert: null | { subject: string; detail: string | null; at: string; outcome: string | null };
  };
  other_connection: null | { provider: string; status: string; display_name: string | null };
  settings: {
    basis: string | null;
    basis_chosen_at?: string | null;
    basis_chosen_by?: string | null;
    basis_changed_at?: string | null;
    basis_changed_by?: string | null;
    basis_changed_from?: string | null;
    basis_note?: string | null;
    posting: string | null;
    go_live_date: string | null;
    mapping_approved_at: string | null;
    mapping_approved_by: string | null;
    test_post_approved_at: string | null;
    test_post_approved_by: string | null;
  };
  /** The basis the organization's setup (center rules accounting.basis) suggests; a hint, never chosen for them. */
  suggested_basis?: "cash" | "accrual" | null;
  /** Accrual chosen: posting is cash-only for now, so postings wait. */
  accrual_waiting?: boolean;
  /** Postings waiting in the queue for QuickBooks. */
  postings_waiting?: number;
  lists: Record<string, number>;
  last_pull: null | { status: string; finished_at: string; error: string | null; counts: Record<string, number>; changed: Record<string, number> };
  warnings: QboWarning[];
  required_purposes: string[];
  missing_purposes: string[];
  test_post: null | {
    id: string;
    mode: "post" | "dry_run";
    status: "queued" | "running" | "succeeded" | "failed";
    results: QboTestResult[];
    error: string | null;
    requested_at: string;
    requested_by: string | null;
    finished_at: string | null;
    approved_at: string | null;
    approved_by: string | null;
  };
  post_ready: { ok: boolean; reason?: string };
  readiness: { ok: boolean; detail: string };
  jobs: { id: number; kind: string; status: string; last_error: string | null; created_at: string; finished_at: string | null }[];
};

/** Account types each purpose accepts (mirrors app.qbo_purposes()). */
export const PURPOSE_TYPES: Record<string, string[]> = {
  "income.general": ["Income", "Other Income"],
  "income.boli": ["Income", "Other Income"],
  "income.sponsorship": ["Income", "Other Income"],
  "income.construction": ["Income", "Other Income"],
  "income.pathshala": ["Income", "Other Income"],
  "income.jeevdaya": ["Income", "Other Income"],
  "income.event": ["Income", "Other Income"],
  "income.membership": ["Income", "Other Income"],
  "income.store": ["Income", "Other Income"],
  "income.other": ["Income", "Other Income"],
  "store.sales": ["Income", "Other Income"],
  "store.gift_packing": ["Income", "Other Income"],
  sales_tax_payable: ["Other Current Liability"],
  merchant_fees: ["Expense", "Other Expense", "Cost of Goods Sold"],
  payment_clearing: ["Bank", "Other Current Asset"],
  bank: ["Bank"],
  undeposited_funds: ["Other Current Asset", "Bank"],
  pledges_receivable: ["Accounts Receivable", "Other Current Asset"],
  stock_clearing: ["Other Current Asset", "Bank", "Other Asset"],
  pledge_writeoffs: ["Expense", "Other Expense", "Income", "Other Income"],
};

export type PulledAccount = { qbo_id: string; name: string; fully_qualified_name: string | null; account_type: string | null; active: boolean };

/** The accounts the treasurer may pick for a purpose: active, of an accepted type, sorted by full name. */
export function accountChoices(purpose: string, accounts: PulledAccount[]): PulledAccount[] {
  const types = PURPOSE_TYPES[purpose];
  return accounts
    .filter((a) => a.active && (!types || !a.account_type || types.includes(a.account_type)))
    .sort((a, b) => (a.fully_qualified_name ?? a.name).localeCompare(b.fully_qualified_name ?? b.name));
}

export type StepState = "done" | "current" | "todo" | "blocked";

/** The accounting basis, in words. */
export const BASIS_LABEL: Record<string, string> = { cash: "Cash", accrual: "Accrual" };

/**
 * What the screen and readiness say when accrual is chosen (mirrors app.qbo_accrual_waiting_text()):
 * posting is cash-only for now, so postings wait and nothing is posted wrongly.
 */
export const ACCRUAL_WAITING =
  "Accrual-basis posting isn't available yet: Community Connect posts on cash basis only. Postings wait in the queue and nothing is posted until accrual posting is available or the basis is changed to cash.";

export function isBasis(v: string | null | undefined): v is "cash" | "accrual" {
  return v === "cash" || v === "accrual";
}

/** The six steps of plan §1.7 with where the treasurer is. The accounting basis is the first choice after connecting. */
export function setupSteps(s: Pick<QboStatus, "connection" | "last_pull" | "settings" | "test_post">): { key: string; label: string; state: StepState }[] {
  const connected = Boolean(s.connection && (s.connection.status === "connected" || s.connection.status === "expiring"));
  const basis = isBasis(s.settings.basis);
  const pulled = s.last_pull?.status === "succeeded" || Object.keys(s.last_pull?.counts ?? {}).length > 0;
  const chosen = Boolean(basis && s.settings.posting && s.settings.go_live_date);
  const mapped = Boolean(s.settings.mapping_approved_at);
  const tested = Boolean(s.settings.test_post_approved_at);
  const flags = [connected, connected && basis, connected && pulled, chosen, mapped, tested];
  const labels = [
    ["connect", "Connect"],
    ["basis", "Accounting basis"],
    ["pull", "Pull the chart and lists"],
    ["choose", "Posting and go-live date"],
    ["map", "Map and approve"],
    ["test", "Test post"],
  ];
  const firstTodo = flags.findIndex((f) => !f);
  return labels.map(([key, label], i) => ({
    key: key!,
    label: label!,
    state: flags[i] ? "done" : i === firstTodo ? "current" : !connected && i > 0 ? "blocked" : key === "map" && !basis ? "blocked" : "todo",
  }));
}

export const COMPANY_LABEL = { real: "Your QuickBooks company", sandbox: "Intuit sandbox company" } as const;

/** One line for the connection: what, in which mode. */
export function connectionSummary(c: NonNullable<QboStatus["connection"]>): string {
  const what = c.display_name ?? (c.realm_id ? `QuickBooks company ${c.realm_id}` : "QuickBooks");
  if (c.status === "disconnected") return "Not connected";
  const mode = c.read_only ? "read-only (nothing is posted)" : c.provider === "intuit_sandbox" ? "Intuit sandbox company, test mode" : c.mode === "live" ? "live" : "test mode";
  return `${what} · ${mode}`;
}

export function reasonProblem(reason: string, doing: string): string | null {
  const r = reason.trim();
  if (!r) return `Could not ${doing} — say why. The reason is kept in the audit log.`;
  if (r.length > 500) return `Could not ${doing} — keep the reason under 500 characters.`;
  return null;
}

/**
 * What a live test post does, said before it runs and again once it is queued (owner decision
 * 2026-09-25 #10; mirrors app.qbo_test_post_explained()). Backlog B9 keeps "void them automatically".
 */
export const TEST_POST_EXPLAINED =
  "The live test post creates four real $1.00 entries in your QuickBooks company — a sales receipt, a refund receipt, a deposit and a journal entry, " +
  "each marked “Community Connect test post”. Afterwards the treasurer voids them in QuickBooks.";
export const TEST_POST_HOW_TO_VOID =
  "In QuickBooks, search for “Community Connect test post”, open each of the four entries and choose More › Void " +
  "(a deposit or journal entry that has no Void is deleted with More › Delete).";
