// Who may write and review homework (docs/LEARNING_ASSIGNMENTS_PLAN.md H2, H4), expressed with the portal's
// permission helpers the way src/lib/pathshala/access.ts does. Center-wide permissions come from center/platform
// grants only; a class teacher reaches their own class through a class-scoped Teacher grant. The UI uses this to
// decide what to show; the database (app.save_gyan_assignment, app.review_gyan_submission, RLS) enforces every row.

import { can, canAccess, hasRole, hasScopedRole, type ScopedContext } from "@/lib/permissions";

export const homeworkAreas = {
  /** Homework for everyone doing a level, on any level: content.manage or pathshala.manage. */
  editAll: (c: ScopedContext) => can(c, ["content.manage", "pathshala.manage"]),
  /** May open the editor at all: editAll, or a Teacher somewhere (then only for their own classes). */
  editAny: (c: ScopedContext) => homeworkAreas.editAll(c) || hasRole(c, "teacher"),
  /** May save homework with this audience: everyone (null) needs editAll; one class needs editAll or the Teacher role for that class. */
  editFor: (c: ScopedContext, classId: string | null) => homeworkAreas.editAll(c) || (classId !== null && hasScopedRole(c, classId, "teacher")),
  /** May open Pathshala › Homework: pathshala.teach, pathshala.manage, content.manage (the content reviewer), or a Teacher somewhere. */
  review: (c: ScopedContext) => canAccess(c, "pathshalaHomework") || hasRole(c, "teacher"),
};
