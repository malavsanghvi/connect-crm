// Invented data for the Account mapping dev preview: a neutral community club (no tradition's words), its QuickBooks chart,
// one change waiting for a second person and the history. Pure.

import type { MappingOverview, MappingRequest, MappingRole, PulledChoice } from "@/lib/books/mapping";
import type { AccountMappingIn } from "@/lib/data/books-mapping";

export type MappingSample = "in_use" | "setup" | "mine";

const INCOME = ["Income", "Other Income"];

const role = (over: Partial<MappingRole> & Pick<MappingRole, "key" | "label">): MappingRole => ({
  kind: "fund", hint: null, account_types: INCOME, needs_item: true, required: false, used: 0, waiting_postings: 0, account_id: null,
  mapped_account_id: null, account_name: null, account_type: null, approved: false, problem: null, ...over,
});

const mapped = (key: string, label: string, id: string, name: string, type: string, over: Partial<MappingRole> = {}): MappingRole =>
  role({ key, label, account_id: id, mapped_account_id: id, account_name: name, account_type: type, approved: true, ...over });

const request = (over: Partial<MappingRequest>): MappingRequest => ({
  id: "5a1e0000-0000-4000-8000-000000000001", subject: "role", target_key: "income.membership", target_label: "Membership dues income",
  from_ref: null, from_name: null, to_ref: "13", to_name: "Member Dues", to_type: "Income", mode: "request", status: "pending", expired: false,
  requested_by: "u-sam", requested_by_name: "Sam Carter", requested_at: "2026-10-11T15:20:00Z", request_reason: "Our accountant opened a dues account",
  expires_at: "2026-10-25T15:20:00Z", decided_by_name: null, cancelled_by_name: null, decided_at: null, decision_reason: null, applied_at: null,
  queued_postings: null, requeued_postings: null, mine: false, ...over,
});

const ROLES: MappingRole[] = [
  mapped("income.general", "General donations income", "1", "Contributions", "Income", { required: true, hint: "Unrestricted gifts, and money not tied to a pledge or a campaign" }),
  mapped("income.sponsorship", "Sponsorship income", "6", "Sponsorships", "Income", { hint: "Sponsorship pledges and sponsorship campaigns" }),
  role({ key: "income.construction", label: "Construction fund income", hint: "Building and construction campaigns (usually a restricted fund)",
    problem: "Construction fund income has no QuickBooks account yet. Choose one in Account mapping." }),
  role({ key: "income.event", label: "Event income", hint: "Event commitments and event campaigns", used: 2,
    problem: "Event income has no QuickBooks account yet. Choose one in Account mapping." }),
  role({ key: "income.membership", label: "Membership dues income", hint: "Membership fees (dues)", used: 14, waiting_postings: 3,
    problem: "Membership dues income has no QuickBooks account yet. Choose one in Account mapping." }),
  role({ key: "income.other", label: "Other income", hint: 'Campaigns of the kind "other"',
    problem: "Other income has no QuickBooks account yet. Choose one in Account mapping." }),
  mapped("merchant_fees", "Merchant fees", "5", "Processing Fees", "Expense", { kind: "role", required: true, used: null, needs_item: false,
    account_types: ["Expense", "Other Expense", "Cost of Goods Sold"], hint: "Card-processor fees (expense)" }),
  mapped("payment_clearing", "Payment clearing", "4", "Card Clearing", "Bank", { kind: "role", required: true, used: null, needs_item: false,
    account_types: ["Bank", "Other Current Asset"], hint: "Card money before the payout lands" }),
  mapped("bank", "Bank account", "2", "Checking", "Bank", { kind: "role", required: true, used: null, needs_item: false, account_types: ["Bank"],
    hint: "The operating account deposits land in" }),
  mapped("undeposited_funds", "Undeposited funds", "3", "Undeposited Funds", "Other Current Asset", { kind: "role", required: true, used: null,
    needs_item: false, account_types: ["Other Current Asset", "Bank"], hint: "Checks and cash until the deposit" }),
  role({ key: "pledge_writeoffs", label: "Pledge write-offs", kind: "role", used: null, needs_item: false, account_types: ["Expense", "Other Expense", "Income", "Other Income"],
    hint: "Written-off pledge balances (bad debt expense, or a contra-income account); a QuickBooks item must post to it",
    problem: "Pledge write-offs has no QuickBooks account yet. Choose one in Account mapping." }),
];

const ACCOUNTS: PulledChoice[] = [
  { qbo_id: "1", name: "Contributions", fully_qualified_name: "Contributions", account_type: "Income", active: true },
  { qbo_id: "6", name: "Sponsorships", fully_qualified_name: "Contributions:Sponsorships", account_type: "Income", active: true },
  { qbo_id: "13", name: "Member Dues", fully_qualified_name: "Member Dues", account_type: "Income", active: true },
  { qbo_id: "14", name: "Event Income", fully_qualified_name: "Event Income", account_type: "Income", active: true },
  { qbo_id: "2", name: "Checking", fully_qualified_name: "Checking", account_type: "Bank", active: true },
  { qbo_id: "22", name: "Savings", fully_qualified_name: "Savings", account_type: "Bank", active: true },
  { qbo_id: "3", name: "Undeposited Funds", fully_qualified_name: "Undeposited Funds", account_type: "Other Current Asset", active: true },
  { qbo_id: "4", name: "Card Clearing", fully_qualified_name: "Card Clearing", account_type: "Bank", active: true },
  { qbo_id: "5", name: "Processing Fees", fully_qualified_name: "Processing Fees", account_type: "Expense", active: true },
];

const CLASSES: PulledChoice[] = [
  { qbo_id: "30", name: "Operating", active: true },
  { qbo_id: "31", name: "Building", active: true },
];

export function sampleAccountMapping(sample: MappingSample): AccountMappingIn {
  const inUse = sample !== "setup";
  const waiting = inUse ? [request({ mine: sample === "mine" })] : [];
  const history: MappingRequest[] = [
    request({ id: "5a1e0000-0000-4000-8000-000000000002", subject: "role", target_key: "income.sponsorship", target_label: "Sponsorship income",
      from_name: "Contributions", from_ref: "1", to_ref: "6", to_name: "Sponsorships", status: "applied", decided_by_name: "Grace Lindqvist",
      decided_at: "2026-10-03T17:00:00Z", decision_reason: "Matches the chart our accountant set up", applied_at: "2026-10-03T17:00:00Z",
      requested_at: "2026-10-02T14:00:00Z", request_reason: "Sponsorships get their own income account", requeued_postings: 2 }),
    request({ id: "5a1e0000-0000-4000-8000-000000000003", target_key: "income.general", target_label: "General donations income", to_ref: "1",
      to_name: "Contributions", mode: "setup", status: "applied", applied_at: "2026-09-20T10:00:00Z", requested_at: "2026-09-20T10:00:00Z",
      request_reason: "Chose the QuickBooks account for General donations income", expires_at: null }),
  ];
  const overview: MappingOverview = {
    in_use: inUse,
    can_request: true,
    can_approve: true,
    connection: { id: "c-1", provider: "quickbooks_online", status: "connected", realm_id: "9130350000000001", display_name: "Lakeside Community Club books",
      read_only: false, basis: "cash" },
    mapping_approved_at: inUse ? "2026-09-21T16:00:00Z" : null,
    mapping_approved_by_name: inUse ? "Grace Lindqvist" : null,
    roles: inUse ? ROLES : ROLES.map((r) => ({ ...r, approved: false, account_id: null, problem: r.mapped_account_id ? "Not approved yet." : r.problem })),
    funds: [
      { id: "f-1", key: "general", name: "Operating fund", restricted: false, class_id: "30", mapped_class_id: "30", class_name: "Operating", problem: null, waiting_postings: 0 },
      { id: "f-2", key: "building", name: "Building fund", restricted: true, class_id: null, mapped_class_id: null, class_name: null, problem: null, waiting_postings: 0 },
    ],
    bank_accounts: [
      { id: "b-1", name: "Checking", last4: "4410", account_id: "2", mapped_account_id: "2", account_name: "Checking", uses_main_bank: false, problem: null, waiting_postings: 0 },
      { id: "b-2", name: "Savings", last4: "9921", account_id: null, mapped_account_id: null, account_name: null, uses_main_bank: false, waiting_postings: 1,
        problem: 'The bank account "Savings" has no QuickBooks account of its own, and this organization has more than one bank account, so Weaver cannot tell which QuickBooks bank account its money lands in. Choose it in Account mapping.' },
    ],
    requests: [...waiting, ...(inUse ? history : history.slice(1))],
  };
  return { overview, accounts: ACCOUNTS, classes: CLASSES, listsError: null };
}
