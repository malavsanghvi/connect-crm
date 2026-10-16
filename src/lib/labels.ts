// Human labels for enum-ish database values, shared across pages.

export const MEMBERSHIP_STATUS_TONE = {
  active: "success",
  pending: "warning",
  lapsed: "neutral",
  suspended: "danger",
  ended: "neutral",
} as const;

export const APPLICATION_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_reference: "Awaiting reference",
  reference_declined: "Reference declined",
  awaiting_center: "Awaiting center decision",
  awaiting_ec: "Awaiting EC approval",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export const PLEDGE_STATUS_TONE = {
  open: "warning",
  partially_paid: "navy",
  soft_credit: "navy",
  paid: "success",
  written_off: "neutral",
  cancelled: "neutral",
} as const;

export const PLEDGE_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  partially_paid: "Partly paid",
  soft_credit: "Soft credit",
  paid: "Paid",
  written_off: "Written off",
  cancelled: "Cancelled",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card: "Card",
  ach: "ACH",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  check: "Check",
  cash: "Cash",
  stock: "Stock",
  daf: "Donor-advised fund",
  matching_gift: "Matching gift",
  zelle: "Zelle",
  other: "Other",
};

/** Methods a volunteer may record as an offline payment in the console. */
export const OFFLINE_METHODS = ["check", "cash", "ach", "zelle", "stock"] as const;

export const ORIGINATOR_LABEL: Record<string, string> = {
  daf: "Donor-advised fund",
  matching_gift: "Matching-gift platform",
  payment_processor: "Card-processor payout",
  payroll_giving: "Payroll giving",
};

export const BANK_CHANNEL_LABEL: Record<string, string> = {
  zelle: "Zelle",
  check: "Check deposit",
  ach: "ACH",
  card_payout: "Card payout",
  cash_deposit: "Cash deposit",
  wire: "Wire",
  other: "Other",
};

export const LEDGER_STATUS_TONE = {
  queued: "navy",
  posting: "navy",
  posted: "success",
  failed: "danger",
  skipped: "neutral",
  superseded: "neutral",
} as const;

export function humanize(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ") : "—";
}

/**
 * QuickBooks account-mapping purposes (0009 qbo_account_mappings.purpose). The database's catalog is app.account_roles (0779),
 * which names each role in the organization's words (a module's role uses the module's name in its kind) and lists only the
 * roles the organization uses; Books › Account mapping and QuickBooks setup read it from there. This list is the fallback for
 * the screens that name a purpose without asking the database (the QuickBooks sync exceptions, the read-only command).
 */
export const QBO_PURPOSES: { purpose: string; label: string; hint: string }[] = [
  { purpose: "income.general", label: "General donations income", hint: "Unrestricted gifts, and money not tied to a pledge or a campaign" },
  { purpose: "income.boli", label: "Boli income", hint: "Pledges made in Bolis, once paid" },
  { purpose: "income.sponsorship", label: "Sponsorship income", hint: "Sponsorship pledges and sponsorship campaigns" },
  { purpose: "income.construction", label: "Construction fund income", hint: "Building and construction campaigns (usually a restricted fund)" },
  { purpose: "income.pathshala", label: "Pathshala income", hint: "School fees and gifts" },
  { purpose: "income.jeevdaya", label: "Jeevdaya income", hint: "Chosen before; no campaign or pledge posts to it now" },
  { purpose: "income.event", label: "Event income", hint: "Event commitments and event campaigns" },
  { purpose: "income.membership", label: "Membership dues income", hint: "Membership fees (dues)" },
  { purpose: "income.store", label: "Store giving income", hint: "Gifts to store campaigns (store sales have their own account)" },
  { purpose: "income.other", label: "Other income", hint: 'Campaigns of the kind "other"' },
  { purpose: "store.sales", label: "Store sales", hint: "Store sales, not donations" },
  { purpose: "store.gift_packing", label: "Store gift packing", hint: "Gift-pack charges on store orders" },
  { purpose: "store.cost", label: "Store cost of goods", hint: "What sold store items cost (cost of goods sold)" },
  { purpose: "sales_tax_payable", label: "Sales tax payable", hint: "Tax collected on store sales" },
  { purpose: "merchant_fees", label: "Merchant fees", hint: "Card-processor fees (expense)" },
  { purpose: "payment_clearing", label: "Payment clearing", hint: "Card money before the payout lands" },
  { purpose: "bank", label: "Bank account", hint: "The operating account deposits land in" },
  { purpose: "undeposited_funds", label: "Undeposited funds", hint: "Checks and cash until the deposit" },
  { purpose: "pledges_receivable", label: "Pledges receivable", hint: "Only used on accrual basis" },
  { purpose: "stock_clearing", label: "Stock clearing", hint: "Stock gifts until sold" },
  {
    purpose: "pledge_writeoffs",
    label: "Pledge write-offs",
    hint: "Written-off pledge balances (bad debt expense, or a contra-income account); a QuickBooks item must post to it",
  },
  { purpose: "refunds", label: "Refunds", hint: "Money given back, when your books keep refunds in an account of their own" },
];

export const LEDGER_TXN_LABEL: Record<string, string> = {
  donation_card: "Online donation",
  recurring_charge: "Recurring charge",
  boli_payment: "Boli payment",
  store_sale: "Store sale",
  refund: "Refund",
  processor_fee: "Processor fee",
  payout_deposit: "Deposit / payout",
  offline_receipt: "Offline receipt (undeposited)",
  bank_receipt: "Bank receipt",
  stock_gift: "Stock gift",
  pledge_receivable: "Pledge receivable",
  pledge_writeoff: "Pledge write-off",
  membership_fee: "Membership fee",
  adjustment: "Adjustment",
};
