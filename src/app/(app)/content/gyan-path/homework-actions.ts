"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { homeworkAreas } from "@/lib/gyan-homework/access";
import { saveAssignment, setAssignmentStatus } from "@/lib/gyan-homework/db";
import { assignmentFromForm, isAssignmentStatus, statusChangeDoing, statusChangeMessage } from "@/lib/gyan-homework/homework";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere } from "@/lib/session";

// Content › Gyan Path › level › Homework (0587). Who may: content.manage or pathshala.manage for any homework; a
// class Teacher for their own class (src/lib/gyan-homework/access.ts). The database checks the same rule and every
// field again, and its refusals are plain English, shown as they are.

const NEEDS = "content.manage, pathshala.manage, or a Teacher role for the class";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function saveAssignmentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the homework" : "add the homework";
  const auth = await authorizeActionWhere(homeworkAreas.editAny, doing, NEEDS);
  if (!auth.ok) return auth;
  const parsed = assignmentFromForm({
    id,
    level_id: text(fd, "level_id"),
    class_id: text(fd, "class_id"),
    title: text(fd, "title"),
    instructions_md: text(fd, "instructions_md"),
    allowed_kinds: fd.getAll("allowed_kinds").map((v) => String(v)),
    max_files: text(fd, "max_files"),
    points: text(fd, "points"),
    required_for_level: fd.get("required_for_level") === "on",
    due_kind: text(fd, "due_kind"),
    due_days: text(fd, "due_days"),
    due_date: text(fd, "due_date"),
    parent_check: text(fd, "parent_check"),
    reviewer: text(fd, "reviewer"),
    sort_order: text(fd, "sort_order"),
  });
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  if (!homeworkAreas.editFor(auth.session, parsed.value.class_id)) {
    return {
      ok: false,
      error: parsed.value.class_id
        ? `Could not ${doing} — you can only add homework for a class you teach.`
        : `Could not ${doing} — homework for everyone doing the level needs content.manage or pathshala.manage; choose one of your classes instead.`,
    };
  }
  const res = await saveAssignment(auth.session.db, auth.session.center.id, parsed.value);
  if (!res.ok) return failure(`Could not ${doing}`, res.error);
  revalidatePath("/content/gyan-path");
  return {
    ok: true,
    message: isUuid(id) ? `Homework "${res.value.title}" saved.` : `Homework "${res.value.title}" added as a draft. Publish it from the level when it is ready.`,
  };
}

export async function setAssignmentStatusAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const status = text(fd, "status");
  const doing = isAssignmentStatus(status) ? statusChangeDoing(status) : "change the homework's status";
  const auth = await authorizeActionWhere(homeworkAreas.editAny, doing, NEEDS);
  if (!auth.ok) return auth;
  if (!isUuid(id) || !isAssignmentStatus(status)) return { ok: false, error: `Could not ${doing} — the request was incomplete. Reload the page and try again.` };
  const res = await setAssignmentStatus(auth.session.db, id, status);
  if (!res.ok) return failure(`Could not ${doing}`, res.error);
  revalidatePath("/content/gyan-path");
  return { ok: true, message: statusChangeMessage(res.value.title, res.value.status) };
}
