"use server";

import { failure, type ActionResult } from "@/lib/errors";
import { REFERENCE_TABLES, normalizeHistoryRows, referencedIds } from "@/lib/history";
import { isMissingObject, modulesDb, warnMissingOnce, type HistoryRow } from "@/lib/modules-db";
import { authorizeAction } from "@/lib/session";

export type RecordHistoryResult =
  | { available: false }
  | { available: true; rows: HistoryRow[]; timeZone: string; currency: string; names: Record<string, string> };

const TABLE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * History of one record, newest first, via app.record_history (audit.view;
 * the database applies the audit_read policy too). Before the s-core
 * migrations land it answers `available: false` — the UI says so plainly.
 */
export async function loadRecordHistoryAction(table: string, recordId: string): Promise<ActionResult<RecordHistoryResult>> {
  const doing = "load the history";
  if (!TABLE.test(String(table ?? "")) || !recordId || String(recordId).length > 200) {
    return { ok: false, error: `Could not ${doing} — the record was not recognised. Reload and try again.` };
  }
  const auth = await authorizeAction("audit", doing);
  if (!auth.ok) return auth;
  const { data, error } = await modulesDb(auth.session.db).rpc("record_history", { p_table: table, p_record: String(recordId) });
  if (error) {
    if (isMissingObject(error)) {
      warnMissingOnce("app.record_history", error);
      return { ok: true, data: { available: false } };
    }
    return failure(`Could not ${doing}`, error);
  }
  const rows = normalizeHistoryRows(data);
  // Show referenced records by name ("West" rather than a zone id). Lookups run
  // under the reader's own RLS, so an id the reader cannot see stays an id.
  const names: Record<string, string> = {};
  const nameCols = new Map(Object.values(REFERENCE_TABLES).map((r) => [r.table, r.name]));
  await Promise.all(
    [...referencedIds(rows)].map(async ([table, ids]) => {
      const cols = nameCols.get(table) ?? "name";
      const res = await auth.session.db
        .from(table as "zones")
        .select(`id, ${cols}`)
        .in("id", [...ids].slice(0, 200));
      if (res.error) {
        console.error(`[history] looking up ${table} names failed; showing ids instead:`, res.error);
        return;
      }
      for (const row of (res.data ?? []) as unknown as Record<string, string | null>[]) {
        const label = cols
          .split(",")
          .map((c) => row[c])
          .filter(Boolean)
          .join(" ");
        if (row.id && label) names[row.id] = label;
      }
    }),
  );
  return {
    ok: true,
    data: { available: true, rows, timeZone: auth.session.center.time_zone, currency: auth.session.center.currency, names },
  };
}
