import { EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { messageStatus } from "@/lib/messaging/labels";

// What an automatic or scheduled email did lately (0770, 0771): when, to which adult's address, the household's number, and
// whether it was queued, sent, or not sent and why.

export type LogRow = {
  at: string;
  to: string | null;
  outcome: "queued" | "skipped";
  reason: string | null;
  household_number: string | null;
  status: string | null;
  failure: string | null;
};

export function EmailLog({ rows, error, timeZone }: { rows: LogRow[]; error: unknown; timeZone: string }) {
  if (error) return <QueryError what="what this email sent" error={error} retryHref="/settings/automatic-emails" />;
  if (rows.length === 0) return <EmptyState title="Nothing sent yet" />;
  return (
    <TableWrap>
      <table className="crm-table">
        <thead>
          <tr>
            <th>When</th>
            <th>To</th>
            <th>Household</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = r.outcome === "skipped" ? { label: "Not sent", tone: "warn" as const } : messageStatus(r.status ?? "queued");
            return (
              <tr key={`${r.at}-${i}`}>
                <td className="whitespace-nowrap">{formatDateTime(r.at, timeZone)}</td>
                <td className="font-mono text-[12px]">{r.to ?? "—"}</td>
                <td>{r.household_number ?? "—"}</td>
                <td>
                  <StatusText tone={s.tone}>{s.label}</StatusText>
                  {r.reason || r.failure ? <span className="block text-[12px] text-muted">{r.reason ?? r.failure}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
