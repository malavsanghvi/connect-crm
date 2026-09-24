import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, QueryError, Stat, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { loadDirectory } from "@/lib/data/directory";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ClickableRow } from "../_components/client";
import { PeopleDrawers, drawerHref } from "../_components/drawers";

export const metadata: Metadata = { title: "People · Directory & expertise" };

const SUB = "Opt-in directory and expertise listings from member profiles · visible only to verified members";

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!canAccess(session, "households")) {
    return (
      <>
        <PageHeader title="People" description={SUB} />
        <NoAccess area="The member directory" access="households" />
      </>
    );
  }
  const sp = await searchParams;
  const base = "/people/directory";
  const d = await loadDirectory(session);
  const openId = param(sp, "person");
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

  return (
    <>
      <PageHeader title="People" description={SUB} />
      {d.error ? (
        <div className="mb-4">
          <QueryError what="the directory" error={d.error} retryHref={base} />
        </div>
      ) : null}
      <BlockGrid>
        <Card span={12}>
          <KpiGrid cols={4}>
            <Stat label="Families in directory" value={fmt(d.families)} hint="opted in at onboarding or profile" tone="navy" />
            <Stat label="Open to new members" value={fmt(d.openToNew)} hint="can be contacted by members who joined in the last 12 months" tone="success" />
            <Stat label="Expertise listings" value={fmt(d.listingsTotal)} hint="live as soon as a verified member opts in" tone="brown" />
            <Stat label="New-member contacts this month" value="—" hint="not recorded yet" tone="purple" />
          </KpiGrid>
        </Card>
        <Card span={12} title="Expertise listings" description="There is no review step for listings yet: a verified member's listing shows as soon as they opt in" padded={false}>
          {d.listings.length === 0 ? (
            <EmptyState title="Nothing here right now" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Areas</th>
                    <th>Headline</th>
                    <th>Visible to</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {d.listings.map((l) => {
                    const open = drawerHref(base, sp, { person: l.personId });
                    return (
                      <ClickableRow key={l.personId} href={open} selected={openId === l.personId}>
                        <td>
                          <span className="font-bold">{l.name}</span>
                          {l.household ? <div className="text-xs text-muted">{l.household}</div> : null}
                        </td>
                        <td>{l.areas.length ? l.areas.join("; ") : <span className="text-faint">—</span>}</td>
                        <td className="max-w-[28rem]">{l.headline ?? <span className="text-faint">No headline</span>}</td>
                        <td>
                          {l.verified ? (
                            l.openToNewMembers ? (
                              "All verified members · open to new members"
                            ) : (
                              "All verified members"
                            )
                          ) : (
                            <StatusText tone="warn">Hidden until verified</StatusText>
                          )}
                        </td>
                        <td className="row-actions">
                          <Link href={open} scroll={false} className={buttonClass("ghost", "xs")}>
                            Open
                          </Link>
                        </td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {d.listingsTotal !== null && d.listingsTotal > d.listings.length ? (
            <p className="px-2.5 pt-2 text-xs text-muted">Showing the first {d.listings.length} of {d.listingsTotal.toLocaleString("en-US")}</p>
          ) : null}
        </Card>
        <Card span={12} title="Rules">
          <p className="text-[13px] text-ink-2">
            Contact details stay hidden until the member replies. Guidance is shared in a personal capacity and is not endorsed by the center. Members
            pause or remove their listing from their profile; staff can turn a listing off from the person&apos;s profile.
          </p>
        </Card>
      </BlockGrid>
      <PeopleDrawers session={session} sp={sp} base={base} />
    </>
  );
}
