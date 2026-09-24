import { AuditTable, type AuditRow } from "@/components/audit-table";
import { Card, NoAccess, QueryError } from "@/components/ui";
import { chunk } from "@/lib/data/fetch-all";
import { userNames } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

const LIMIT = 150;

/** Audit trail for the household record and the records hanging off it. */
export async function AuditTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  if (!canAccess(session, "audit")) return <NoAccess area="The audit log" access="audit" />;
  const { db, center } = session;
  const retry = `/households/${householdId}?tab=audit`;

  // Ids of related records (only those this user can see; the audit rows are filtered the same way).
  const [members, extIds, memberships, pledges, payments, applications] = await Promise.all([
    db.from("household_members").select("person_id").eq("household_id", householdId),
    db.from("external_ids").select("id").eq("household_id", householdId).limit(500),
    db.from("memberships").select("id").eq("household_id", householdId).limit(500),
    db.from("pledges").select("id").eq("household_id", householdId).limit(500),
    db.from("payments").select("id").eq("household_id", householdId).limit(500),
    db.from("membership_applications").select("id").eq("household_id", householdId).limit(500),
  ]);
  const related: [string, string[]][] = [
    ["households", [householdId]],
    ["people", (members.data ?? []).map((m) => m.person_id)],
    ["household_members", []],
    ["external_ids", (extIds.data ?? []).map((r) => r.id)],
    ["memberships", (memberships.data ?? []).map((r) => r.id)],
    ["membership_applications", (applications.data ?? []).map((r) => r.id)],
    ["pledges", (pledges.data ?? []).map((r) => r.id)],
    ["payments", (payments.data ?? []).map((r) => r.id)],
  ];

  const rows: AuditRow[] = [];
  let error: DbErrorLike | null = null;
  const queries = related.flatMap(([table, ids]) =>
    chunk(ids).map((part) =>
      db
        .from("audit_log")
        .select("id, occurred_at, actor_user_id, action, record_table, record_id, before, after, reason, hash")
        .eq("center_id", center.id)
        .eq("record_table", table)
        .in("record_id", part)
        .order("occurred_at", { ascending: false })
        .limit(LIMIT),
    ),
  );
  for (const res of await Promise.all(queries)) {
    if (res.error) error ??= res.error;
    rows.push(...(res.data ?? []));
  }
  rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id - a.id);
  const shown = rows.slice(0, LIMIT);
  const actors = await userNames(db, center.id, shown.map((r) => r.actor_user_id));

  return (
    <Card
      padded={false}
      title="Audit trail"
      description={`The household, its members, identifiers, memberships, applications, pledges and payments — newest first${rows.length > LIMIT ? ` (latest ${LIMIT} of ${rows.length})` : ""}. Household membership changes are logged per person.`}
    >
      {error ? (
        <div className="p-4">
          <QueryError what="part of the audit trail" error={error} retryHref={retry} />
        </div>
      ) : null}
      <AuditTable rows={shown} timeZone={center.time_zone} actors={actors} />
    </Card>
  );
}
