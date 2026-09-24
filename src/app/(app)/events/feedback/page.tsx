import type { Metadata } from "next";
import Link from "next/link";

import { BarList } from "@/components/events/bars";
import { ClickableRow } from "@/components/events/clickable-row";
import { LoadProblem } from "@/components/events/load-problem";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, Stat, TableWrap, buttonClass } from "@/components/ui";
import { loadFeedbackOverview, surveyExtras } from "@/lib/data/event-feedback";
import { load, loadEventAccess, resolvePeopleNames } from "@/lib/data/events";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { eventAreas } from "@/lib/events/access";
import { canAccess, can } from "@/lib/permissions";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import {
  FEEDBACK_AREAS,
  LOW_AREA_SCORE,
  aggregateFeedback,
  feedbackStatus,
  formatNps,
  formatPct,
  type FeedbackStatus,
} from "@/lib/survey/feedback";
import { parseQuestions } from "@/lib/survey/questions";

import { saveFeedbackTemplate } from "./actions";
import { RequestFeedbackButton } from "./request-feedback";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Event feedback" };

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  Closed: "cc-status-ok",
  "Not sent": "cc-status-warn",
  Scheduled: "font-bold text-purple",
  Open: "font-bold text-navy",
  Draft: "font-semibold text-muted",
};

const AREA_FILTERS = ["All", ...FEEDBACK_AREAS.map((a) => a.area)];

function shortDate(iso: string | null, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameYear = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(d) === new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(new Date());
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
}

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const tz = session.center.time_zone;
  const access = await loadEventAccess(session);
  const title = "Event feedback";
  const description = "Surveys after each event · members can answer anonymously · results aggregated here";
  if (!canAccess(session, "events")) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <NoAccess area="Events" access="events" />
      </>
    );
  }
  if (!canAccess(session, "eventFeedbackRead")) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <NoAccess area="Event feedback surveys" access="eventFeedbackRead" />
      </>
    );
  }

  const since = startOfDayInTz(addDays(todayInTz(tz), -120), tz);
  const res = await load(() => loadFeedbackOverview(session.db, session.center.id, since));
  if (!res.ok) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <LoadProblem message={res.error} retryHref="/events/feedback" />
      </>
    );
  }
  const { template, surveys, events, responses, attendeesByEvent } = res.data;
  const eventName = new Map(events.map((e) => [e.id, e.name]));

  // One row per event survey, then recent events that have none ("Not sent").
  type Row = { key: string; surveyId: string | null; eventId: string; event: string; sent: string | null; status: FeedbackStatus };
  const tableRows: Row[] = [
    ...surveys.map((s) => ({
      key: s.id,
      surveyId: s.id,
      eventId: s.event_id as string,
      event: eventName.get(s.event_id as string) ?? s.title,
      sent: surveyExtras(s).sendAt ?? s.opens_at ?? s.created_at,
      status: feedbackStatus(s),
    })),
    ...events
      .filter((e) => !surveys.some((s) => s.event_id === e.id))
      .map((e) => ({ key: `event-${e.id}`, surveyId: null, eventId: e.id, event: e.name, sent: null, status: "Not sent" as const })),
  ];
  const stats = new Map(
    surveys.map((s) => {
      const mine = responses.filter((r) => r.survey_id === s.id);
      return [s.id, aggregateFeedback(parseQuestions(s.questions), mine, attendeesByEvent.get(s.event_id as string) ?? 0)] as const;
    }),
  );

  // The survey whose results are shown: ?survey=, else the latest with answers.
  const wanted = param(sp, "survey");
  const selected = surveys.find((s) => s.id === wanted) ?? surveys.find((s) => (stats.get(s.id)?.responses ?? 0) > 0) ?? null;
  let results = selected ? stats.get(selected.id)! : null;
  if (selected && results && !selected.anonymous) {
    // Names only for members who chose to answer with their name.
    const ids = responses.filter((r) => r.survey_id === selected.id && r.person_id).map((r) => r.person_id as string);
    const names = await resolvePeopleNames(session.db, ids);
    results = aggregateFeedback(
      parseQuestions(selected.questions),
      responses.filter((r) => r.survey_id === selected.id),
      attendeesByEvent.get(selected.event_id as string) ?? 0,
      (id) => names.get(id) ?? null,
    );
  }
  const previous = selected
    ? surveys
        .filter((s) => s.id !== selected.id && (s.opens_at ?? s.created_at) < (selected.opens_at ?? selected.created_at))
        .map((s) => stats.get(s.id)?.overall ?? null)
        .find((v) => v !== null)
    : null;
  const area = AREA_FILTERS.includes(param(sp, "area") ?? "") ? param(sp, "area")! : "All";
  const comments = (results?.comments ?? []).filter((c) => area === "All" || c.area === area);

  const canSend = can(access, "comms.send") && eventAreas.view(access);
  const canManage = eventAreas.manage(access);
  const candidates = events
    .filter((e) => !surveys.some((s) => s.event_id === e.id))
    .map((e) => ({ id: e.id, name: e.name, checkedIn: attendeesByEvent.get(e.id) ?? 0 }));
  const timingText =
    template.settings.sendTiming === "right_after" ? "right after the event" : template.settings.sendTiming === "two_days" ? "two days after the event" : "the morning after the event";
  const reminderText = template.settings.reminderAfterDays ? `, with one reminder after ${template.settings.reminderAfterDays} days` : "";
  const selectedName = selected ? (eventName.get(selected.event_id as string) ?? selected.title) : null;

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          canManage || canSend ? (
            <RequestFeedbackButton
              candidates={candidates}
              timingText={timingText}
              reminderText={reminderText}
              anonymousAllowed={template.settings.anonymousAllowed}
              disabledReason={canSend ? null : "Sending feedback surveys needs the communications permission (comms.send). Ask your center admin."}
            />
          ) : null
        }
      />
      <BlockGrid>
        <Card span={12} padded={false} title="Surveys">
          {tableRows.length === 0 ? (
            <EmptyState title="No events to ask about yet">Live and completed events from the last four months appear here.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Sent</th>
                    <th className="num">Responses</th>
                    <th className="num">Rate</th>
                    <th className="num">Avg</th>
                    <th className="num">NPS</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((r) => {
                    const st = r.surveyId ? stats.get(r.surveyId) : null;
                    const cells = (
                      <>
                        <td className="font-bold">
                          {r.surveyId ? (
                            <Link href={hrefWith("/events/feedback", sp, { survey: r.surveyId, area: undefined })} className="hover:underline">
                              {r.event}
                            </Link>
                          ) : (
                            r.event
                          )}
                        </td>
                        <td className="whitespace-nowrap">{shortDate(r.sent, tz)}</td>
                        <td className="num">{st ? st.responses : 0}</td>
                        <td className="num">{st && st.responses ? formatPct(st.rate) : "—"}</td>
                        <td className="num">{st?.overall !== null && st?.overall !== undefined ? st.overall.toFixed(1) : "—"}</td>
                        <td className="num">{st ? formatNps(st.nps) : "—"}</td>
                        <td>
                          <span className={STATUS_CLASS[r.status]}>{r.status}</span>
                        </td>
                      </>
                    );
                    return r.surveyId ? (
                      <ClickableRow key={r.key} href={hrefWith("/events/feedback", sp, { survey: r.surveyId, area: undefined })} highlight={selected?.id === r.surveyId}>
                        {cells}
                      </ClickableRow>
                    ) : (
                      <tr key={r.key}>{cells}</tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {selected && results ? (
          <>
            <Card
              span={12}
              title={`${selectedName} · results`}
              actions={
                <>
                  <a href={`/events/feedback/export?survey=${selected.id}`} className={buttonClass("ghost", "sm")}>
                    Export results
                  </a>
                  <Link href={`/events/feedback/${selected.id}`} className={buttonClass("ghost", "sm")}>
                    All responses and settings
                  </Link>
                </>
              }
            >
              <KpiGrid cols={5}>
                <Stat
                  label="Responses"
                  value={results.responses}
                  hint={results.rate !== null ? `${formatPct(results.rate)} of ${attendeesByEvent.get(selected.event_id as string) ?? 0} attendees` : "no check-ins recorded"}
                  tone="purple"
                />
                <Stat
                  label="Anonymous"
                  value={results.responses ? formatPct(results.anonymous / results.responses) : "—"}
                  hint={`${results.anonymous} of ${results.responses}`}
                  tone="navy"
                />
                <Stat
                  label="Overall rating"
                  value={results.overall !== null ? `${results.overall.toFixed(1)} / 5` : "—"}
                  hint={
                    results.overall !== null && previous !== null && previous !== undefined
                      ? `${results.overall - previous >= 0 ? "+" : "−"}${Math.abs(results.overall - previous).toFixed(1)} vs the previous survey`
                      : "no earlier survey to compare"
                  }
                  tone="success"
                />
                <Stat
                  label="Net promoter score"
                  value={formatNps(results.nps)}
                  hint={
                    results.npsAnswers
                      ? `${formatPct(results.promoters / results.npsAnswers)} promoters · ${formatPct(results.detractors / results.npsAnswers)} detractors`
                      : "no answers yet"
                  }
                  tone="success"
                />
                <Stat label="Comments" value={results.comments.length} hint={`${results.flagged} flagged for follow-up`} tone="brown" />
              </KpiGrid>
            </Card>
            <Card span={6} title="Average by area (out of 5)">
              {results.areas.length === 0 ? (
                <p className="text-[13px] text-muted">This survey has no area ratings.</p>
              ) : (
                <BarList
                  items={results.areas.map((a) => ({
                    label: a.label,
                    value: a.average !== null ? a.average.toFixed(1) : "—",
                    ratio: (a.average ?? 0) / 5,
                    tone: a.average !== null && a.average < LOW_AREA_SCORE ? "danger" : "purple",
                  }))}
                />
              )}
            </Card>
            <Card span={6} title="What people attended">
              {results.attended.length === 0 ? (
                <p className="text-[13px] text-muted">This survey does not ask what people attended.</p>
              ) : (
                <BarList
                  labelWidth="9rem"
                  items={results.attended.map((a) => ({
                    label: a.label,
                    value: `${a.count} responses`,
                    ratio: a.count / Math.max(1, results.attended[0].count),
                    tone: "navy",
                  }))}
                />
              )}
            </Card>
            <Card
              span={12}
              padded={false}
              title="Comments"
              description="Anonymous answers never show a name, household or device, even to admins"
              actions={
                <nav aria-label="Comment area" className="flex flex-wrap gap-1.5">
                  {AREA_FILTERS.map((a) => (
                    <Link
                      key={a}
                      href={hrefWith("/events/feedback", sp, { survey: selected.id, area: a === "All" ? undefined : a })}
                      aria-current={a === area ? "page" : undefined}
                      className="cc-chip"
                    >
                      {a}
                    </Link>
                  ))}
                </nav>
              }
            >
              {comments.length === 0 ? (
                <EmptyState title={area === "All" ? "No comments yet" : `No comments about ${area.toLowerCase()}`} />
              ) : (
                <TableWrap>
                  <table className="crm-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>From</th>
                        <th>Rating</th>
                        <th>Area</th>
                        <th>Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comments.map((c, i) => (
                        <tr key={`${c.submittedAt}-${i}`}>
                          <td className={c.anonymous ? "font-bold text-faint" : "font-bold"}>{c.from}</td>
                          <td className="whitespace-nowrap">{c.rating !== null ? `${c.rating}★` : "—"}</td>
                          <td>{c.area}</td>
                          <td>
                            {c.text}
                            {c.flagged ? <span className="cc-status-warn ml-2 whitespace-nowrap">· flagged to the event lead</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          </>
        ) : (
          <Card span={12} title="Results">
            <EmptyState title="No answers yet">Results appear here once members answer a feedback survey.</EmptyState>
          </Card>
        )}

        <Card span={12} title="Survey template">
          <TemplateForm
            action={saveFeedbackTemplate.bind(null, template.id)}
            questions={template.questions}
            settings={template.settings}
            editable={canSend && canManage}
          />
          {canManage && !canSend ? (
            <p className="crm-hint mt-2">Saving the template needs the communications permission (comms.send) as well as Events access.</p>
          ) : null}
        </Card>

        <Card span={12} title="Exports">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Results export as combined totals and anonymized comments. A comment that names someone or reports a safety concern is flagged to the event lead
            rather than published in reports.
          </p>
        </Card>
      </BlockGrid>
    </>
  );
}
