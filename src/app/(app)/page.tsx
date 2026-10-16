import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AssignmentsCard } from "@/components/home/assignments-card";
import { HomeNotices } from "@/components/home/notices";
import { MemberAppCard } from "@/components/home/member-app-card";
import { MyTasksCard } from "@/components/home/my-tasks-card";
import { StartHereCard } from "@/components/home/start-here-card";
import { TourInvite } from "@/components/spotlight/tour-invite";
import { BlockGrid, Card, KpiGrid, PageHeader, Stat, capitalize } from "@/components/ui";
import { loadHomeCards } from "@/lib/data/home-cards";
import { loadHomeKpis } from "@/lib/data/home-kpis";
import { loadHomeNotices } from "@/lib/data/home-notices";
import { loadHomeTasks } from "@/lib/data/home-tasks";
import { showsTasksCard } from "@/lib/home/cards";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { SETUP_LATER_COOKIE } from "@/lib/platform-setup/catalog";
import { isSetupComplete } from "@/lib/platform-setup/view";
import { getSession } from "@/lib/session";
import { greetingFor, hourInTz, visibleTaskSources } from "@/lib/tasks";

import { TodayHome } from "./today-home";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const session = await getSession();
  const jar = await cookies();
  // o-platform-setup: a platform admin lands on the platform setup wizard until it is complete
  // (required steps done, optional ones done or parked), unless they chose "Continue to the portal".
  if (session.isPlatformAdmin && !jar.get(SETUP_LATER_COOKIE) && (await isSetupComplete(session)) === false) {
    redirect("/platform/setup");
  }
  // The "New look" switch (a per-person cookie): Today, with a routine, a morning briefing and one box for Niva. The classic Home below is unchanged.
  if (parseLook(jar.get(LOOK_COOKIE)?.value) === "v2") return <TodayHome session={session} />;

  const { center } = session;
  const [{ tasks, failures }, kpis, cards, notices] = await Promise.all([loadHomeTasks(session), loadHomeKpis(session), loadHomeCards(session), loadHomeNotices(session)]);
  const hasSources = visibleTaskSources(session).length > 0;
  // A person with no staff queue whose work is on a card (their assignments, or the member app) is not told there is nothing for their role.
  const showTasks = showsTasksCard(hasSources, cards);
  // "At a glance" with nothing in it ("Not in your role") is left out under a person's cards.
  const showGlance = showTasks || kpis.length > 0;
  const first = session.person?.name.split(" ")[0];
  const greeting = greetingFor(hourInTz(center.time_zone));

  return (
    <>
      <PageHeader title={first ? `${greeting}, ${first}` : greeting} description={showTasks ? "My tasks across every module you can act on" : "What is waiting for you"} />
      {/* An invitation to a guided tour, only for a person who has one they have not started (src/lib/spotlight). */}
      <TourInvite />
      <BlockGrid>
        <HomeNotices notices={notices} />
        {cards.assignments ? <AssignmentsCard card={cards.assignments} /> : null}
        {cards.memberWork ? <MemberAppCard work={cards.memberWork} /> : null}
        {cards.startHere ? <StartHereCard start={cards.startHere} /> : null}
        {showTasks ? <MyTasksCard tasks={tasks} failures={failures} hasSources={hasSources} /> : null}
        {showGlance ? (
          <Card span={4} title="At a glance">
            <KpiGrid cols={1}>
              {kpis.length === 0 ? (
                <Stat label="Reports" value={<span className="text-faint">—</span>} hint="Not in your role" tone="ink" />
              ) : (
                kpis.map((k) =>
                  k.state === "ok" ? (
                    <Stat key={k.label} label={k.label} value={k.value} hint={k.sub} tone={k.tone} href={k.href} />
                  ) : (
                    <Stat
                      key={k.label}
                      label={k.label}
                      tone="danger"
                      value={<span className="text-lg">Could not load</span>}
                      hint={<span className="text-danger">{capitalize(k.message)}. Reload to try again.</span>}
                    />
                  ),
                )
              )}
            </KpiGrid>
          </Card>
        ) : null}
      </BlockGrid>
    </>
  );
}
