import { StatusText, TableWrap } from "@/components/ui";
import type { ReadinessRow } from "@/lib/setup";

/** The 13 go-live checks with pass / fail / not built yet and the evidence (shared with Platform › Centers). */
export function ReadinessTable({ rows }: { rows: ReadinessRow[] }) {
  return (
    <TableWrap>
      <table className="crm-table" aria-label="Go-live readiness checks">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Check</th>
            <th>Result</th>
            <th>Evidence</th>
            <th>How it&apos;s proven</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-check={r.key} data-state={r.state}>
              <td className="num">{r.n}</td>
              <td className="min-w-[220px] font-bold">{r.title}</td>
              <td>
                {r.state === "pass" ? (
                  <StatusText tone="ok">Pass</StatusText>
                ) : r.state === "fail" ? (
                  <StatusText tone="bad">Not yet</StatusText>
                ) : (
                  <span className="whitespace-nowrap font-semibold text-faint">Not built yet</span>
                )}
              </td>
              <td className="min-w-[260px] text-[13px]">{r.detail}</td>
              <td className="text-[12px] text-muted">{r.proof}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
