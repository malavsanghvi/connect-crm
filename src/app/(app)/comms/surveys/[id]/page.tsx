import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import type { SurveyQuestion } from "@/components/survey/questions-builder";
import { Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { audienceOptions, personNames } from "@/lib/data/content-comms";
import { formatDateTime, isoToLocalDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { saveSurveyAction, setSurveyStatusAction } from "../../actions";
import { SurveyFields } from "../survey-fields";

export const metadata: Metadata = { title: "Communications · Survey" };

function answerText(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export default async function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  const back = (
    <Link href="/comms/surveys" className="crm-link">
      ← Surveys
    </Link>
  );
  if (!canAccess(session, "comms")) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <NoAccess area="Surveys" access="comms" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const [s, responses, opts] = await Promise.all([
    db.from("surveys").select("*").eq("id", id).maybeSingle(),
    db.from("survey_responses").select("*").eq("survey_id", id).order("submitted_at", { ascending: false }).limit(500),
    audienceOptions(db, center.id),
  ]);
  if (s.error) {
    return (
      <>
        <PageHeader title="Communications" eyebrow={back} />
        <QueryError what="the survey" error={s.error} retryHref={`/comms/surveys/${id}`} />
      </>
    );
  }
  if (!s.data) notFound();
  const survey = s.data;
  const questions = (Array.isArray(survey.questions) ? survey.questions : []) as SurveyQuestion[];
  const list = responses.data ?? [];
  const names = survey.anonymous ? new Map<string, string>() : await personNames(db, list.map((r) => r.person_id));
  const canSend = canAccess(session, "commsSend");

  return (
    <>
      <PageHeader
        title={survey.title}
        eyebrow={back}
        tabs={false}
        description={
          <>
            <StatusText tone={survey.status === "open" ? "ok" : survey.status === "closed" ? "bad" : "warn"}>{survey.status === "open" ? "Open" : survey.status === "closed" ? "Closed" : "Draft"}</StatusText>
            {` · ${list.length} response${list.length === 1 ? "" : "s"}${survey.anonymous ? " · anonymous" : ""}${survey.closes_at ? ` · closes ${formatDateTime(survey.closes_at, tz)}` : ""}`}
          </>
        }
        actions={
          canSend ? (
            <>
              {survey.status === "draft" ? (
                <RowActions action={setSurveyStatusAction} fields={{ id }} buttons={[{ label: "Open survey", value: "open", variant: "primary", confirm: "Open this survey to members?" }]} />
              ) : survey.status === "open" ? (
                <RowActions action={setSurveyStatusAction} fields={{ id }} buttons={[{ label: "Close survey", value: "closed", variant: "bad" }]} />
              ) : (
                <RowActions action={setSurveyStatusAction} fields={{ id }} buttons={[{ label: "Reopen", value: "open", variant: "ghost" }]} />
              )}
              <DrawerForm label="Edit survey" variant="ghost" kicker="Surveys" title={survey.title} subtitle={survey.status === "draft" ? undefined : "It is live — changes show immediately"} action={saveSurveyAction} submitLabel="Save survey" resetOnSuccess={false}>
                <SurveyFields
                  options={opts.data}
                  survey={{
                    id,
                    title: survey.title,
                    description: survey.description,
                    questions,
                    anonymous: survey.anonymous,
                    audience: survey.audience,
                    opens_local: isoToLocalDateTime(survey.opens_at, tz),
                    closes_local: isoToLocalDateTime(survey.closes_at, tz),
                  }}
                />
              </DrawerForm>
            </>
          ) : null
        }
      />
      <Card title="Responses" padded={false}>
        {responses.error ? (
          <div className="p-4">
            <QueryError what="the responses" error={responses.error} retryHref={`/comms/surveys/${id}`} />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No responses yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  {!survey.anonymous ? <th>From</th> : null}
                  <th>When</th>
                  {questions.map((q) => (
                    <th key={q.id}>{q.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const answers = (r.answers ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={r.id}>
                      {!survey.anonymous ? <td className="font-bold">{r.person_id ? (names.get(r.person_id) ?? "Member") : "Anonymous"}</td> : null}
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
    </>
  );
}
