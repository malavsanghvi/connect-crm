import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, buttonClass, Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap } from "@/components/ui";
import { layerDefault, layerOwner, layerSource, sortLayers, TRADITION_LABEL } from "@/lib/calendar";
import { addDays, formatDate, formatMonth, todayInTz } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { deleteCalendarEntryAction, saveCalendarEntryAction } from "./actions";
import { LayerEdit } from "./layer-row";

export const metadata: Metadata = { title: "Calendar" };

const MONTH = /^\d{4}-\d{2}$/;

export default async function CalendarPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Calendar" description="Layers members can overlay in the app" />;
  if (!canAccess(session, "calendar")) {
    return (
      <>
        {header}
        <NoAccess area="Calendar" access="calendar" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const manage = canAccess(session, "calendarManage");
  const sp = await searchParams;
  const monthParam = param(sp, "month");
  const month = monthParam && MONTH.test(monthParam) ? monthParam : today.slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = addDays(monthStart, 32).slice(0, 7);
  const prevMonth = addDays(monthStart, -1).slice(0, 7);

  const [centerRow, layersRes, tithiRes] = await Promise.all([
    db.from("centers").select("tradition").eq("id", center.id).maybeSingle(),
    db.from("calendar_layers").select("id, center_id, key, name, kind, source_url, default_on, color, owner_label").or(`center_id.eq.${center.id},center_id.is.null`),
    db
      .from("tithi_days")
      .select("id, center_id, tradition, gregorian, tithi, month_name, paksha, is_parva, notes")
      .or(`center_id.eq.${center.id},center_id.is.null`)
      .gte("gregorian", monthStart)
      .lt("gregorian", `${nextMonth}-01`)
      .order("gregorian"),
  ]);
  if (centerRow.error) console.error("[calendar] center tradition unavailable:", centerRow.error);
  const tradition = centerRow.data?.tradition ?? null;
  const layers = sortLayers(layersRes.data ?? []);
  const mine = layers.filter((l) => l.center_id === center.id);
  const entries =
    mine.length > 0
      ? await db
          .from("calendar_entries")
          .select("id, layer_id, title, starts_on, ends_on, event_id")
          .in(
            "layer_id",
            mine.map((l) => l.id),
          )
          .gte("starts_on", addDays(today, -7))
          .order("starts_on")
          .limit(200)
      : { data: [], error: null };
  const layerName = new Map(layers.map((l) => [l.id, l.name]));

  // A center's own tithi row overrides the shared one for the same day and tradition.
  const tithi = new Map<string, NonNullable<typeof tithiRes.data>[number]>();
  for (const t of tithiRes.data ?? []) {
    if (tradition && t.tradition && t.tradition !== tradition) continue;
    const cur = tithi.get(t.gregorian);
    if (!cur || (cur.center_id === null && t.center_id !== null)) tithi.set(t.gregorian, t);
  }
  const tithiRows = [...tithi.values()];

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Layers" padded={false}>
          {layersRes.error ? (
            <div className="p-2">
              <QueryError what="calendar layers" error={layersRes.error} retryHref="/calendar" />
            </div>
          ) : layers.length === 0 ? (
            <EmptyState title="No calendar layers yet" />
          ) : (
            <TableWrap>
              <table className="crm-table min-w-[760px]">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>Source</th>
                    <th>Owner</th>
                    <th>Default</th>
                    {manage ? <th>Change owner / default</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {layers.map((l) => (
                    <tr key={l.id}>
                      <td className="font-bold">
                        {l.color ? <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: l.color }} /> : null}
                        {l.name}
                      </td>
                      <td>{layerSource(l, tradition)}</td>
                      <td>{layerOwner(l)}</td>
                      <td>{layerDefault(l)}</td>
                      {manage ? (
                        <td>
                          {l.center_id === center.id ? (
                            <LayerEdit layerId={l.id} name={l.name} defaultOn={l.default_on} owner={l.owner_label ?? ""} />
                          ) : (
                            <span className="text-xs text-muted">Shared layer · set by the platform</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card span={manage ? 7 : 12} title="Upcoming entries" description="Dates on your center's layers, from last week on" padded={false}>
          {entries.error ? (
            <div className="p-2">
              <QueryError what="calendar entries" error={entries.error} retryHref="/calendar" />
            </div>
          ) : (entries.data ?? []).length === 0 ? (
            <EmptyState title="No entries on your center's layers" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entry</th>
                    <th>Layer</th>
                    {manage ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(entries.data ?? []).map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">
                        {formatDate(e.starts_on, tz)}
                        {e.ends_on && e.ends_on !== e.starts_on ? ` – ${formatDate(e.ends_on, tz)}` : ""}
                      </td>
                      <td className="font-semibold">{e.title}</td>
                      <td>{layerName.get(e.layer_id) ?? "—"}</td>
                      {manage ? (
                        <td>
                          {e.event_id ? (
                            <span className="text-xs text-muted">From Events</span>
                          ) : (
                            <ActionForm
                              action={deleteCalendarEntryAction.bind(null, e.id)}
                              submitLabel="Remove"
                              variant="bad"
                              size="xs"
                              confirmMessage={`Remove "${e.title}" from the calendar?`}
                            />
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {manage ? (
          <Card span={5} title="Add an entry">
            {mine.length === 0 ? (
              <EmptyState title="Your center has no layers of its own yet" />
            ) : (
              <ActionForm action={saveCalendarEntryAction} submitLabel="Add" pendingLabel="Adding…" resetOnSuccess>
                <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label htmlFor="ce-layer" className="crm-label">
                      Layer
                    </label>
                    <select id="ce-layer" name="layer_id" required defaultValue="" className="crm-input">
                      <option value="" disabled>
                        Choose
                      </option>
                      {mine.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="ce-title" className="crm-label">
                      Title
                    </label>
                    <input id="ce-title" name="title" required maxLength={160} className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor="ce-start" className="crm-label">
                      Date
                    </label>
                    <input id="ce-start" name="starts_on" type="date" required className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor="ce-end" className="crm-label">
                      Until (optional)
                    </label>
                    <input id="ce-end" name="ends_on" type="date" className="crm-input" />
                  </div>
                </div>
              </ActionForm>
            )}
          </Card>
        ) : null}

        <Card
          span={12}
          title={`Tithi days · ${formatMonth(monthStart)}`}
          description={`Panchang for ${TRADITION_LABEL[tradition ?? ""] ?? "your tradition"} · your center's own rows override the shared table`}
          actions={
            <>
              <Link href={`/calendar?month=${prevMonth}`} scroll={false} className={buttonClass("ghost", "sm")}>
                Previous month
              </Link>
              <Link href={`/calendar?month=${nextMonth}`} scroll={false} className={buttonClass("ghost", "sm")}>
                Next month
              </Link>
            </>
          }
          padded={false}
        >
          {tithiRes.error ? (
            <div className="p-2">
              <QueryError what="tithi days" error={tithiRes.error} retryHref="/calendar" />
            </div>
          ) : tithiRows.length === 0 ? (
            <EmptyState title="No tithi days loaded for this month">The Panchang source is configured in Settings › Integrations.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Tithi</th>
                    <th>Month</th>
                    <th>Parva</th>
                    <th>Notes</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {tithiRows.map((t) => (
                    <tr key={t.id} data-highlight={t.gregorian === today ? "" : undefined}>
                      <td className="whitespace-nowrap">{formatDate(t.gregorian, tz)}</td>
                      <td className="font-bold">{t.tithi}</td>
                      <td>
                        {t.month_name} {t.paksha === "sud" ? "Sud" : "Vad"}
                      </td>
                      <td>{t.is_parva ? <span className="cc-status-warn">Parva</span> : "—"}</td>
                      <td className="text-muted">{t.notes ?? "—"}</td>
                      <td className="text-xs text-muted">{t.center_id ? "This center" : "Shared"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
