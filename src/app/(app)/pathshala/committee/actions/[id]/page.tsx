import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { dueBadge, type StatusUpdate } from "@/lib/logic/eams";
import { formatDate, formatDateTime, humanize, todayIso } from "@/lib/pathshala/format";
import { load, resolvePeopleNames, row, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ActionButton, LoadProblem, Notice, PBadge, SectionHeading } from "../../../ui";
import { ActionEditor } from "../../action-form";
import { PHASE_LABEL } from "../../action-row";
import { addStatusUpdate, deleteAction, pushActionToTemplate, setActionState } from "../../actions";

export const metadata: Metadata = { title: "Action" };

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = viewerOf(await getSession());
  const supabase = v.db;
  const tz = v.center.time_zone;

  const res = await load(async () => {
    const action = row(await supabase.from("actions").select("*").eq("id", id).maybeSingle(), "the action");
    if (!action) return null;
    const [events, event, concern] = await Promise.all([
      supabase.from("events").select("id, name, starts_at").eq("center_id", v.center.id).order("starts_at", { ascending: false, nullsFirst: true }).limit(200),
      action.event_id ? supabase.from("events").select("id, name, template_id, starts_at").eq("id", action.event_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      supabase.from("concerns").select("id, title").eq("linked_action_id", id).maybeSingle(),
    ]);
    if (concern.error) console.error("[action] linked concern lookup failed", concern.error);
    const names = await resolvePeopleNames(supabase, [action.owner_person_id, ...action.backup_owner_ids]);
    return { action, events: rows(events, "events"), event: row(event, "the event"), concern: concern.data, names };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  if (!res.data) notFound();
  const { action, events, event, concern, names } = res.data;
  const updates = Array.isArray(action.status_updates) ? (action.status_updates as StatusUpdate[]) : [];
  const badge = dueBadge(action, todayIso(tz));
  const opt = (pid: string) => ({ id: pid, name: names.get(pid) ?? "Someone", detail: null });
  const manage = can(v, "events.manage");

  return (
    <>
      <SectionHeading
        title={action.name}
        back={{ href: event ? `/events/${event.id}?tab=checklist` : "/pathshala/committee/actions", label: event ? event.name : "Actions" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PBadge tone={badge.tone}>{badge.label}</PBadge>
            <PBadge tone="muted">{humanize(action.state)}</PBadge>
            {event && (
              <span>
                <Link className="crm-link font-semibold" href={`/events/${event.id}?tab=checklist`}>
                  {event.name}
                </Link>
                {action.phase ? ` · ${PHASE_LABEL[action.phase]}` : ""}
              </span>
            )}
            {concern && (
              <span>
                From concern:{" "}
                <Link className="crm-link font-semibold" href={`/pathshala/committee/concerns?open=${concern.id}`}>
                  {concern.title}
                </Link>
              </span>
            )}
          </span>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {action.state !== "in_progress" && action.state !== "completed" && (
          <ActionButton action={setActionState.bind(null, action.id)} fields={{ state: "in_progress" }} label="Start" />
        )}
        {action.state !== "completed" && (
          <ActionButton action={setActionState.bind(null, action.id)} fields={{ state: "completed" }} label="✓ Mark complete" variant="ok" />
        )}
        {action.state === "completed" && <ActionButton action={setActionState.bind(null, action.id)} fields={{ state: "in_progress" }} label="Reopen" />}
        {manage && event?.template_id && action.phase && (
          <ActionButton
            action={pushActionToTemplate.bind(null, action.id)}
            label="Push to template"
            confirm="Update this event's template with this action (and add it to upcoming events from the same template)?"
          />
        )}
      </div>
      {action.phase === "during" && event && (
        <div className="mb-4">
          <Notice>During-event actions always carry the event date ({event.starts_at ? formatDate(todayIso(tz, new Date(event.starts_at))) : "not set yet"}).</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Details" className="lg:col-span-3">
          <ActionEditor
            action={action}
            events={events}
            owner={action.owner_person_id ? opt(action.owner_person_id) : null}
            backups={action.backup_owner_ids.map(opt)}
          />
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Status notes">
            {updates.length === 0 ? (
              <p className="text-sm text-muted">No notes yet.</p>
            ) : (
              <ol className="space-y-3">
                {[...updates].reverse().map((u, i) => (
                  <li key={i} className="rounded-lg bg-ground p-3 text-sm">
                    <p className="whitespace-pre-line">{u.text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {u.author} · {formatDateTime(u.date, tz)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-4">
              <ActionForm buttonsClassName="mt-3" action={addStatusUpdate.bind(null, action.id)} submitLabel="Add note" resetOnSuccess>
                <textarea name="text" rows={2} required className="crm-input" aria-label="Status note" placeholder="What happened, what's next" />
              </ActionForm>
            </div>
          </Card>
          {manage && (
            <Card title="Delete">
              <ActionButton action={deleteAction.bind(null, action.id)} label="Delete this action" variant="bad" confirm="Delete this action permanently?" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
