import Link from "next/link";

import { changedFields, recordHref, type AuditRow } from "@/components/audit-table";
import { EmptyState, TableWrap, shortId } from "@/components/ui";
import { auditModule, describeAuditAction, moduleLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/dates";

/**
 * Settings › Audit log table, as in the prototype: TIME · WHO · ROLE ·
 * ACTION (a plain sentence) · MODULE. The raw action code, the record and
 * the before/after images stay one click away under each sentence.
 */
export function AuditLogTable({
  rows,
  timeZone,
  actors,
  roles,
}: {
  rows: AuditRow[];
  timeZone: string;
  actors: Map<string, { name: string }>;
  /** Actor user id → role line; null when the viewer cannot read other people's grants. */
  roles: Map<string, string> | null;
}) {
  if (rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <TableWrap>
      <table className="crm-table">
        <thead>
          <tr>
            <th className="w-[130px]">Time</th>
            <th>Who</th>
            <th>Role</th>
            <th>Action</th>
            <th className="w-[100px]">Module</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = recordHref(r.record_table, r.record_id);
            const changed = r.action.endsWith(".update") ? changedFields(r.before, r.after) : [];
            const actor = r.actor_user_id ? actors.get(r.actor_user_id)?.name : null;
            const role = r.actor_user_id ? roles?.get(r.actor_user_id) : "System";
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDateTime(r.occurred_at, timeZone)}</td>
                <td className="font-bold">{actor ?? (r.actor_user_id ? <span className="font-mono text-xs font-normal">{shortId(r.actor_user_id)}</span> : "System")}</td>
                <td>{role ?? "—"}</td>
                <td className="min-w-[18rem]">
                  {describeAuditAction(r.action, r.record_table)}
                  {changed.length > 0 ? <span className="text-muted"> · {changed.join(", ")}</span> : null}
                  {r.reason ? <div className="text-xs text-muted">Reason: {r.reason}</div> : null}
                  <details className="mt-0.5">
                    <summary className="cursor-pointer text-xs font-semibold text-navy">Details</summary>
                    <p className="mt-1 font-mono text-[11px] text-muted">
                      {r.action}
                      {r.record_table ? ` · ${r.record_table} ` : " "}
                      {href ? (
                        <Link href={href} className="crm-link">
                          {shortId(r.record_id)}
                        </Link>
                      ) : r.record_id ? (
                        shortId(r.record_id)
                      ) : null}
                    </p>
                    {r.before || r.after ? (
                      <div className="mt-1 grid gap-2 lg:grid-cols-2">
                        <pre className="max-h-64 overflow-auto rounded bg-subtle p-2 text-[0.6875rem] leading-snug">{r.before ? JSON.stringify(r.before, null, 2) : "—"}</pre>
                        <pre className="max-h-64 overflow-auto rounded bg-subtle p-2 text-[0.6875rem] leading-snug">{r.after ? JSON.stringify(r.after, null, 2) : "—"}</pre>
                      </div>
                    ) : null}
                    <p className="mt-1 font-mono text-[0.6875rem] text-muted">hash {r.hash?.slice(0, 16) ?? "—"}…</p>
                  </details>
                </td>
                <td>{moduleLabel(auditModule(r.record_table))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
