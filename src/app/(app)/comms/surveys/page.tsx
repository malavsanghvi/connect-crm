import type { Metadata } from "next";
import Link from "next/link";

import { DrawerForm } from "@/components/drawer-form";
import { Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { describeAudience } from "@/lib/comms";
import { audienceOptions } from "@/lib/data/content-comms";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { saveSurveyAction } from "../actions";
import { audienceNames, CommsHeader, commsGate } from "../shared";
import { SurveyFields } from "./survey-fields";

export const metadata: Metadata = { title: "Communications · Surveys" };

const SUB = "General surveys to members · event feedback surveys live under Events › Feedback";

export default async function SurveysPage() {
  const session = await getSession();
  const gate = commsGate(session, "comms", SUB);
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;
  const canSend = canAccess(session, "commsSend");
  const [surveys, opts] = await Promise.all([
    db.from("surveys").select("*").eq("center_id", center.id).is("event_id", null).order("created_at", { ascending: false }),
    audienceOptions(db, center.id),
  ]);
  const list = surveys.data ?? [];
  const responses = list.length ? await db.from("survey_responses").select("survey_id").in("survey_id", list.map((s) => s.id)).limit(20000) : null;
  const counts = new Map<string, number>();
  for (const r of responses?.data ?? []) counts.set(r.survey_id, (counts.get(r.survey_id) ?? 0) + 1);
  const names = audienceNames(opts.data);
  const error = surveys.error ?? responses?.error ?? null;

  return (
    <>
      <CommsHeader
        sub={SUB}
        actions={
          canSend ? (
            <DrawerForm label="New survey" kicker="Surveys" title="New survey" action={saveSurveyAction} submitLabel="Create survey">
              <SurveyFields options={opts.data} />
            </DrawerForm>
          ) : null
        }
      />
      <Card padded={false}>
        {error ? (
          <div className="p-4">
            <QueryError what="the surveys" error={error} retryHref="/comms/surveys" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No surveys yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Survey</th>
                  <th>Audience</th>
                  <th>Closes</th>
                  <th className="num">Responses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id}>
                    <td className="font-bold">
                      <Link href={`/comms/surveys/${s.id}`} className="crm-link">
                        {s.title}
                      </Link>
                      {s.anonymous ? <div className="text-xs font-normal text-muted">Anonymous</div> : null}
                    </td>
                    <td>{describeAudience(s.audience, names)}</td>
                    <td>{s.closes_at ? formatDate(s.closes_at, tz) : "—"}</td>
                    <td className="num">{counts.get(s.id) ?? 0}</td>
                    <td>
                      <StatusText tone={s.status === "open" ? "ok" : s.status === "closed" ? "bad" : "warn"}>{s.status === "open" ? "Open" : s.status === "closed" ? "Closed" : "Draft"}</StatusText>
                    </td>
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
