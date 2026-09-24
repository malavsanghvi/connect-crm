import Link from "next/link";

import { EmptyState, TableWrap, shortId } from "@/components/ui";
import type { Json, Tables } from "@/lib/database.types";
import { formatDateTime } from "@/lib/dates";

export type AuditRow = Pick<
  Tables<"audit_log">,
  "id" | "occurred_at" | "actor_user_id" | "action" | "record_table" | "record_id" | "before" | "after" | "reason" | "hash"
>;

const IGNORED = new Set(["updated_at", "created_at"]);

/** Fields that differ between the before and after images. */
export function changedFields(before: Json | null, after: Json | null): string[] {
  const b = before && typeof before === "object" && !Array.isArray(before) ? before : {};
  const a = after && typeof after === "object" && !Array.isArray(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys]
    .filter((k) => !IGNORED.has(k) && JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null))
    .sort();
}

function recordHref(table: string | null, id: string | null): string | null {
  if (!table || !id) return null;
  if (table === "households") return `/households/${id}`;
  if (table === "people") return `/people/${id}`;
  return null;
}

export function AuditTable({
  rows,
  timeZone,
  actors,
}: {
  rows: AuditRow[];
  timeZone: string;
  actors: Map<string, { name: string }>;
}) {
  if (rows.length === 0) return <EmptyState title="No audit entries" />;
  return (
    <TableWrap>
      <table className="crm-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Record</th>
            <th>What changed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = recordHref(r.record_table, r.record_id);
            const changed = r.action.endsWith(".update") ? changedFields(r.before, r.after) : [];
            const actor = r.actor_user_id ? actors.get(r.actor_user_id)?.name : null;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDateTime(r.occurred_at, timeZone)}</td>
                <td>{actor ?? (r.actor_user_id ? <span className="font-mono text-xs">{shortId(r.actor_user_id)}</span> : "System")}</td>
                <td className="font-mono text-[0.8125rem]">{r.action}</td>
                <td>
                  <span className="text-muted">{r.record_table ?? "—"}</span>{" "}
                  {href ? (
                    <Link href={href} className="crm-link font-mono text-xs">
                      {shortId(r.record_id)}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{r.record_id ? shortId(r.record_id) : ""}</span>
                  )}
                </td>
                <td className="min-w-[16rem]">
                  {r.action.endsWith(".insert")
                    ? "Created"
                    : r.action.endsWith(".delete")
                      ? "Deleted"
                      : changed.length > 0
                        ? changed.join(", ")
                        : r.action.includes(".")
                          ? "—"
                          : ""}
                  {r.reason ? <div className="text-xs text-muted">Reason: {r.reason}</div> : null}
                  {r.before || r.after ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-semibold text-navy">Show before / after</summary>
                      <div className="mt-1 grid gap-2 lg:grid-cols-2">
                        <pre className="max-h-64 overflow-auto rounded bg-subtle p-2 text-[0.6875rem] leading-snug">
                          {r.before ? JSON.stringify(r.before, null, 2) : "—"}
                        </pre>
                        <pre className="max-h-64 overflow-auto rounded bg-subtle p-2 text-[0.6875rem] leading-snug">
                          {r.after ? JSON.stringify(r.after, null, 2) : "—"}
                        </pre>
                      </div>
                      <p className="mt-1 font-mono text-[0.6875rem] text-muted">hash {r.hash?.slice(0, 16) ?? "—"}…</p>
                    </details>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
