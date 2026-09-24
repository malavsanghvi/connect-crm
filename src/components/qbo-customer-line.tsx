import Link from "next/link";

import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/**
 * The "QuickBooks" line on a household or person profile (o-qbo-match): the
 * QuickBooks customer(s) approved for it, family- or person-level, and who
 * mapped it when. Shown to people who can see donor matching.
 */
export async function QboCustomerLine({ session, householdIds, personId = null }: { session: CrmSession; householdIds: string[]; personId?: string | null }) {
  if (!canAccess(session, "qboMatch") || !isModuleEnabled(session, "accounting") || householdIds.length === 0) return null;
  const { db, center } = session;
  const res = await db
    .from("qbo_customer_matches")
    .select("qbo_customer_id, household_id, person_id, decided_by, decided_at")
    .eq("center_id", center.id)
    .eq("status", "approved")
    .in("household_id", householdIds);
  if (res.error) {
    console.error("[qbo-line] could not load the QuickBooks matches:", res.error);
    return (
      <p className="mb-4 text-[13px] text-danger">
        QuickBooks: could not load the matched customer — {explainError(res.error)}.
      </p>
    );
  }
  // On a person: their own customer, plus the family-level ones of their households.
  const rows = (res.data ?? []).filter((m) => !personId || m.person_id === null || m.person_id === personId);
  const custs = rows.length
    ? await db.from("qbo_customers").select("qbo_id, display_name").eq("center_id", center.id).in("qbo_id", rows.map((r) => r.qbo_customer_id))
    : { data: [] as { qbo_id: string; display_name: string }[], error: null };
  if (custs.error) console.error("[qbo-line] could not load the QuickBooks customer names; showing ids:", custs.error);
  const names = new Map((custs.data ?? []).map((c) => [c.qbo_id, c.display_name]));
  const who = await userNames(db, center.id, rows.map((r) => r.decided_by));
  return (
    <div className="mb-4 rounded-lg border border-line bg-card px-3 py-2 text-[13px]" data-testid="qbo-line">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">QuickBooks</span>{" "}
      {rows.length === 0 ? (
        <span className="text-muted">
          Not mapped to a QuickBooks customer ·{" "}
          <Link href="/accounting/qbo/matching?tab=not_mapped" className="crm-link">
            Donor matching
          </Link>
        </span>
      ) : (
        rows.map((m, i) => (
          <span key={m.qbo_customer_id}>
            {i > 0 ? " · " : ""}
            <strong>{names.get(m.qbo_customer_id) ?? `Customer #${m.qbo_customer_id}`}</strong> (#{m.qbo_customer_id},{" "}
            {m.person_id ? "person-level" : "family-level, on the primary member"}) · mapped by {who.get(m.decided_by ?? "")?.name ?? "the treasury"}
            {m.decided_at ? ` on ${formatDate(m.decided_at, center.time_zone)}` : ""}
          </span>
        ))
      )}
    </div>
  );
}
