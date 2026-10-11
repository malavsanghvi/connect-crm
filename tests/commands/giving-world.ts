// A small community for the Giving command tests: the helpers' community with children in it, but with real-looking ids (the
// Giving commands take a household id as a uuid), plus a database stand-in that throws on any write.

import { communityWithChildren, type FakeDbOptions } from "./helpers";

export const SHAH = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c2001";
export const PATEL = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c2002";
export const MEHTA = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c2003";
const IDS: Record<string, string> = { "hh-shah": SHAH, "hh-patel": PATEL, "hh-mehta": MEHTA };
const BACK = Object.fromEntries(Object.entries(IDS).map(([k, v]) => [v, k]));

const swap = <T,>(v: T): T => {
  let text = JSON.stringify(v);
  for (const [k, id] of Object.entries(IDS)) text = text.split(k).join(id);
  return JSON.parse(text) as T;
};

export type Rpc = NonNullable<FakeDbOptions["rpc"]>;

export function givingWorld(extraRpc: Rpc = {}, failRpc: FakeDbOptions["failRpc"] = {}, tables: FakeDbOptions["tables"] = {}): FakeDbOptions {
  const base = communityWithChildren();
  const card = base.rpc.household_card as (a: Record<string, unknown>) => unknown;
  return {
    tables: { ...swap(base.tables), ...tables },
    rpc: { ...base.rpc, household_card: (a: Record<string, unknown>) => swap(card({ p_household: BACK[String(a.p_household)] ?? a.p_household })), ...extraRpc },
    failRpc,
  };
}

/** The same database, but any write (a table insert, update, upsert, delete, or a function that records, matches or approves) throws. */
export function noWrites<T extends object>(db: T): T {
  const WRITE_TABLE = new Set(["insert", "update", "upsert", "delete"]);
  const WRITE_FN = /^(record|confirm|match|approve|reject|link|attach|set|create|request|report|withdraw|apply|ignore|restore|import)_/;
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) =>
          new Proxy((target as unknown as { from: (t: string) => object }).from(table), {
            get(builder, method) {
              if (WRITE_TABLE.has(String(method))) throw new Error(`the draft tried to ${String(method)} ${table}`);
              return (builder as Record<string | symbol, unknown>)[method];
            },
          });
      }
      if (prop === "rpc") {
        return (fn: string, args: Record<string, unknown>) => {
          if (WRITE_FN.test(fn)) throw new Error(`the draft tried to call ${fn}`);
          return (target as unknown as { rpc: (f: string, a: unknown) => unknown }).rpc(fn, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

// What the database answers for the Giving reads, with a child's name hidden in a free-text field to prove it never gets through.
export const GIVING_ANSWERS: Rpc = {
  giving_household_summary: {
    household_id: SHAH,
    as_of: "2026-10-10",
    lifetime: { payments: 2, received_cents: 30000, refunded_cents: 0, first_gift_on: "2025-01-02", last_gift_on: "2026-09-14" },
    years: [{ year: 2026, payments: 1, received_cents: 25000, refunded_cents: 0 }],
    recent_payments: [{ id: "pay-1", receipt_number: "R-1", received_on: "2026-09-14", method: "check", amount_cents: 25000, refunded_cents: 0, status: "captured" }],
    open_pledge_count: 0,
    open_cents: 0,
    behind_cents: 0,
    open_pledges: [],
    recurring_active: 0,
  },
  giving_unmatched_bank_lines: {
    gifts: 1,
    gifts_cents: 5000,
    deposits: 0,
    deposits_cents: 0,
    debits: 0,
    payouts: 0,
    oldest_posted_on: "2026-10-01",
    oldest_days: 9,
    lines: [{ id: "b1", kind: "gift", posted_on: "2026-10-01", days_waiting: 9, amount_cents: 5000, channel: "zelle", payer_name: "Zoya Shah", reference: null, description: "Zelle from Zoya Shah", status: "unmatched", account: "Chase" }],
  },
  giving_zelle_waiting: {
    reported: 1,
    unmatched: 0,
    past_window: 0,
    total_cents: 5000,
    reports: [{ id: "r1", household_id: SHAH, status: "reported", amount_cents: 5000, sent_on: "2026-10-08", days_waiting: 2, due_on: "2026-10-18", past_window: false, sender_name: "Zoya Shah", has_confirmation: false, pledges_named: 0, is_test: false }],
  },
  zelle_exact_matches: [
    { report_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4001", bank_transaction_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4101", amount_cents: 5000, sent_on: "2026-10-08", posted_on: "2026-10-09", confirmation: "WFCT0H7K2M1Q", payer_name: "Zoya Shah",
      household: { household_id: SHAH, household_number: "H-1001", members: "Priya, Rahul, Zoya" } },
  ],
  giving_second_approver_queue: {
    refund_count: 1,
    refunds: [{ payment_id: "pay-9", receipt_number: "R-9", household_id: SHAH, method: "check", provider: "offline", status: "captured", received_on: "2026-09-01", payment_amount_cents: 25000, refunded_cents: 0, requested_cents: 25000, reason: "Zoya Shah's check was a duplicate", requested_by: "user-2", matched_to_deposit: false }],
    write_off_count: 0,
    write_offs: [],
    provider_refund_count: 0,
    provider_refunds: [],
  },
  giving_fund_mapping_status: { required_purposes: ["bank"], missing_purposes: ["bank"], mapped_count: 0, approved_count: 0, mappings: [], funds_count: 1, funds_without_class: [{ id: "f", key: "k", name: "Zoya Shah memorial fund", restricted: true }] },
  giving_deposit_context: {
    bank_line: { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4201", posted_on: "2026-10-01", amount_cents: 30000, description: "Deposit from Zoya Shah's class", status: "unmatched", is_batch_deposit: true },
    payments: [
      { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4301", receipt_number: "R-1", household_id: SHAH, amount_cents: 25000, method: "check", check_number: "1043", envelope_number: null, received_on: "2026-09-28", can_match: true, already_deposited: false },
      { id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c4302", receipt_number: "R-2", household_id: MEHTA, amount_cents: 5000, method: "cash", check_number: null, envelope_number: null, received_on: "2026-09-29", can_match: true, already_deposited: false },
    ],
    missing_ids: [],
    total_cents: 30000,
    difference_cents: 0,
  },
  giving_draft_context: {
    household_id: SHAH,
    open_pledges: [{ id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c3001", pledge_number: "P-1", source: "general", amount_cents: 50000, paid_cents: 0, status: "open", pledged_at: "2026-01-10T12:00:00Z", due_on: null, fund: null, campaign: null }],
    month_closed: false,
    duplicates: [],
    check_number_elsewhere: 0,
  },
};
