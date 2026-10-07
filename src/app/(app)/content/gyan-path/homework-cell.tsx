import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import { Badge } from "@/components/ui";
import {
  allowedKindsText,
  assignmentStatusActions,
  assignmentStatusLabel,
  assignmentStatusTone,
  audienceText,
  dueText,
  mayEditAssignment,
  parentCheckLabel,
  pointsText,
  readOnlyReason,
  reminderText,
  reviewerLabel,
  type Assignment,
  type EditableClasses,
} from "@/lib/gyan-homework/homework";

import { saveAssignmentAction, setAssignmentStatusAction } from "./homework-actions";
import { HomeworkFields, type ClassOption } from "./homework-fields";

/**
 * One level's homework (0587): each assignment with its status, what it asks and who it is for; Edit and the
 * status moves where this person may change it (mayEditAssignment: RLS shows a class teacher every published
 * homework, so the rest is marked read-only instead of offering a save the database would refuse); "Add homework"
 * at the end. Shared library levels get homework too — it is the community's own (the drawer says so).
 */
export function HomeworkCell({
  level,
  goalName,
  shared,
  assignments,
  canAdd,
  classes,
  canChooseEveryone,
  ownClasses,
  timeZone,
}: {
  level: { id: string; name: string };
  goalName: string;
  shared: boolean;
  assignments: Assignment[];
  /** May open "Add homework" (an editor whose classes could be read). */
  canAdd: boolean;
  classes: ClassOption[];
  /** content.manage or pathshala.manage: may set homework for everyone doing the level, and change any homework. */
  canChooseEveryone: boolean;
  /** Otherwise, the classes whose homework this person may change ("any" for a center-wide Teacher). */
  ownClasses: EditableClasses;
  timeZone: string;
}) {
  const className = (id: string | null) => (id ? (classes.find((c) => c.id === id)?.name ?? null) : null);
  return (
    <div className="flex min-w-[240px] flex-col gap-2 text-xs">
      {assignments.length === 0 && !canAdd ? <span className="text-muted">—</span> : null}
      {assignments.map((a) => {
        const moves = assignmentStatusActions(a.status);
        const editable = canAdd && mayEditAssignment(a, canChooseEveryone, ownClasses);
        const reminder = reminderText(a.remind_hours_before, a.due_rule);
        return (
          <div key={a.id} className="rounded-[10px] border border-line-soft bg-[#FBF7F0] px-2.5 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-bold text-ink">{a.title}</span>
              <Badge tone={assignmentStatusTone(a.status)}>{assignmentStatusLabel(a.status)}</Badge>
            </div>
            <div className="text-muted">
              {pointsText(a.points)} · {dueText(a.due_rule, timeZone)}
              {reminder ? ` · ${reminder}` : ""} · {audienceText(a.class_id, className(a.class_id))}
            </div>
            <div className="text-muted">
              Answer by {allowedKindsText(a.allowed_kinds)} · parent check: {parentCheckLabel(a.parent_check).toLowerCase()} · reviewed by {reviewerLabel(a.reviewer).toLowerCase()}
              {a.required_for_level ? " · required for the level" : ""}
            </div>
            {editable ? (
              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5">
                <DrawerForm
                  label="Edit"
                  variant="ghost"
                  size="xs"
                  kicker={`${goalName} · ${level.name}`}
                  title={a.title}
                  subtitle={shared ? "Homework is yours even though the lesson is shared" : undefined}
                  action={saveAssignmentAction}
                  submitLabel="Save homework"
                  resetOnSuccess={false}
                >
                  <HomeworkFields levelId={level.id} levelName={level.name} assignment={a} classes={classes} canChooseEveryone={canChooseEveryone} shared={shared} nextOrder={a.sort_order} />
                </DrawerForm>
                {moves.length ? <RowActions action={setAssignmentStatusAction} fields={{ id: a.id }} fieldName="status" buttons={moves} /> : null}
              </div>
            ) : canAdd ? (
              <div className="mt-1 text-muted">{readOnlyReason(a)} · read-only</div>
            ) : null}
          </div>
        );
      })}
      {canAdd ? (
        <div className="flex justify-end">
          <DrawerForm
            label="Add homework"
            variant="ghost"
            size="xs"
            kicker={`${goalName} · ${level.name}`}
            title="New homework"
            subtitle={shared ? "Homework is yours even though the lesson is shared" : "Saved as a draft until you publish it"}
            action={saveAssignmentAction}
            submitLabel="Save as draft"
          >
            <HomeworkFields levelId={level.id} levelName={level.name} classes={classes} canChooseEveryone={canChooseEveryone} shared={shared} nextOrder={assignments.length + 1} />
          </DrawerForm>
        </div>
      ) : null}
    </div>
  );
}
