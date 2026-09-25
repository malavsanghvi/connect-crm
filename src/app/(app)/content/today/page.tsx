import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, EmptyState, Field, InfoBox, QueryError, StatusText, TableWrap } from "@/components/ui";
import { contentStatusLabel, formatClock, readTimingRules, todayTimingLine } from "@/lib/content";
import { addDays, formatDate, todayInTz } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { saveDayTimingsAction, saveTimingRulesAction } from "../actions";
import { ContentItemButton } from "../item-form";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Today & darshan" };

function weekdayLine(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default async function TodayPage() {
  const session = await getSession();
  const { db, center } = session;
  const short = center.short_name || center.name;
  const sub = `Drives Today at ${short} on the member Home screen and the Library’s live darshan`;
  const gate = contentGate(session, sub);
  if (gate) return gate;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const canSaveRules = canAccess(session, "centerSettings");
  const canManage = canAccess(session, "contentManage");
  const canDraft = canAccess(session, "contentDraft");
  const rules = readTimingRules(center.rules);

  const [days, tithi, streams] = await Promise.all([
    db.from("daily_timings").select("*").eq("center_id", center.id).gte("on_date", today).lte("on_date", addDays(today, 30)).order("on_date"),
    db.from("tithi_days").select("tithi, month_name, paksha, center_id").eq("gregorian", today).or(`center_id.eq.${center.id},center_id.is.null`).limit(2),
    db
      .from("content_items")
      .select("id, kind, title, body_md, media_url, media_path, metadata, status, center_id")
      .eq("kind", "darshan_stream")
      .or(`center_id.eq.${center.id},center_id.is.null`)
      .order("created_at"),
  ]);
  const todayRow = (days.data ?? []).find((d) => d.on_date === today) ?? null;
  const t = (tithi.data ?? []).sort((a, b) => Number(b.center_id !== null) - Number(a.center_id !== null))[0];
  const line = todayTimingLine(todayRow);
  const liveStream = (streams.data ?? []).find((s) => s.status === "published" && (s.metadata as Record<string, unknown>)?.stream_status === "live");
  const aarti = rules.aarti || (todayRow?.aarti ? formatClock(todayRow.aarti) : null);

  return (
    <>
      <ContentHeader sub={sub} />
      <BlockGrid>
        <Card title="Daily timings" span={7}>
          <ActionForm action={saveTimingRulesAction} submitLabel="Save timings" hideSubmit={!canSaveRules}>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Derasar hours" htmlFor="t-derasar">
                <input id="t-derasar" name="derasar_hours" defaultValue={rules.derasar_hours} placeholder="7:30 AM – 6:00 PM daily" disabled={!canSaveRules} className="crm-input" />
              </Field>
              <Field label="Aarti" htmlFor="t-aarti">
                <input id="t-aarti" name="aarti" defaultValue={rules.aarti} placeholder="12:30 PM and 4:30 PM" disabled={!canSaveRules} className="crm-input" />
              </Field>
              <Field label="Snatra puja" htmlFor="t-snatra">
                <input id="t-snatra" name="snatra_puja" defaultValue={rules.snatra_puja} placeholder="Sundays 9:30 AM" disabled={!canSaveRules} className="crm-input" />
              </Field>
              <div>
                <p className="crm-label">Location for sunrise and sunset</p>
                <InfoBox>Center address · members may use their own location</InfoBox>
              </div>
              <div>
                <p className="crm-label">Navkarsi</p>
                <InfoBox>Sunrise + 48 minutes</InfoBox>
              </div>
              <div>
                <p className="crm-label">Porsi and Purimaddh</p>
                <InfoBox>One and two prahar after sunrise</InfoBox>
              </div>
              <div>
                <p className="crm-label">Chauvihar</p>
                <InfoBox>Before sunset</InfoBox>
              </div>
              <div>
                <p className="crm-label">Tithi source</p>
                <InfoBox>Panchang in Calendar settings</InfoBox>
              </div>
            </div>
            {!canSaveRules ? <p className="mb-2 text-[13px] text-muted">These hours are part of the center rules; saving them needs settings.manage.</p> : null}
          </ActionForm>
        </Card>

        <Card title="Member Home preview · today" span={5} className="!bg-[#FBF7F0]">
          {days.error || tithi.error ? <QueryError what="today's timings" error={days.error ?? tithi.error} retryHref="/content/today" /> : null}
          <p className="text-[13px] font-semibold text-ink-2">
            {weekdayLine(today)}
            {t ? ` · ${t.month_name} ${t.paksha} ${t.tithi}` : ""}
          </p>
          <p className="mt-1 text-sm font-bold text-ink">{line ?? "No sunrise and sunset entered for today yet — add them under Timings by day."}</p>
          <p className="mt-1 text-sm font-bold text-navy">
            {liveStream ? "Watch live darshan" : "Live darshan is not streaming"}
            {aarti ? ` · Aarti at ${aarti}` : ""}
          </p>
          {!t && !tithi.error ? <p className="mt-2 text-xs text-muted">No tithi is loaded for today in the panchang.</p> : null}
        </Card>

        <Card
          title="Live darshan"
          span={12}
          padded={false}
          actions={canDraft ? <ContentItemButton kind="darshan_stream" kindLabel="Live darshan stream" meta={["source", "schedule", "stream_status"]} label="Add stream" bodyLabel="Notes" /> : null}
        >
          {streams.error ? (
            <div className="p-4">
              <QueryError what="the darshan streams" error={streams.error} retryHref="/content/today" />
            </div>
          ) : (streams.data ?? []).length === 0 ? (
            <EmptyState title="No darshan streams yet">Add the derasar camera or the pravachan hall so members can watch from the Library.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Stream</th>
                    <th>Source</th>
                    <th>Schedule</th>
                    <th>Status</th>
                    {canDraft ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(streams.data ?? []).map((s) => {
                    const meta = (s.metadata ?? {}) as Record<string, unknown>;
                    const live = meta.stream_status === "live";
                    const published = s.status === "published";
                    return (
                      <tr key={s.id}>
                        <td className="font-bold">{s.title}</td>
                        <td>{typeof meta.source === "string" ? meta.source : (s.media_url ?? "—")}</td>
                        <td>{typeof meta.schedule === "string" ? meta.schedule : "—"}</td>
                        <td>
                          {!published ? (
                            <StatusText tone="warn">{contentStatusLabel(s.status)}</StatusText>
                          ) : live ? (
                            <StatusText tone="ok">Live</StatusText>
                          ) : (
                            <StatusText tone="warn">{meta.stream_status === "off" ? "Off" : "Idle"}</StatusText>
                          )}
                        </td>
                        {canDraft ? (
                          <td className="text-right">
                            {s.center_id ? (
                              <ContentItemButton
                                kind="darshan_stream"
                                kindLabel="Live darshan stream"
                                meta={["source", "schedule", "stream_status"]}
                                label="Edit"
                                variant="ghost"
                                size="xs"
                                bodyLabel="Notes"
                                item={{ ...s, metadata: meta }}
                              />
                            ) : (
                              <span className="text-xs text-muted">Shared</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {liveStream?.media_url && /^https:\/\//i.test(liveStream.media_url) ? (
            <div className="border-t border-line p-4">
              <p className="crm-label">Preview · {liveStream.title}</p>
              <iframe
                src={liveStream.media_url}
                title={`${liveStream.title} (preview)`}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                className="aspect-video w-full max-w-[640px] rounded-lg border border-line bg-black"
              />
              <p className="mt-1 text-xs text-muted">
                Members watch this from Home › Watch live darshan and Learn › Library.{" "}
                <a href={liveStream.media_url} target="_blank" rel="noreferrer" className="text-navy underline">
                  Open the stream
                </a>
              </p>
            </div>
          ) : null}
        </Card>

        <Card title="Timings by day" description="Sunrise and sunset for the next 30 days. A day entered here overrides the rules above." span={canManage ? 8 : 12} padded={false}>
          {days.error ? (
            <div className="p-4">
              <QueryError what="the timings" error={days.error} retryHref="/content/today" />
            </div>
          ) : (days.data ?? []).length === 0 ? (
            <EmptyState title="No days entered for the next 30 days" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    {["Date", "Sunrise", "Navkarsi", "Sunset", "Chauvihar", "Aarti", "Temple"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(days.data ?? []).map((d) => (
                    <tr key={d.id}>
                      <td className="font-bold whitespace-nowrap">{formatDate(d.on_date, tz)}</td>
                      <td>{formatClock(d.sunrise) ?? "—"}</td>
                      <td>{formatClock(d.navkarsi) ?? "—"}</td>
                      <td>{formatClock(d.sunset) ?? "—"}</td>
                      <td>{formatClock(d.chauvihar) ?? "—"}</td>
                      <td>{formatClock(d.aarti) ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {formatClock(d.temple_open) ?? "—"} – {formatClock(d.temple_close) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {canManage ? (
          <Card title="Enter timings for a day" description="Saving a date that already has timings replaces them." span={4}>
            <ActionForm action={saveDayTimingsAction} submitLabel="Save day">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <Field label="Date" htmlFor="d-date" className="col-span-2">
                  <input id="d-date" type="date" name="on_date" required defaultValue={today} className="crm-input" />
                </Field>
                {(
                  [
                    ["sunrise", "Sunrise"],
                    ["navkarsi", "Navkarsi"],
                    ["sunset", "Sunset"],
                    ["chauvihar", "Chauvihar"],
                    ["aarti", "Aarti"],
                    ["temple_open", "Temple opens"],
                    ["temple_close", "Temple closes"],
                  ] as const
                ).map(([name, label]) => (
                  <Field key={name} label={label} htmlFor={`d-${name}`}>
                    <input id={`d-${name}`} type="time" name={name} className="crm-input" />
                  </Field>
                ))}
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </BlockGrid>
    </>
  );
}
