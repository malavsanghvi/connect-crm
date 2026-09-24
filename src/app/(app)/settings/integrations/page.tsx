import type { Metadata } from "next";
import Link from "next/link";

import { Card, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { integrationRows } from "@/lib/integrations";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Integrations · Settings" };

export default async function IntegrationsPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Connected services for this center" />;
  if (!canAccess(session, "integrations")) {
    return (
      <>
        {header}
        <NoAccess area="Integrations" access="integrations" />
      </>
    );
  }
  const { db, center } = session;
  const res = await db
    .from("integration_connections")
    .select("provider, status, display_name, settings, connected_at, token_expires_at, last_error")
    .eq("center_id", center.id);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the integrations" error={res.error} retryHref="/settings/integrations" />
      </>
    );
  }
  const rows = integrationRows(res.data ?? []);

  return (
    <>
      {header}
      <Card padded={false}>
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Detail</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="font-bold">
                    {r.href ? (
                      <Link href={r.href} className="crm-link">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                  </td>
                  <td>
                    <StatusText tone={r.status.tone}>{r.status.label}</StatusText>
                  </td>
                  <td>{r.detail}</td>
                  <td>{r.owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
