import type { TablesInsert } from "@/lib/database.types";

// Some columns are NOT NULL in the schema but always filled by a BEFORE INSERT
// trigger, so callers must NOT send them — yet the generated types mark them
// required. These helpers drop the column from the type in one audited place
// instead of casting at every call site.
//   external_ids.normalized        ← app.external_ids_normalize()
//   bank_transactions.fingerprint   ← app.bank_transactions_prepare()

export function externalIdInsert(row: Omit<TablesInsert<"external_ids">, "normalized">): TablesInsert<"external_ids"> {
  return row as TablesInsert<"external_ids">;
}

export function bankTransactionInsert(
  row: Omit<TablesInsert<"bank_transactions">, "fingerprint">,
): TablesInsert<"bank_transactions"> {
  return row as TablesInsert<"bank_transactions">;
}
