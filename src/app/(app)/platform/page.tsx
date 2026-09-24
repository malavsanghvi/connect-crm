import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { centerStatusLabel, traditionLabel } from "@/lib/center-wizard";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "./platform-no-access";
import { SetupReminder } from "./setup-reminder";

export const metadata: Metadata = { title: "Platform" };

export default async function PlatformCentersPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Platform"
      description="Super-admin console · support access is time-limited, needs center consent and is audited"
      actions={
        session.isPlatformAdmin ? (
          <Link href="/platform/new" className={buttonClass("primary")}>
            New center
          </Link>
        ) : null
      }
    />
  );
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const res = await db.from("centers").select("id, slug, name, status, tradition, rules, created_at, environment").order("created_at", { ascending: true });
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the centers" error={res.error} retryHref="/platform" />
      </>
    );
  }
  const centers = res.data ?? [];
  const sizes = await Promise.all(
    centers.map(async (c) => {
      const r = await db.from("households").select("id", { count: "exact", head: true }).eq("center_id", c.id);
      if (r.error) {
        console.error(`[platform] could not count households for center ${c.slug}:`, r.error);
        return "Could not count";
      }
      const n = r.count ?? 0;
      return n === 0 ? "No households yet" : `${n.toLocaleString()} household${n === 1 ? "" : "s"}`;
    }),
  );

  return (
    <>
      {header}
      <SetupReminder session={session} />
      <Card padded={false}>
        {centers.length === 0 ? (
          <EmptyState title="No centers yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Center</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Tradition pack</th>
                  <th>
                    <span className="sr-only">Limits</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {centers.map((c, i) => {
                  const status = centerStatusLabel(c.status, c.rules);
                  // The prototype's Centers list shows a sandbox's status as "Sandbox".
                  const sandbox = c.environment === "sandbox";
                  return (
                    <tr key={c.id}>
                      <td className="font-bold">
                        {c.status === "onboarding" ? (
                          <Link href={`/platform/new?center=${c.id}`} className="crm-link">
                            {c.name}
                          </Link>
                        ) : (
                          c.name
                        )}
                        {c.id === session.center.id ? <span className="ml-2 text-[12px] font-semibold text-muted">· this portal</span> : null}
                      </td>
                      <td className="font-mono text-[12px]">{String(c.slug)}</td>
                      <td>
                        {sandbox ? (
                          <StatusText tone="warn">{status.live ? "Sandbox" : `Sandbox · ${status.label}`}</StatusText>
                        ) : (
                          <StatusText tone={status.live ? "ok" : "warn"}>{status.label}</StatusText>
                        )}
                      </td>
                      <td>{sizes[i]}</td>
                      <td>{traditionLabel(c.tradition)}</td>
                      <td>
                        <Link href={`/platform/centers/${c.id}`} className="crm-link text-[13px] font-semibold">
                          Limits &amp; addresses
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
