import { TodayView } from "@/components/today/today-view";
import { communityFormat } from "@/lib/community-format";
import { loadHomeCards } from "@/lib/data/home-cards";
import { loadHomeTasks } from "@/lib/data/home-tasks";
import { loadRoutineFacts } from "@/lib/data/today";
import { buildBriefing, type BriefingItem } from "@/lib/routines/briefing";
import { todayLabel } from "@/lib/routines/clock";
import { resolveRoutine, type ResolvedRoutine } from "@/lib/routines/resolve";
import type { CrmSession } from "@/lib/session";
import { greetingFor, hourInTz, visibleTaskSources } from "@/lib/tasks";

const NO_ROUTINE: ResolvedRoutine = { roles: [], groups: [], later: [], total: 0, done: 0, left: 0 };

/**
 * Today: Home in the new look. My tasks load first (they are cached for the sidebar badge too), then the few counters the routine
 * and the briefing add. If building the routine or the briefing fails, the page still shows the tasks and says what went wrong.
 */
export async function TodayHome({ session }: { session: CrmSession }) {
  const { center } = session;
  const [home, cards] = await Promise.all([loadHomeTasks(session), loadHomeCards(session)]);

  let routine = NO_ROUTINE;
  let briefing: BriefingItem[] = [];
  let problem: string | undefined;
  try {
    const facts = await loadRoutineFacts(session, home);
    routine = resolveRoutine(session, facts);
    briefing = buildBriefing(session, facts);
  } catch (error) {
    console.error("[today] could not build the routine and the briefing:", error);
    problem = "Something went wrong while counting what is due.";
  }

  return (
    <TodayView
      greeting={greetingFor(hourInTz(center.time_zone))}
      firstName={session.person?.name.split(" ")[0]}
      dateLabel={todayLabel(center.time_zone, new Date(), communityFormat(center).locale)}
      routine={routine}
      briefing={briefing}
      problem={problem}
      tasks={home.tasks}
      failures={home.failures}
      hasSources={visibleTaskSources(session).length > 0}
      cards={cards}
    />
  );
}
