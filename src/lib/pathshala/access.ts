// Who can do what in Pathshala — the same checks connect-admin used
// (its lib/access.ts `areas`), expressed with the portal's permission
// helpers. Center-wide permissions come from center/platform grants only;
// a class teacher reaches their classes through a class-scoped Teacher
// grant (app.has_scoped_role). The UI uses this to decide what to show; RLS
// still enforces every row. Pure module: no server imports, unit-tested.

import { can, canAccess, hasRole, hasScopedRole, type ScopedContext } from "@/lib/permissions";

export const pathshalaAreas = {
  /** The principal's views: classes, terms, enrollments (pathshala.view or .manage). */
  admin: (c: ScopedContext) => canAccess(c, "pathshala"),
  /** Changing terms, classes, placements and teachers (pathshala.manage). */
  manage: (c: ScopedContext) => canAccess(c, "pathshalaManage"),
  /** Holds a Teacher role anywhere (a class, or center-wide). */
  teaches: (c: ScopedContext) => hasRole(c, "teacher"),
  signoffs: (c: ScopedContext) => canAccess(c, "pathshalaSignoffs") || hasRole(c, "teacher"),
  announcements: (c: ScopedContext) => canAccess(c, "pathshala") || hasRole(c, "teacher"),
  committee: (c: ScopedContext) => canAccess(c, "pathshalaCommittee"),
  /** Open one class: the principal's view, or a Teacher of that class. */
  classView: (c: ScopedContext, classId: string) => canAccess(c, "pathshala") || hasScopedRole(c, classId, "teacher"),
  /** Take attendance / show the class QR: a Teacher of that class, or the principal. */
  takeAttendance: (c: ScopedContext, classId: string) => hasScopedRole(c, classId, "teacher") || can(c, "pathshala.manage"),
  eventsView: (c: ScopedContext) => can(c, ["events.view", "events.manage"]),
  eventsManage: (c: ScopedContext) => can(c, "events.manage"),
};
