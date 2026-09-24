// A posting's "document" (decided in the database, app.qbo_posting_doc) turned
// into QuickBooks Online JSON. Pure, so it is unit-tested.

export type DocLine = {
  amount_cents: number;
  description?: string | null;
  item_id?: string | null;
  account_id?: string | null;
  class_id?: string | null;
  posting?: "Debit" | "Credit";
};

export type QboDoc = {
  entity: "SalesReceipt" | "RefundReceipt" | "Deposit" | "JournalEntry";
  txn_date: string;
  doc_number?: string | null;
  private_note?: string | null;
  customer_ref?: string | null;
  customer_status?: string | null;
  deposit_account?: string | null;
  lines: DocLine[];
};

const ENTITIES = ["SalesReceipt", "RefundReceipt", "Deposit", "JournalEntry"] as const;

/** Whole cents to QuickBooks' decimal dollars (never floating-point drift: 1999 -> 19.99). */
export function dollars(cents: number): number {
  if (!Number.isInteger(cents)) throw new Error(`amount must be whole cents (got ${cents})`);
  return Number((cents / 100).toFixed(2));
}

const ref = (v: string | null | undefined) => (v ? { value: v } : undefined);

function strip<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

/** Checks the document and throws a plain sentence when it cannot be posted as it is. */
export function checkDoc(doc: QboDoc): void {
  if (!ENTITIES.includes(doc.entity)) throw new Error(`Unknown QuickBooks entry type "${doc.entity}"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.txn_date ?? "")) throw new Error("The entry has no date");
  if (!Array.isArray(doc.lines) || doc.lines.length === 0) throw new Error("The entry has no lines");
  for (const l of doc.lines) {
    if (!Number.isInteger(l.amount_cents) || l.amount_cents <= 0) throw new Error("A line has no amount");
  }
  if (doc.entity === "JournalEntry") {
    const sum = (t: string) => doc.lines.filter((l) => l.posting === t).reduce((s, l) => s + l.amount_cents, 0);
    if (sum("Debit") !== sum("Credit") || sum("Debit") === 0) throw new Error("The journal entry does not balance");
    if (doc.lines.some((l) => !l.account_id || (l.posting !== "Debit" && l.posting !== "Credit"))) throw new Error("A journal line has no account or side");
  } else if (!doc.deposit_account) {
    throw new Error("The entry has no account to deposit to");
  }
  if ((doc.entity === "SalesReceipt" || doc.entity === "RefundReceipt") && doc.lines.some((l) => !l.item_id)) {
    throw new Error("A sales line has no QuickBooks item");
  }
  if (doc.entity === "Deposit" && doc.lines.some((l) => !l.account_id)) throw new Error("A deposit line has no account");
}

export function totalCents(doc: QboDoc): number {
  const lines = doc.entity === "JournalEntry" ? doc.lines.filter((l) => l.posting === "Debit") : doc.lines;
  return lines.reduce((s, l) => s + l.amount_cents, 0);
}

/** The QuickBooks JSON body for the create call. */
export function toQbo(doc: QboDoc): Record<string, unknown> {
  checkDoc(doc);
  const head = strip({
    TxnDate: doc.txn_date,
    DocNumber: doc.doc_number ? doc.doc_number.slice(0, 21) : undefined,
    PrivateNote: doc.private_note ? doc.private_note.slice(0, 4000) : undefined,
  });
  switch (doc.entity) {
    case "SalesReceipt":
    case "RefundReceipt":
      return {
        ...head,
        ...strip({ CustomerRef: ref(doc.customer_ref), DepositToAccountRef: ref(doc.deposit_account) }),
        Line: doc.lines.map((l) =>
          strip({
            Amount: dollars(l.amount_cents),
            Description: l.description ?? undefined,
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: strip({ ItemRef: ref(l.item_id), ClassRef: ref(l.class_id), Qty: 1, UnitPrice: dollars(l.amount_cents) }),
          }),
        ),
      };
    case "Deposit":
      return {
        ...head,
        DepositToAccountRef: ref(doc.deposit_account),
        Line: doc.lines.map((l) =>
          strip({
            Amount: dollars(l.amount_cents),
            Description: l.description ?? undefined,
            DetailType: "DepositLineDetail",
            DepositLineDetail: strip({
              AccountRef: ref(l.account_id),
              ClassRef: ref(l.class_id),
              Entity: doc.customer_ref ? { value: doc.customer_ref, type: "Customer" } : undefined,
            }),
          }),
        ),
      };
    case "JournalEntry":
      return {
        ...head,
        Line: doc.lines.map((l) =>
          strip({
            Amount: dollars(l.amount_cents),
            Description: l.description ?? undefined,
            DetailType: "JournalEntryLineDetail",
            JournalEntryLineDetail: strip({ PostingType: l.posting, AccountRef: ref(l.account_id), ClassRef: ref(l.class_id) }),
          }),
        ),
      };
  }
}

/** The account, item and class ids a document refers to (the read-only test post reads them back). */
export function references(doc: QboDoc): { accounts: string[]; items: string[]; classes: string[] } {
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  return {
    accounts: uniq([doc.deposit_account, ...doc.lines.map((l) => (doc.entity === "Deposit" || doc.entity === "JournalEntry" ? l.account_id : null))]),
    items: uniq(doc.lines.map((l) => l.item_id)),
    classes: uniq(doc.lines.map((l) => l.class_id)),
  };
}
