import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, EmptyState, KpiGrid, Stat, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { loadClassesOverview, loadLevels, loadTerms, pickTerm, type Term } from "@/lib/data/pathshala";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { classTimeLabel, todayIso } from "@/lib/pathshala/format";
import { load } from "@/lib/pathshala/server";
import { percent } from "@/lib/pathshala/stats";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ClassForm } from "./classes/class-form";
import { DrawerButton } from "./drawer-button";
import { LoadProblem, PNoAccess, PathshalaHeader, TermSwitcher } from "./ui";

export const metadata: Metadata = { title: "Pathshala" };

/** "Term: Fall 2026 · registration requires membership · fees billed per child as pledges" (prototype), from the term's own rules. */
function termSubtitle(term: Term): string {
  return [
    `Term: ${term.name}`,
    term.membership_required ? "registration requires membership" : "registration open to non-members",
    term.fee_per_child_cents > 0 ? "fees billed per child as pledges" : "no fee this term",
  ].join(" · ");
}

export default async function PathshalaClassesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!pathshalaAreas.admin(session)) {
    // Teachers who only hold a class-scoped role land on their own classes.
    if (pathshalaAreas.teaches(session)) redirect("/pathshala/my-classes");
    return (
      <>
        <PathshalaHeader />
        <PNoAccess area="the Pathshala classes (pathshala.view or pathshala.manage)" />
      </>
    );
  }
  const sp = await searchParams;
  const today = todayIso(session.center.time_zone);
  const canManage = pathshalaAreas.manage(session);

  const res = await load(async () => {
    const [terms, levels] = await Promise.all([loadTerms(session.db, session.center.id), loadLevels(session.db, session.center.id)]);
    const term = pickTerm(terms, param(sp, "term"));
    const overview = term ? await loadClassesOverview(session, term, today) : null;
    return { terms, levels, term, overview };
  });
  if (!res.ok) {
    return (
      <>
        <PathshalaHeader />
        <LoadProblem message={res.error} retryHref="/pathshala" />
      </>
    );
  }
  const { terms, levels, term, overview } = res.data;

  if (!term || !overview) {
    return (
      <>
        <PathshalaHeader description="No Pathshala term yet" />
        <Card>
          <EmptyState title="No Pathshala term yet">
            <Link className="crm-link font-semibold" href="/pathshala/terms">
              Create the first term
            </Link>{" "}
            to set dates, fees and registration.
          </EmptyState>
        </Card>
      </>
    );
  }

  const { stats } = overview;
  const levelOrder = (id: string) => {
    const i = levels.findIndex((l) => l.id === id);
    return i < 0 ? 999 : i;
  };
  const classes = [...overview.classes].sort(
    (a, b) => levelOrder(a.cls.level_id) - levelOrder(b.cls.level_id) || a.cls.name.localeCompare(b.cls.name),
  );

  return (
    <>
      <PathshalaHeader
        description={termSubtitle(term)}
        actions={
          <>
            <Link href="/pathshala/announcements" className={buttonClass("ghost", "sm")}>
              Announcements
            </Link>
            {canManage ? (
              <DrawerButton label="New class" title="New class" kicker="Pathshala" subtitle={`Term ${term.name}`} size="sm">
                <ClassForm cls={null} terms={terms} levels={levels} defaultTermId={term.id} cols={1} />
              </DrawerButton>
            ) : null}
          </>
        }
      />
      <TermSwitcher terms={terms} activeId={term.id} basePath="/pathshala" />

      <Card className="mb-4">
        <KpiGrid cols={4}>
          <Stat label="Students" value={stats.students.toLocaleString()} hint={`${stats.waitlisted.toLocaleString()} on waitlists`} tone="purple" />
          <Stat
            label="Teachers"
            value={stats.teachers.toLocaleString()}
            hint={
              stats.backgroundChecksExpiring === null
                ? "Background checks not visible to your role"
                : `${stats.backgroundChecksExpiring} background check${stats.backgroundChecksExpiring === 1 ? "" : "s"} expiring`
            }
            tone="navy"
          />
          <Stat label="Attendance" value={percent(stats.attendanceRate)} hint="QR check-in at class" tone="success" />
          <Stat
            label="Gyan Path sign-offs"
            value={stats.signoffsWaiting === null ? "—" : stats.signoffsWaiting.toLocaleString()}
            hint={stats.signoffsWaiting === null ? "Could not be counted — reload to try again" : "awaiting teachers"}
            tone="brown"
            href="/pathshala/signoffs"
          />
        </KpiGrid>
      </Card>

      <Card title="Classes" padded={false}>
        {classes.length === 0 ? (
          <EmptyState title="No classes in this term yet">{canManage ? "Add the first one with New class." : ""}</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table crm-table-first-bold min-w-[640px]">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Students</th>
                  <th>Attendance</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((r) => (
                  <tr key={r.cls.id}>
                    <td>
                      <Link href={`/pathshala/classes/${r.cls.id}`} className="text-ink hover:underline">
                        {r.cls.name}
                      </Link>
                    </td>
                    <td>{r.teacherNames.length ? r.teacherNames.join(", ") : <StatusText tone="warn">Needs a teacher</StatusText>}</td>
                    <td>{r.students}</td>
                    <td>{percent(r.attendanceRate)}</td>
                    <td className="whitespace-nowrap">{classTimeLabel(r.cls.meets_on, r.cls.starts_time)}</td>
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
