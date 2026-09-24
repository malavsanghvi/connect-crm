import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, TableWrap } from "@/components/ui";
import { loadTerms } from "@/lib/data/pathshala";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatCents, formatDate, formatDateTime, humanize } from "@/lib/pathshala/format";
import { load, viewerOf } from "@/lib/pathshala/server";
import { getSession } from "@/lib/session";

import { DrawerButton } from "../drawer-button";
import { LoadProblemPage, PathshalaHeader, PBadge, PNoAccessPage } from "../ui";
import { TermForm } from "./term-form";

export const metadata: Metadata = { title: "Pathshala terms" };

const statusTone = { draft: "muted", registration: "navy", active: "success", closed: "neutral" } as const;

export default async function TermsPage() {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccessPage area="Pathshala terms" />;
  const supabase = v.db;
  const res = await load(() => loadTerms(supabase, v.center.id));
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const canEdit = pathshalaAreas.manage(v);
  const tz = v.center.time_zone;

  return (
    <>
      <PathshalaHeader
        description="Terms · dates, registration window, fees and no-class days for each Pathshala year"
        actions={
          canEdit ? (
            <DrawerButton label="New term" title="New term" kicker="Pathshala" size="sm">
              <TermForm term={null} tz={tz} cols={1} />
            </DrawerButton>
          ) : null
        }
      />
      <Card title="All terms" padded={false}>
        {res.data.length === 0 ? (
          <EmptyState title="No terms yet">{canEdit ? "Create one with New term." : "The principal hasn't set one up yet."}</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table crm-table-first-bold min-w-[720px]">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Dates</th>
                  <th>Registration</th>
                  <th>Fees</th>
                  <th>No class</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {res.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link className="crm-link font-semibold" href={`/pathshala/terms/${t.id}`}>
                        {t.name}
                      </Link>
                    </td>
                    <td>
                      {formatDate(t.starts_on, tz)} – {formatDate(t.ends_on, tz)}
                    </td>
                    <td>
                      {t.registration_opens_at ? formatDateTime(t.registration_opens_at, tz) : "—"}
                      <br />
                      <span className="text-muted">to {t.registration_closes_at ? formatDateTime(t.registration_closes_at, tz) : "—"}</span>
                    </td>
                    <td>
                      {formatCents(t.fee_per_child_cents, { currency: v.center.currency })} per child
                      {t.sibling_discount_pct > 0 && <div className="text-xs text-muted">{t.sibling_discount_pct}% sibling discount</div>}
                      {t.fee_per_family_cap_cents !== null && <div className="text-xs text-muted">cap {formatCents(t.fee_per_family_cap_cents, { currency: v.center.currency })}</div>}
                    </td>
                    <td>{t.no_class_dates.length}</td>
                    <td>
                      <PBadge tone={statusTone[t.status as keyof typeof statusTone] ?? "neutral"}>{humanize(t.status)}</PBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
