import { AssignmentsCard } from "@/components/home/assignments-card";
import { MemberAppCard } from "@/components/home/member-app-card";
import { MyTasksCard } from "@/components/home/my-tasks-card";
import { StartHereCard } from "@/components/home/start-here-card";
import { Alert, BlockGrid, PageHeader } from "@/components/ui";
import { NO_HOME_CARDS, showsTasksCard, type HomeCards } from "@/lib/home/cards";
import type { BriefingItem } from "@/lib/routines/briefing";
import type { ResolvedRoutine } from "@/lib/routines/resolve";
import type { HomeTask, TaskFailure } from "@/lib/tasks";

import { AskBox } from "./ask-box";
import { BriefingCard } from "./briefing-card";
import { RoutineCard } from "./routine-card";

export type TodayViewProps = {
  greeting: string;
  firstName?: string;
  /** "Saturday, October 10" */
  dateLabel: string;
  routine: ResolvedRoutine;
  briefing: BriefingItem[];
  /** Set when the routine or the briefing could not be built: said out loud, with the tasks still shown. */
  problem?: string;
  tasks: HomeTask[];
  failures: Pick<TaskFailure, "source" | "tag" | "message">[];
  hasSources: boolean;
  /** The cards of a person whose work is not in a staff queue (docs/DEMO_ROLE_WORK.md); none when omitted. */
  cards?: HomeCards;
};

/** Today (the new look's Home): a greeting and the date, one box that takes anything, the routine, the morning briefing and My tasks. */
export function TodayView(props: TodayViewProps) {
  const cards: HomeCards = props.cards ?? NO_HOME_CARDS;
  return (
    <>
      <PageHeader title={props.firstName ? `${props.greeting}, ${props.firstName}` : props.greeting} description={props.dateLabel} tabs={false} />
      <AskBox />
      <BlockGrid>
        {props.problem ? (
          <div className="col-span-12">
            <Alert tone="danger" title="Could not prepare your routine and this morning's numbers">
              {props.problem} Your tasks are below. Reload the page to try again.
            </Alert>
          </div>
        ) : (
          <>
            <RoutineCard routine={props.routine} />
            <BriefingCard items={props.briefing} />
          </>
        )}
        {cards.assignments ? <AssignmentsCard card={cards.assignments} /> : null}
        {cards.memberWork ? <MemberAppCard work={cards.memberWork} /> : null}
        {cards.startHere ? <StartHereCard start={cards.startHere} /> : null}
        {showsTasksCard(props.hasSources, cards) ? <MyTasksCard tasks={props.tasks} failures={props.failures} hasSources={props.hasSources} span={12} /> : null}
      </BlockGrid>
    </>
  );
}
