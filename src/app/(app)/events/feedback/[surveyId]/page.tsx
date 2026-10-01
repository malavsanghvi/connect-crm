import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { BarList } from "@/components/events/bars";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { QuestionsBuilder } from "@/components/survey/questions-builder";
import { StepUpDownload } from "@/components/step-up-download";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, Stat, TableWrap, buttonClass } from "@/components/ui";
import { loadSurveyStats } from "@/lib/data/event-survey";
import { surveyExtras } from "@/lib/data/event-feedback";
import { allRows, load, loadEventAccess, resolvePeopleNames, row } from "@/lib/data/events";
import type { Json } from "@/lib/database.types";
import { eventAreas } from "@/lib/events/access";
import { formatDateTime, formatEventDate, toDateTimeLocal } from "@/lib/events/format";
import { can, canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { formatPoints } from "@/lib/survey/event-survey";
import { feedbackStatus, formatPct, responseRate } from "@/lib/survey/feedback";
import { answerText, parseQuestions } from "@/lib/survey/questions";
import { responsesByDay, shortDay, summarizeQuestions } from "@/lib/survey/results";

import { saveSurvey, setSurveyStatus } from "../actions";
import { QuestionResultCard } from "./question-results";

export const metadata: Metadata = { title: "Feedback survey" };

/** Days shown in "Responses over time" (the export has every day). */
const CHART_DAYS = 30;

export default async function FeedbackSurveyPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  if (!isUuid(surveyId)) notFound();
  const session = await getSession();
  const access = await loadEventAccess(session);
  const tz = session.center.time_zone;
  const commsRead = canAccess(session, "eventFeedbackRead");

  const head = await load(async () => {
    const s = row(await session.db.from("surveys").select("*").eq("id", surveyId).maybeSingle(), "the survey");
    if (!s) return null;
    const event = s.event_id ? row(await session.db.from("events").select("id, name, status").eq("id", s.event_id).maybeSingle(), "the event") : null;
    return { s, event };
  });
  if (!head.ok) {
    return (
      <>
        <PageHeader title="Feedback survey" />
        <LoadProblem message={head.error} retryHref={`/events/feedback/${surveyId}`} />
      </>
    );
  }
  const noAccess = (
    <>
      <PageHeader title="Feedback survey" />
      <NoAccess
        area="Feedback surveys"
        access="eventFeedbackRead"
        extra="Event managers, and the lead of an event, can also open that event's survey."
      />
    </>
  );
  if (!head.data) {
    if (!commsRead) return noAccess;
    notFound();
  }
  const { s, event } = head.data;
  // Communications staff read every survey; an event's manager or lead reads their event's (app.manages_event_surveys).
  const managesEvent = s.event_id ? eventAreas.edit(access, s.event_id) : false;
  if (!commsRead && !managesEvent) return noAccess;

  const body = await load(async () => {
    const responses = await allRows<{ id: string; person_id: string | null; answers: Json; submitted_at: string }>(
      (f, t) => session.db.from("survey_responses").select("id, person_id, answers, submitted_at").eq("survey_id", surveyId).order("submitted_at", { ascending: false }).range(f, t),
      "responses",
    );
    const stats = await loadSurveyStats(session.db, surveyId);
    // Names only for members who chose to sign their answer, and never on an always-anonymous survey.
    const names = s.anonymous ? new Map<string, string>() : await resolvePeopleNames(session.db, responses.map((r) => r.person_id));
    return { responses, stats, names };
  });
  if (!body.ok) {
    return (
      <>
        <PageHeader title={s.title} />
        <LoadProblem message={body.error} retryHref={`/events/feedback/${surveyId}`} />
      </>
    );
  }
  const { responses, stats, names } = body.data;
  const questions = parseQuestions(s.questions);
  const status = feedbackStatus(s);
  const canSend = can(access, "comms.send") && eventAreas.view(access);
  const sendAt = surveyExtras(s).sendAt ?? s.opens_at;
  const results = summarizeQuestions(questions, responses, { alwaysAnonymous: s.anonymous, nameFor: (id) => names.get(id) ?? null });
  const byDay = responsesByDay(responses, tz);
  const chartDays = byDay.slice(-CHART_DAYS);
  const busiest = Math.max(1, ...chartDays.map((d) => d.count));
  const rate = responseRate(stats.answered, stats.invited);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/events/feedback?survey=${s.id}`} className="crm-link">
            ← Event feedback
          </Link>
        }
        title={s.title}
        description={[
          status,
          event ? event.name : null,
          `${responses.length} responses`,
          s.anonymous ? "always anonymous" : "anonymous by choice",
          s.reward_points > 0 ? `${formatPoints(s.reward_points)} for answering` : null,
          sendAt ? `${status === "Scheduled" ? "opens" : "opened"} ${formatDateTime(sendAt, tz)}` : null,
          s.closes_at ? `closes ${formatDateTime(s.closes_at, tz)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <StepUpDownload href={`/events/feedback/export?survey=${s.id}`} label="Export results" fallbackName="feedback-results.csv" />
            {event ? (
              <Link href={`/events/${event.id}?tab=survey`} className={buttonClass("ghost", "sm")}>
                Event&apos;s Survey tab
              </Link>
            ) : null}
            {canSend ? (
              <>
                {status === "Scheduled" ? (
                  <ActionButton
                    action={setSurveyStatus.bind(null, s.id)}
                    fields={{ status: "open", now: "1" }}
                    label="Open now"
                    variant="primary"
                    size="md"
                    confirm="Open this survey to attendees now? It appears in the member app straight away."
                  />
                ) : null}
                {s.status === "draft" ? (
                  <ActionButton
                    action={setSurveyStatus.bind(null, s.id)}
                    fields={{ status: "open" }}
                    label="Open survey"
                    variant="primary"
                    size="md"
                    confirm="Open this survey to attendees? It appears in the member app from its opening time."
                  />
                ) : null}
                {s.status === "open" ? (
                  <ActionButton action={setSurveyStatus.bind(null, s.id)} fields={{ status: "closed" }} label="Close survey" variant="bad" size="md" />
                ) : null}
                {s.status === "closed" ? (
                  <ActionButton action={setSurveyStatus.bind(null, s.id)} fields={{ status: "open" }} label="Reopen" size="md" />
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      <BlockGrid>
        <Card span={12} title="Audience and answers" description="Invited = adults of households with an active RSVP, or who attended. Anonymous answers count, but never show who gave them.">
          <KpiGrid cols={3}>
            <Stat label="Invited" value={stats.invited} hint="adults" tone="navy" />
            <Stat label="Responses" value={stats.responses} hint={`${stats.answered} ${stats.answered === 1 ? "person" : "people"} answered`} tone="purple" />
            <Stat label="Response rate" value={formatPct(rate)} hint={rate === null ? "nobody invited" : `of ${stats.invited} invited`} tone="success" />
            <Stat label="Completions" value={stats.completions} hint="people who finished, anonymous answers included" tone="navy" />
            <Stat
              label="Points awarded"
              value={stats.pointsAwarded}
              hint={s.reward_points > 0 ? `${formatPoints(s.reward_points)} each` : "this survey gives no points"}
              tone="brown"
            />
            <Stat
              label="Anonymous"
              value={stats.responses ? formatPct(stats.anonymous / stats.responses) : "—"}
              hint={`${stats.anonymous} of ${stats.responses} answers`}
              tone="ink"
            />
          </KpiGrid>
        </Card>

        <Card
          span={12}
          title="Responses over time"
          description={byDay.length > chartDays.length ? `The last ${CHART_DAYS} days. The export has every day.` : "Answers per day, in the center's time zone."}
        >
          {chartDays.length === 0 ? (
            <p className="text-[13px] text-muted">No answers yet.</p>
          ) : (
            <BarList labelWidth="5rem" items={chartDays.map((d) => ({ label: shortDay(d.date), value: d.count, ratio: d.count / busiest, tone: "purple" as const }))} />
          )}
        </Card>

        {results.map((r) => (
          <QuestionResultCard key={r.id} result={r} responses={responses.length} />
        ))}

        <Card span={12} title="All responses" description="Anonymous answers show the day only, never a name, household or device." padded={false}>
          {responses.length === 0 ? (
            <EmptyState title="No responses yet" />
          ) : (
            <TableWrap>
              <table className="crm-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>When</th>
                    {questions.map((q) => (
                      <th key={q.id} className="max-w-[12rem] whitespace-normal">
                        {q.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => {
                    const answers = r.answers && typeof r.answers === "object" && !Array.isArray(r.answers) ? (r.answers as Record<string, unknown>) : {};
                    const named = Boolean(r.person_id) && !s.anonymous;
                    return (
                      <tr key={r.id}>
                        <td className={named ? "font-bold" : "font-bold text-faint"}>{named ? (names.get(r.person_id as string) ?? "Member") : "Anonymous"}</td>
                        <td className="whitespace-nowrap">{named ? formatDateTime(r.submitted_at, tz) : formatEventDate(r.submitted_at, tz)}</td>
                        {questions.map((q) => (
                          <td key={q.id}>{answerText(answers[q.id])}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {canSend ? (
          <Card
            span={12}
            title="Edit survey"
            description={s.status === "open" && status !== "Scheduled" ? "It is live — changes show in the member app immediately." : undefined}
          >
            <ActionForm action={saveSurvey.bind(null, s.id)} submitLabel="Save survey">
              <div className="mb-3 flex flex-col gap-3">
                <div>
                  <label htmlFor="sv-title" className="crm-label">
                    Title
                  </label>
                  <input id="sv-title" name="title" required defaultValue={s.title} className="crm-input" />
                </div>
                <div>
                  <label htmlFor="sv-desc" className="crm-label">
                    Intro
                  </label>
                  <textarea id="sv-desc" name="description" rows={2} defaultValue={s.description ?? ""} className="crm-input" />
                </div>
                <QuestionsBuilder initial={questions} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="sv-open" className="crm-label">
                      Opens (sent)
                    </label>
                    <input id="sv-open" type="datetime-local" name="opens_at" defaultValue={toDateTimeLocal(s.opens_at, tz)} className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor="sv-close" className="crm-label">
                      Closes
                    </label>
                    <input id="sv-close" type="datetime-local" name="closes_at" defaultValue={toDateTimeLocal(s.closes_at, tz)} className="crm-input" />
                  </div>
                </div>
                <label className="flex min-h-9 items-center gap-2 text-[13px]">
                  <input type="checkbox" name="anonymous" defaultChecked={s.anonymous} className="h-4 w-4 accent-navy" /> Always anonymous (no names stored)
                </label>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </BlockGrid>
    </>
  );
}
