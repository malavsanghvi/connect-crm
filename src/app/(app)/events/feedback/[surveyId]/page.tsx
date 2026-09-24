import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { QuestionsBuilder } from "@/components/survey/questions-builder";
import { Card, EmptyState, NoAccess, PageHeader, TableWrap } from "@/components/ui";
import { surveyExtras } from "@/lib/data/event-feedback";
import { allRows, load, loadEventAccess, resolvePeopleNames, row } from "@/lib/data/events";
import type { Json } from "@/lib/database.types";
import { eventAreas } from "@/lib/events/access";
import { formatDateTime, toDateTimeLocal } from "@/lib/events/format";
import { can, canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { feedbackStatus } from "@/lib/survey/feedback";
import { answerText, parseQuestions } from "@/lib/survey/questions";

import { saveSurvey, setSurveyStatus } from "../actions";

export const metadata: Metadata = { title: "Feedback survey" };

export default async function FeedbackSurveyPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  if (!isUuid(surveyId)) notFound();
  const session = await getSession();
  const access = await loadEventAccess(session);
  if (!canAccess(session, "eventFeedbackRead")) {
    return (
      <>
        <PageHeader title="Feedback survey" />
        <NoAccess area="Feedback surveys" access="eventFeedbackRead" />
      </>
    );
  }
  const tz = session.center.time_zone;
  const res = await load(async () => {
    const s = row(await session.db.from("surveys").select("*").eq("id", surveyId).maybeSingle(), "the survey");
    if (!s) return null;
    const responses = await allRows<{ id: string; person_id: string | null; answers: Json; submitted_at: string }>(
      (f, t) => session.db.from("survey_responses").select("id, person_id, answers, submitted_at").eq("survey_id", surveyId).order("submitted_at", { ascending: false }).range(f, t),
      "responses",
    );
    const event = s.event_id ? row(await session.db.from("events").select("id, name").eq("id", s.event_id).maybeSingle(), "the event") : null;
    const names = s.anonymous ? new Map<string, string>() : await resolvePeopleNames(session.db, responses.map((r) => r.person_id));
    return { s, responses, event, names };
  });
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Feedback survey" />
        <LoadProblem message={res.error} retryHref={`/events/feedback/${surveyId}`} />
      </>
    );
  }
  if (!res.data) notFound();
  const { s, responses, event, names } = res.data;
  const questions = parseQuestions(s.questions);
  const status = feedbackStatus(s);
  const canSend = can(access, "comms.send") && eventAreas.view(access);
  const sendAt = surveyExtras(s).sendAt ?? s.opens_at;

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
          sendAt ? `${status === "Scheduled" ? "opens" : "opened"} ${formatDateTime(sendAt, tz)}` : null,
          s.closes_at ? `closes ${formatDateTime(s.closes_at, tz)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canSend ? (
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
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        <Card title="Responses" padded={false}>
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
                    return (
                      <tr key={r.id}>
                        <td className={r.person_id && !s.anonymous ? "font-bold" : "font-bold text-faint"}>
                          {r.person_id && !s.anonymous ? (names.get(r.person_id) ?? "Member") : "Anonymous"}
                        </td>
                        <td className="whitespace-nowrap">{formatDateTime(r.submitted_at, tz)}</td>
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
      </div>
    </>
  );
}
