import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, PageHeader, QueryError, TableWrap } from "@/components/ui";
import { backlogItems, nextDirection, parseBacklogSort, sortBacklog, type BacklogSort } from "@/lib/activity/backlog";
import { countSharingCommunities } from "@/lib/activity/consent";
import { formatDate } from "@/lib/dates";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "Automation backlog · Platform" };
export const dynamic = "force-dynamic";

const HERE = "/platform/automation";

const COLUMNS: { sort: BacklogSort; label: string; numeric: boolean }[] = [
  { sort: "name", label: "What people do", numeric: false },
  { sort: "communities", label: "Communities", numeric: true },
  { sort: "ideas", label: "Ideas", numeric: true },
  { sort: "times", label: "Times", numeric: true },
  { sort: "minutes", label: "Minutes a month", numeric: true },
  { sort: "seen", label: "Last seen", numeric: true },
];

/**
 * Platform › Automation backlog (B91): for each action, in how many communities it is part of an automation idea, in how many
 * ideas, how often and how many minutes a month that adds up to. Only communities whose administrator agreed to recording AND
 * to sharing counts with Weaver are included (owner decision 2026-10-11); the page says how many. Keys and counts only: the
 * database view (app.automation_backlog) holds no community, role, person or event, and gives rows to platform admins alone.
 */
export default async function PlatformAutomationBacklogPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Automation backlog · what is repeated most across the communities that agreed to recording" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }

  const [res, centers] = await Promise.all([
    session.db.from("automation_backlog").select("item_key, label, surface, communities, ideas, times, minutes_per_month, last_seen"),
    session.db.from("centers").select("id, rules"),
  ]);
  if (res.error) {
    console.error("[platform/automation] could not read the automation backlog:", res.error);
    return (
      <>
        {header}
        <QueryError what="the automation backlog" error={res.error} retryHref={HERE} />
      </>
    );
  }

  const current = parseBacklogSort(param(sp, "sort"), param(sp, "dir"));
  const items = sortBacklog(backlogItems(res.data), current.sort, current.dir);
  const tz = session.center.time_zone;
  if (centers.error) console.error("[platform/automation] could not count the communities that share:", centers.error);
  const included = centers.error ? null : countSharingCommunities(centers.data ?? []);

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Privacy" description="What this list is, and what it never shows">
          <p className="text-[13px]">
            This list shows only the names of actions and counts. It never shows which community, which person or what anyone typed. Only communities whose own administrator agreed to
            recording <em>and</em> chose to let Weaver staff see counts are included. An action appears only when at least 3 people in one community repeat it in a pattern, and ideas
            that a community marked not useful are left out.
          </p>
          <p className="mt-2 text-[13px]" data-testid="backlog-included">
            {included === null ? (
              <span className="text-danger">Could not count the communities included. Reload the page to try again.</span>
            ) : (
              <>
                Communities included: <strong>{included}</strong>
                {included === 0 ? " · none has agreed to share yet" : ""}
              </>
            )}
          </p>
        </Card>
        <Card span={12} title="Most repeated work" description="Click a heading to sort" padded={false}>
          {items.length === 0 ? (
            <EmptyState title="Nothing to show yet">
              Ideas appear here after at least one community has agreed to recording and to sharing counts with Weaver, the nightly search for repeated work has run, and at least 3 people in that community did the same steps.
            </EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table" data-testid="automation-backlog">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => {
                      const active = current.sort === c.sort;
                      const dir = nextDirection(current, c.sort);
                      return (
                        <th key={c.sort} className={c.numeric ? "text-right" : undefined} aria-sort={active ? (current.dir === "asc" ? "ascending" : "descending") : "none"}>
                          <Link href={hrefWith(HERE, sp, { sort: c.sort, dir })} className="crm-link">
                            {c.label}
                            {active ? (current.dir === "asc" ? " ↑" : " ↓") : ""}
                          </Link>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={`${i.surface}|${i.key}`}>
                      <td>
                        <span className="font-bold">{i.label}</span>
                        <span className="block font-mono text-[11px] text-muted">
                          {i.key}
                          {i.surface === "member" ? " · member app" : ""}
                        </span>
                      </td>
                      <td className="text-right">{i.communities.toLocaleString("en-US")}</td>
                      <td className="text-right">{i.ideas.toLocaleString("en-US")}</td>
                      <td className="text-right">{i.times.toLocaleString("en-US")}</td>
                      <td className="text-right font-semibold">{Math.round(i.minutesPerMonth).toLocaleString("en-US")}</td>
                      <td className="text-right">{i.lastSeen ? formatDate(i.lastSeen, tz) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
