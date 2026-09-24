import Link from "next/link";

import { StatusText, TableWrap } from "@/components/ui";
import type { ReadinessRow } from "@/lib/setup";

/**
 * The go-live checks with pass / fail / not built yet, the evidence, and where to fix it
 * (shared with Platform › Centers and Go-live approvals). `links` off for Community
 * Connect screens, whose admins act in the organization's own portal.
 */
export function ReadinessTable({ rows, links = true }: { rows: ReadinessRow[]; links?: boolean }) {
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
              <td className="min-w-[220px]">
                <p className="font-bold">{r.title}</p>
                {links && r.href && r.state !== "pass" ? (
                  <Link href={r.href} className="crm-link text-[12px]">
                    Open the screen
                  </Link>
                ) : null}
              </td>
              <td>
                {r.state === "pass" ? (
                  <StatusText tone="ok">Pass</StatusText>
                ) : r.state === "fail" ? (
                  <StatusText tone="bad">Not yet</StatusText>
                ) : (
                  <span className="whitespace-nowrap font-semibold text-faint">Not built yet</span>
                )}
              </td>
              <td className="min-w-[260px] text-[13px]">
                {r.detail}
                {r.interim ? <p className="mt-1 text-[12px] text-muted" data-testid={`interim-${r.key}`}>{r.interim}</p> : null}
              </td>
              <td className="text-[12px] text-muted">{r.proof}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
