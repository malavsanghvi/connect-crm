import Link from "next/link";

import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { Alert, Badge, BlockGrid, Card, DefinitionList, EmptyState, KpiGrid, Stat, buttonClass } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { loadEventSurveyTab } from "@/lib/data/event-survey";
import { load } from "@/lib/data/events";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { formatDateTime } from "@/lib/events/format";
import { isModuleEnabled } from "@/lib/modules";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { anonymityText, describeEventSurvey, formatPoints, homeOnly, refusalLines, type SurveyNotices } from "@/lib/survey/event-survey";
import { formatPct, responseRate, standardFeedbackQuestions } from "@/lib/survey/feedback";
import { QUESTION_TYPE_LABELS, parseQuestions } from "@/lib/survey/questions";

import { AttachSurveyForm, EditSurveyForm } from "./survey-forms";
import { attachEventSurvey, launchEventSurvey, removeEventSurvey, updateEventSurvey } from "./survey-actions";

const INTRO =
  "Ask attendees how it went. The survey opens in the member app when the event is marked completed: adults with the app on a phone get a push and a reminder on day 1 and day 2 until they answer, everyone invited sees it on Home, and they earn points for answering.";

export async function SurveyTab({ event, session, access }: { event: Tables<"events">; session: CrmSession; access: EventAccess }) {
  const tz = session.center.time_zone;
  const retry = `/events/${event.id}?tab=survey`;
  if (!isModuleEnabled(session, "surveys")) {
    return (
      <Alert tone="info" title="Surveys are switched off for this community">
        An administrator can switch them on in Settings › Modules. Until then a survey cannot be attached to an event.
      </Alert>
    );
  }
  if (!eventAreas.survey(access, event.id)) {
    return (
      <Card>
        <EmptyState title="You don't have access to this event's survey">
          The Survey tab is for event managers, this event&apos;s lead and communications staff. Ask your center admin if you need it.
        </EmptyState>
      </Card>
    );
  }
  const canManage = eventAreas.edit(access, event.id);
  const res = await load(() => loadEventSurveyTab(session.db, session.center.id, event.id));
  if (!res.ok) return <LoadProblem message={res.error} retryHref={retry} />;
  const { survey, templates, stats, notices } = res.data;
  const eventCompleted = event.status === "completed";

  if (!survey) {
    return (
      <BlockGrid>
        <Card span={12} title="Survey for this event" description={INTRO}>
          {canManage ? (
            <AttachSurveyForm
              action={attachEventSurvey.bind(null, event.id)}
              eventName={event.name}
              eventCompleted={eventCompleted}
              templates={templates}
              starterQuestions={standardFeedbackQuestions()}
            />
          ) : (
            <EmptyState title="No survey is attached to this event yet">Only event managers and this event&apos;s lead can attach one.</EmptyState>
          )}
        </Card>
      </BlockGrid>
    );
  }

  const state = describeEventSurvey(survey, event.status);
  const questions = parseQuestions(survey.questions);
  const canCommsSend = can(access, "comms.send");
  const windowText = survey.opens_at
    ? `Opens ${formatDateTime(survey.opens_at, tz)}${survey.closes_at ? ` · closes ${formatDateTime(survey.closes_at, tz)}` : ""}`
    : "Not set yet. It gets a two-week window when it is sent.";
  const rate = stats ? responseRate(stats.answered, stats.invited) : null;

  return (
    <BlockGrid>
      <Card
        span={12}
        title={survey.title}
        description={state.detail}
        actions={
          <>
            <Link href={`/events/feedback/${survey.id}`} className={buttonClass("ghost", "md")}>
              View results
            </Link>
            {canManage && state.canLaunch ? (
              <ActionButton
                action={launchEventSurvey.bind(null, event.id, survey.id)}
                label="Launch now"
                pendingLabel="Sending…"
                variant="primary"
                size="md"
                confirm="Send the survey now? It opens in the member app: adults with the app on a phone get a push now (or when quiet hours end) and a reminder on day 1 and day 2 until they answer, and everyone invited sees it on Home."
              />
            ) : null}
          </>
        }
      >
        <DefinitionList
          items={[
            { label: "Status", value: <Badge tone={state.tone}>{state.label}</Badge> },
            { label: "Window", value: windowText },
            { label: "Points for answering", value: formatPoints(survey.reward_points) },
            { label: "Anonymous answers", value: anonymityText(survey.anonymous) },
            { label: "Sends automatically", value: survey.auto_on_complete ? "Yes, when the event is completed" : "No, you send it" },
            { label: "Questions", value: String(questions.length) },
          ]}
        />
      </Card>

      {stats ? (
        <Card span={12} title="Audience and answers" description="Invited = adults of households with an active RSVP, or who attended.">
          <KpiGrid cols={4}>
            <Stat label="Invited" value={stats.invited} hint="adults" tone="navy" />
            <Stat
              label="Answered"
              value={stats.answered}
              hint={`${stats.completions} ${stats.completions === 1 ? "completion" : "completions"}, anonymous ones included`}
              tone="purple"
            />
            <Stat label="Response rate" value={formatPct(rate)} hint={rate === null ? "nobody invited yet" : `of ${stats.invited} invited`} tone="success" />
            <Stat
              label="Points awarded"
              value={stats.pointsAwarded}
              hint={survey.reward_points > 0 ? `${formatPoints(survey.reward_points)} each` : "this survey gives no points"}
              tone="brown"
            />
          </KpiGrid>
        </Card>
      ) : null}

      {notices ? <PushesCard notices={notices} tz={tz} retry={canManage && survey.status === "open" && notices.problemCode === "template" && notices.pushed === 0 ? launchEventSurvey.bind(null, event.id, survey.id) : null} /> : null}

      {canManage && state.canEdit ? (
        <Card span={12} title="Edit survey" description="Questions, points and sending can be changed until the survey goes out.">
          <EditSurveyForm
            action={updateEventSurvey.bind(null, event.id, survey.id)}
            eventCompleted={eventCompleted}
            initial={{ title: survey.title, questions, points: survey.reward_points, anonymous: survey.anonymous, auto: survey.auto_on_complete }}
          />
          {state.canRemove ? (
            <div className="mt-4 border-t border-line-soft pt-3">
              <p className="mb-2 text-[13px] text-muted">Not needed? Take it off this event. This only works while it has not been sent and has no answers.</p>
              <ActionButton
                action={removeEventSurvey.bind(null, event.id, survey.id)}
                label="Remove survey"
                pendingLabel="Removing…"
                variant="bad"
                size="md"
                confirm="Remove this survey from the event? It has not been sent and has no answers. You can attach a survey again afterwards."
              />
            </div>
          ) : null}
        </Card>
      ) : (
        <Card
          span={12}
          title="Questions"
          description={
            state.launched
              ? canCommsSend
                ? "The survey has been sent, so its questions and points are locked here. Reword questions or close it from the results page."
                : "The survey has been sent, so its questions and points are locked."
              : undefined
          }
        >
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px]">
            {questions.map((q) => (
              <li key={q.id}>
                <span className="font-bold">{q.label}</span> <span className="text-muted">· {QUESTION_TYPE_LABELS[q.type]}{q.required ? " · required" : ""}</span>
                {q.options.length ? <span className="text-muted"> · {q.options.join(", ")}</span> : null}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </BlockGrid>
  );
}

/** The survey's pushes (0596): who gets one, how many went, what was refused and why, or what stopped them. */
function PushesCard({ notices, tz, retry }: { notices: SurveyNotices; tz: string; retry: Parameters<typeof ActionButton>[0]["action"] | null }) {
  const c = notices.planned;
  const when = notices.sendAt ? formatDateTime(notices.sendAt, tz) : null;
  const progress = notices.finishedAt
    ? `${notices.pushed} queued · finished`
    : notices.startedAt
      ? `${notices.pushed} queued so far · the background service is working through the list`
      : when
        ? `Starts ${when}`
        : "Waiting for the background service";
  return (
    <Card
      span={12}
      title="Pushes"
      description="Adults with the member app on a phone get a push and a reminder on day 1 and day 2 after it, until they answer or the survey closes. Everyone else invited with a login sees it on Home."
      actions={
        retry ? (
          <ActionButton
            action={retry}
            label="Send the pushes"
            pendingLabel="Sending…"
            variant="primary"
            size="md"
            confirm="Send the pushes that did not go? The template problem must be fixed first; the database checks it again."
          />
        ) : null
      }
    >
      {notices.problem ? (
        <div className="mb-3">
          <Alert tone={notices.problemCode === "template" ? "danger" : "warning"} title="No push went out">
            {notices.problem}
          </Alert>
        </div>
      ) : null}
      {c ? (
        <KpiGrid cols={4}>
          <Stat label="Will get a push" value={c.willPush} hint={progress} tone="success" />
          <Stat
            label="See it on Home only"
            value={homeOnly(c)}
            hint={[
              c.noPhone ? `${c.noPhone} no phone with the app` : null,
              c.pushesOff ? `${c.pushesOff} switched event pushes off` : null,
              c.notTestRecipient ? `${c.notTestRecipient} not verified test recipients (sandbox)` : null,
              c.switchedOff ? `${c.switchedOff} with event feedback switched off` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "everyone with a login gets a push"}
            tone="navy"
          />
          <Stat label="No login" value={c.noLogin} hint="they do not use the member app" tone="brown" />
          <Stat label="Already answered" value={c.answered} hint="not pushed" tone="purple" />
        </KpiGrid>
      ) : (
        <p className="text-[13px] text-muted">{when ? `The counts are taken when the pushes start (${when}).` : "The counts are taken when the pushes start."}</p>
      )}
      {Object.keys(notices.refused).length ? (
        <ul className="mt-3 list-disc pl-5 text-[13px]">
          {refusalLines(notices.refused).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
