"use client";

import { useState } from "react";

import { Toggle } from "@/components/controls";
import {
  DEFAULT_MAX_FILES,
  DEFAULT_POINTS,
  DUE_DAYS_MAX,
  DUE_DAYS_MIN,
  INSTRUCTIONS_MAX,
  KIND_OPTIONS,
  MAX_FILES_MAX,
  MAX_FILES_MIN,
  PARENT_CHECK_OPTIONS,
  POINTS_MAX,
  REMIND_HOURS_MAX,
  REMIND_HOURS_MIN,
  REVIEWER_OPTIONS,
  TITLE_MAX,
  type Assignment,
  type DueKind,
} from "@/lib/gyan-homework/homework";

export type ClassOption = { id: string; name: string };

/**
 * The fields of the Homework drawer (add or edit), named as app.save_gyan_assignment reads them. The due rule
 * shows only the input its kind needs, and the reminder (0588) only when there is a due date; everything else is
 * plain form controls so a failed save keeps what was typed.
 */
export function HomeworkFields({
  levelId,
  levelName,
  assignment,
  classes,
  canChooseEveryone,
  shared,
  nextOrder,
}: {
  levelId: string;
  levelName: string;
  assignment?: Assignment;
  /** The classes this person may pick (this term's, or the ones they teach). */
  classes: ClassOption[];
  /** content.manage or pathshala.manage: "Everyone doing the level" is offered; a class teacher must pick one of their classes. */
  canChooseEveryone: boolean;
  /** The level belongs to a shared library goal: the homework is still the community's own. */
  shared: boolean;
  nextOrder: number;
}) {
  const p = assignment ? `hw-${assignment.id.slice(0, 8)}` : `hw-new-${levelId.slice(0, 8)}`;
  const [dueKind, setDueKind] = useState<DueKind>(assignment?.due_rule.kind ?? "none");
  const kinds = assignment?.allowed_kinds ?? ["photo", "voice", "text"];
  const dueDays = assignment?.due_rule.kind === "days_after_start" ? assignment.due_rule.days : 7;
  const dueDate = assignment?.due_rule.kind === "on" ? assignment.due_rule.date : "";
  // A class the editor cannot pick any more (another term, another teacher) stays selectable so an edit does not drop it.
  const currentClass = assignment?.class_id && !classes.some((c) => c.id === assignment.class_id) ? assignment.class_id : null;
  return (
    <>
      <input type="hidden" name="level_id" value={levelId} />
      {assignment ? <input type="hidden" name="id" value={assignment.id} /> : null}
      {shared ? (
        <p className="rounded-[10px] border border-navy/20 bg-navy-50 px-3 py-2 text-[13px] text-navy">
          Homework is yours even though the lesson is shared: it belongs to your community and only your learners see it. The shared lesson itself
          does not change.
        </p>
      ) : null}
      <div>
        <label htmlFor={`${p}-title`} className="crm-label">
          Title
        </label>
        <input id={`${p}-title`} name="title" required maxLength={TITLE_MAX} defaultValue={assignment?.title ?? ""} placeholder="Record yourself saying the Navkar Mantra" className="crm-input" />
        <p className="crm-hint">Up to {TITLE_MAX} characters; learners see it on the level “{levelName}”.</p>
      </div>
      <div>
        <label htmlFor={`${p}-inst`} className="crm-label">
          Instructions
        </label>
        <textarea
          id={`${p}-inst`}
          name="instructions_md"
          rows={5}
          maxLength={INSTRUCTIONS_MAX}
          defaultValue={assignment?.instructions_md ?? ""}
          className="crm-input"
          placeholder="What to do, and what a good answer looks like."
        />
        <p className="crm-hint">Markdown works: **bold**, lists and links. Up to {INSTRUCTIONS_MAX.toLocaleString("en-US")} characters.</p>
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[13px] font-bold">Ways to answer</legend>
        {KIND_OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-10 cursor-pointer items-start gap-3 py-1.5">
            <input type="checkbox" name="allowed_kinds" value={o.value} defaultChecked={kinds.includes(o.value)} className="mt-0.5 h-5 w-5 shrink-0 accent-navy" />
            <span>
              <span className="text-[13px] font-bold text-ink">{o.label}</span>
              <span className="block text-xs text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
        <div className="mt-2">
          <label htmlFor={`${p}-max`} className="crm-label">
            Files per answer
          </label>
          <input id={`${p}-max`} name="max_files" inputMode="numeric" defaultValue={assignment?.max_files ?? DEFAULT_MAX_FILES} className="crm-input w-24" />
          <p className="crm-hint">
            {MAX_FILES_MIN} to {MAX_FILES_MAX} photos, files or voice notes in one answer; 25 MB each.
          </p>
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${p}-pts`} className="crm-label">
            Points
          </label>
          <input id={`${p}-pts`} name="points" inputMode="numeric" defaultValue={assignment?.points ?? DEFAULT_POINTS} className="crm-input" />
          <p className="crm-hint">0 to {POINTS_MAX.toLocaleString("en-US")}; paid once, when the reviewer accepts.</p>
        </div>
        <div>
          <label htmlFor={`${p}-ord`} className="crm-label">
            Order
          </label>
          <input id={`${p}-ord`} name="sort_order" inputMode="numeric" defaultValue={assignment?.sort_order ?? nextOrder} className="crm-input" />
        </div>
      </div>
      <Toggle
        name="required_for_level"
        label="Required for the level"
        defaultChecked={assignment?.required_for_level ?? false}
        onNote="The level stays incomplete until this homework is accepted"
        offNote="Optional: the level completes without it"
      />
      <div>
        <label htmlFor={`${p}-due`} className="crm-label">
          Due
        </label>
        <select id={`${p}-due`} name="due_kind" value={dueKind} onChange={(e) => setDueKind(e.target.value as DueKind)} className="crm-input">
          <option value="none">No due date</option>
          <option value="days_after_start">Some days after the learner starts the level</option>
          <option value="on">On a date</option>
        </select>
        {dueKind === "days_after_start" ? (
          <div className="mt-2">
            <label htmlFor={`${p}-days`} className="crm-label">
              Days after starting the level
            </label>
            <input id={`${p}-days`} name="due_days" inputMode="numeric" defaultValue={dueDays} className="crm-input w-24" />
            <p className="crm-hint">
              {DUE_DAYS_MIN} to {DUE_DAYS_MAX} days, counted from the learner&apos;s first completed step of the level (else from the day it was published).
            </p>
          </div>
        ) : null}
        {dueKind === "on" ? (
          <div className="mt-2">
            <label htmlFor={`${p}-date`} className="crm-label">
              Due date
            </label>
            <input id={`${p}-date`} name="due_date" type="date" defaultValue={dueDate} className="crm-input" />
          </div>
        ) : null}
        {dueKind !== "none" ? (
          <div className="mt-2">
            <label htmlFor={`${p}-remind`} className="crm-label">
              Remind (hours before it is due)
            </label>
            <input
              id={`${p}-remind`}
              name="remind_hours"
              inputMode="numeric"
              defaultValue={assignment?.remind_hours_before ?? ""}
              placeholder="No reminder"
              className="crm-input w-32"
            />
            <p className="crm-hint">
              Empty = no reminder. {REMIND_HOURS_MIN} to {REMIND_HOURS_MAX} hours (30 days): the learners who have not handed it in yet — and the parents of
              children — get a push and an email that many hours before the end of the due day. Pushes wait for the community&apos;s quiet hours.
            </p>
          </div>
        ) : null}
        <p className="crm-hint">
          Due dates are information, not gates: a late hand-in is marked late, never refused. A reminder goes out only if you set one (it needs a due
          date): that many hours before the end of the due day, and only to the learners who have not handed in yet.
        </p>
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[13px] font-bold">A parent checks first</legend>
        {PARENT_CHECK_OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-10 cursor-pointer items-start gap-3 py-1.5">
            <input type="radio" name="parent_check" value={o.value} defaultChecked={(assignment?.parent_check ?? "children") === o.value} className="mt-0.5 h-5 w-5 shrink-0 accent-navy" />
            <span>
              <span className="text-[13px] font-bold text-ink">{o.label}</span>
              <span className="block text-xs text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-[13px] font-bold">Who reviews</legend>
        {REVIEWER_OPTIONS.map((o) => (
          <label key={o.value} className="flex min-h-10 cursor-pointer items-start gap-3 py-1.5">
            <input type="radio" name="reviewer" value={o.value} defaultChecked={(assignment?.reviewer ?? "teacher") === o.value} className="mt-0.5 h-5 w-5 shrink-0 accent-navy" />
            <span>
              <span className="text-[13px] font-bold text-ink">{o.label}</span>
              <span className="block text-xs text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <label htmlFor={`${p}-class`} className="crm-label">
          Who gets it
        </label>
        <select id={`${p}-class`} name="class_id" defaultValue={assignment?.class_id ?? ""} className="crm-input">
          {canChooseEveryone ? <option value="">Everyone doing the level</option> : null}
          {currentClass ? <option value={currentClass}>The class it is for now</option> : null}
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              Only {c.name}
            </option>
          ))}
        </select>
        <p className="crm-hint">
          {canChooseEveryone
            ? "Everyone who does the level, or only the students placed in one of this term's classes."
            : classes.length
              ? "As a class teacher you add homework for the classes you teach."
              : "As a class teacher you add homework for the classes you teach — none of this term's classes is yours yet, so this cannot be saved."}
        </p>
      </div>
      {assignment?.status === "published" ? (
        <p className="crm-hint">This homework is published: changes reach learners as soon as they are saved.</p>
      ) : (
        <p className="crm-hint">Saved as a draft: learners see it once you publish it from the level.</p>
      )}
    </>
  );
}
