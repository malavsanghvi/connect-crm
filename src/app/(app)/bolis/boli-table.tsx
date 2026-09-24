import Link from "next/link";

import { ClickableRow } from "@/components/clickable-row";
import { buttonClass, EmptyState, StatusText, TableWrap } from "@/components/ui";
import { BOLI_STATUS_LABEL, boliRef, boliStatusTone } from "@/lib/bolis";
import { formatCutoff } from "@/lib/local-time";
import { formatCents } from "@/lib/money";

import type { BoliList } from "./list-data";

/** The prototype's boli table: ID · BOLI · EVENT · FLOOR · TOP · ENTRIES · CUTOFF · STATUS · [Entries]. */
export function BoliTable({
  list,
  basePath,
  selectedId,
  timeZone,
  currency,
  cutoffLabel = "Cutoff",
  emptyTitle,
}: {
  list: BoliList;
  basePath: string;
  selectedId: string | undefined;
  timeZone: string;
  currency: string;
  cutoffLabel?: string;
  emptyTitle: string;
}) {
  const eventName = new Map(list.events.map((e) => [e.id, e.name]));
  if (list.bolis.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <TableWrap>
      <table className="crm-table min-w-[820px]">
        <thead>
          <tr>
            <th>ID</th>
            <th>Boli</th>
            <th>Event</th>
            <th className="num">Floor</th>
            <th className="num">Top</th>
            <th className="num">Entries</th>
            <th>{cutoffLabel}</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.bolis.map((b) => {
            const t = list.totals?.get(b.id);
            const href = `${basePath}?boli=${b.id}`;
            const tone = boliStatusTone(b.status);
            const label = BOLI_STATUS_LABEL[b.status] ?? b.status;
            return (
              <ClickableRow key={b.id} href={href} highlight={b.id === selectedId}>
                <td className="whitespace-nowrap font-mono text-xs text-muted">{boliRef(b.id)}</td>
                <td className="font-bold">
                  {b.name}
                  {b.hall_display && b.status === "open" ? <span className="ml-1.5 text-[11px] font-bold text-saffron">ON TV</span> : null}
                </td>
                <td>{b.event_id ? (eventName.get(b.event_id) ?? "Event") : "—"}</td>
                <td className="num">{formatCents(b.floor_cents, currency)}</td>
                <td className="num">{list.totals === null ? "—" : t?.top ? formatCents(t.top, currency) : "—"}</td>
                <td className="num">{list.totals === null ? "—" : (t?.count ?? 0)}</td>
                <td className="whitespace-nowrap">
                  {formatCutoff(b.extended_until ?? b.closes_at, timeZone)}
                  {b.extended_until ? <div className="text-xs text-muted">extended</div> : null}
                </td>
                <td>{tone === "muted" ? <span className="font-bold text-muted">{label}</span> : <StatusText tone={tone}>{label}</StatusText>}</td>
                <td>
                  <Link href={href} scroll={false} className={buttonClass("ghost", "xs")}>
                    Entries
                  </Link>
                </td>
              </ClickableRow>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
