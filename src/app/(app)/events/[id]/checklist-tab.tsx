import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { PersonPicker } from "@/components/events/person-picker";
import { BlockGrid, Card, EmptyState, StatusText } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { load, resolvePeopleNames, row, rows } from "@/lib/data/events";
import { todayInTz } from "@/lib/dates";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { PHASE_LABEL, dueBadge } from "@/lib/events/checklist";
import { formatDateTime, humanize } from "@/lib/events/format";
import type { CrmSession } from "@/lib/session";

import { addChecklistAction, addLesson, pushLessonsToTemplate, removeLesson, setChecklistState } from "../actions";

type Lesson = { id: string; text: string; author: string; created_at: string };

export async function ChecklistTab({ event, session, access }: { event: Tables<"events">; session: CrmSession; access: EventAccess }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const res = await load(async () => {
    const actions = rows(await db.from("actions").select("*").eq("event_id", event.id).order("due_on", { nullsFirst: false }), "the checklist");
    const template = event.template_id ? row(await db.from("event_templates").select("id, name").eq("id", event.template_id).maybeSingle(), "the template name") : null;
    return { actions, template, names: await resolvePeopleNames(db, actions.map((a) => a.owner_person_id)) };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/events/${event.id}?tab=checklist`} />;
  const { actions, template, names } = res.data;
  const canEdit = eventAreas.edit(access, event.id);
  const lessons: Lesson[] = Array.isArray(event.lessons_learned) ? (event.lessons_learned as Lesson[]) : [];
  const standalone = actions.filter((a) => !a.phase);

  const actionRow = (a: (typeof actions)[number]) => {
    const badge = dueBadge(a, today);
    return (
      <li key={a.id} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-ink">{a.name}</p>
          <p className="text-xs text-muted">
            {a.owner_person_id ? `Owner: ${names.get(a.owner_person_id) ?? "Someone"}` : "No owner"}
            {a.due_on ? ` · due ${a.due_on}` : ""}
            {a.action_type !== "task" ? ` · ${humanize(a.action_type)}` : ""}
            {a.priority === "high" || a.priority === "critical" ? ` · ${humanize(a.priority)} priority` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-[13px]">
          {!a.owner_person_id && a.state !== "completed" ? <StatusText tone="bad">Unassigned</StatusText> : null}
          <span className={badge.tone === "bad" ? "cc-status-bad" : badge.tone === "warn" ? "cc-status-warn" : badge.tone === "ok" ? "cc-status-ok" : "font-semibold text-muted"}>
            {badge.label}
          </span>
          {a.state === "in_progress" ? <span className="font-bold text-navy">In progress</span> : null}
          {canEdit && a.state !== "completed" && a.state !== "removed" ? (
            <ActionButton action={setChecklistState.bind(null, event.id, a.id)} fields={{ state: "completed" }} label="✓ Done" variant="ok" />
          ) : null}
          {canEdit && a.state === "completed" ? (
            <ActionButton action={setChecklistState.bind(null, event.id, a.id)} fields={{ state: "not_started" }} label="Reopen" />
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <BlockGrid>
      <div className="col-span-12 flex flex-col gap-4 lg:col-span-8">
        {template ? (
          <p className="text-[13px] text-muted">
            Made from the committee template <strong className="text-ink">{template.name}</strong>. Lessons learned here can be pushed back to it.
          </p>
        ) : null}
        {(["pre", "during", "after"] as const).map((phase) => {
          const list = actions.filter((a) => a.phase === phase);
          const done = list.filter((a) => a.state === "completed").length;
          return (
            <Card key={phase} title={`${PHASE_LABEL[phase]} the event`} description={`${done} of ${list.length} done`}>
              {list.length === 0 ? <p className="text-[13px] text-muted">Nothing in this phase.</p> : <ul className="divide-y divide-line-soft">{list.map(actionRow)}</ul>}
            </Card>
          );
        })}
        {standalone.length > 0 ? (
          <Card title="Other actions for this event">
            <ul className="divide-y divide-line-soft">{standalone.map(actionRow)}</ul>
          </Card>
        ) : null}
        {actions.length === 0 ? (
          <Card>
            <EmptyState title="No checklist yet">Add actions below, or create events from a committee template to start with a checklist.</EmptyState>
          </Card>
        ) : null}
        {canEdit ? (
          <Card title="Add an action to this event">
            <ActionForm action={addChecklistAction.bind(null, event.id)} submitLabel="Add action" resetOnSuccess>
              <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label htmlFor="ck-name" className="crm-label">
                    Action
                  </label>
                  <input id="ck-name" name="name" required className="crm-input" />
                </div>
                <div>
                  <label htmlFor="ck-phase" className="crm-label">
                    Phase
                  </label>
                  <select id="ck-phase" name="phase" defaultValue="pre" className="crm-input">
                    <option value="pre">Before the event</option>
                    <option value="during">During the event (uses the event date)</option>
                    <option value="after">After the event</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="ck-due" className="crm-label">
                    Due date
                  </label>
                  <input id="ck-due" type="date" name="due_on" className="crm-input" />
                </div>
                <div>
                  <label htmlFor="ck-prio" className="crm-label">
                    Priority
                  </label>
                  <select id="ck-prio" name="priority" defaultValue="medium" className="crm-input">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <PersonPicker name="owner_person_id" label="Owner" />
                <div className="md:col-span-2">
                  <label htmlFor="ck-desc" className="crm-label">
                    Details
                  </label>
                  <textarea id="ck-desc" name="description" rows={2} className="crm-input" />
                </div>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
      <Card span={4} title="Lessons learned">
        {lessons.length === 0 ? (
          <p className="text-[13px] text-muted">Capture what to repeat or change next time.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lessons.map((l) => (
              <li key={l.id} className="rounded-[10px] bg-ground p-3 text-[13px]">
                <p className="whitespace-pre-line">{l.text}</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {l.author} · {formatDateTime(l.created_at, tz)}
                  </span>
                  {canEdit ? <ActionButton action={removeLesson.bind(null, event.id, l.id)} label="Remove" variant="bad" confirm="Remove this lesson?" /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <div className="mt-3">
            <ActionForm action={addLesson.bind(null, event.id)} submitLabel="Add lesson" size="sm" resetOnSuccess>
              <textarea name="text" rows={2} required className="crm-input mb-2" aria-label="Lesson learned" />
            </ActionForm>
          </div>
        ) : null}
        {template && lessons.length > 0 && eventAreas.manage(access) ? (
          <div className="mt-3 border-t border-line-soft pt-3">
            <ActionButton action={pushLessonsToTemplate.bind(null, event.id)} label="Push lessons to the template" size="sm" />
          </div>
        ) : null}
      </Card>
    </BlockGrid>
  );
}
