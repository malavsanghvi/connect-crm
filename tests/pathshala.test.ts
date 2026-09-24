import { describe, expect, it } from "vitest";

import { pathshalaAreas } from "@/lib/pathshala/access";
import { classTimeLabel, clockTime } from "@/lib/pathshala/format";
import { countExpiring, parseTermStats, pathshalaHomeTask, percent } from "@/lib/pathshala/stats";
import {
  activeModule,
  activeTabHref,
  canOpenTab,
  hasCenterRole,
  hasRole,
  hasScopedRole,
  teacherClassIds,
  visibleNav,
  type ScopedContext,
} from "@/lib/permissions";

const teacherOnly: ScopedContext = {
  permissions: [],
  isPlatformAdmin: false,
  grants: [{ role_key: "teacher", scope_kind: "class", scope_id: "c1" }],
};
const principal: ScopedContext = {
  permissions: ["pathshala.view", "pathshala.manage", "pathshala.teach", "events.view", "governance.view", "safety.view"],
  isPlatformAdmin: false,
  grants: [{ role_key: "pathshala_principal", scope_kind: "center", scope_id: null }],
};

describe("scoped roles (mirror app.has_scoped_role)", () => {
  it("a class teacher holds the role for that class only, and no center permissions", () => {
    expect(hasScopedRole(teacherOnly, "c1", "teacher")).toBe(true);
    expect(hasScopedRole(teacherOnly, "c2", "teacher")).toBe(false);
    expect(hasRole(teacherOnly, "teacher")).toBe(true);
    expect(hasCenterRole(teacherOnly, "teacher")).toBe(false);
    expect(teacherClassIds(teacherOnly)).toEqual(["c1"]);
  });
  it("a center-wide teacher grant covers every class", () => {
    const ctx: ScopedContext = { permissions: ["pathshala.teach"], isPlatformAdmin: false, grants: [{ role_key: "teacher", scope_kind: "center", scope_id: null }] };
    expect(hasScopedRole(ctx, "any-class", "teacher")).toBe(true);
    expect(hasCenterRole(ctx, "teacher")).toBe(true);
    expect(teacherClassIds(ctx)).toEqual([]);
  });
  it("without grants nothing is held; platform admins hold all", () => {
    expect(hasRole({ permissions: [], isPlatformAdmin: false }, "teacher")).toBe(false);
    expect(hasScopedRole({ permissions: [], isPlatformAdmin: true }, "c9", "teacher")).toBe(true);
  });
});

describe("Pathshala areas (same checks as connect-admin)", () => {
  it("teachers with only a class-scoped role reach their class, attendance and sign-offs — not the principal's views", () => {
    expect(pathshalaAreas.admin(teacherOnly)).toBe(false);
    expect(pathshalaAreas.manage(teacherOnly)).toBe(false);
    expect(pathshalaAreas.teaches(teacherOnly)).toBe(true);
    expect(pathshalaAreas.signoffs(teacherOnly)).toBe(true);
    expect(pathshalaAreas.announcements(teacherOnly)).toBe(true);
    expect(pathshalaAreas.classView(teacherOnly, "c1")).toBe(true);
    expect(pathshalaAreas.classView(teacherOnly, "c2")).toBe(false);
    expect(pathshalaAreas.takeAttendance(teacherOnly, "c1")).toBe(true);
    expect(pathshalaAreas.takeAttendance(teacherOnly, "c2")).toBe(false);
    expect(pathshalaAreas.committee(teacherOnly)).toBe(false);
  });
  it("the principal manages everything", () => {
    expect(pathshalaAreas.admin(principal)).toBe(true);
    expect(pathshalaAreas.manage(principal)).toBe(true);
    expect(pathshalaAreas.takeAttendance(principal, "c2")).toBe(true);
    expect(pathshalaAreas.committee(principal)).toBe(true);
  });
  it("pathshala.view alone reads but cannot change or take attendance", () => {
    const viewer: ScopedContext = { permissions: ["pathshala.view"], isPlatformAdmin: false, grants: [] };
    expect(pathshalaAreas.admin(viewer)).toBe(true);
    expect(pathshalaAreas.manage(viewer)).toBe(false);
    expect(pathshalaAreas.takeAttendance(viewer, "c1")).toBe(false);
    expect(pathshalaAreas.signoffs(viewer)).toBe(false);
  });
});

describe("Pathshala navigation", () => {
  it("shows the principal the prototype tabs first, then the kept extras", () => {
    const m = visibleNav(principal).find((x) => x.key === "pathshala");
    expect(m?.href).toBe("/pathshala");
    expect(m?.tabs.map((t) => t.label)).toEqual(["Classes", "Gyan Path sign-offs", "Terms", "Enrollments", "Teacher positions", "Committee"]);
  });
  it("shows a class-scoped teacher the module, landing on My classes", () => {
    const m = visibleNav(teacherOnly).find((x) => x.key === "pathshala");
    expect(m?.href).toBe("/pathshala/my-classes");
    expect(m?.tabs.map((t) => t.href)).toEqual(["/pathshala/signoffs", "/pathshala/my-classes"]);
  });
  it("hides Pathshala from a user with neither the permission nor a teacher role", () => {
    const ctx: ScopedContext = { permissions: ["giving.view"], isPlatformAdmin: false, grants: [{ role_key: "event_lead", scope_kind: "event", scope_id: "e1" }] };
    expect(visibleNav(ctx).some((m) => m.key === "pathshala")).toBe(false);
  });
  it("opens a tab by its access key or by a role", () => {
    expect(canOpenTab(teacherOnly, { roles: ["teacher"] })).toBe(true);
    expect(canOpenTab(teacherOnly, { access: "pathshala" })).toBe(false);
    expect(canOpenTab(principal, { access: "pathshala" })).toBe(true);
    expect(canOpenTab(principal, {})).toBe(false);
  });
  it("keeps class pages under the Classes tab", () => {
    const mods = visibleNav(principal);
    const m = activeModule(mods, "/pathshala/classes/abc/attendance");
    expect(m?.key).toBe("pathshala");
    expect(activeTabHref(m!.tabs, "/pathshala/classes/abc")).toBe("/pathshala");
    expect(activeTabHref(m!.tabs, "/pathshala/committee/concerns")).toBe("/pathshala/committee");
  });
});

describe("class time label (prototype 'Sun 10 AM')", () => {
  it("formats day and 12-hour time", () => {
    expect(classTimeLabel("sunday", "10:00:00")).toBe("Sun 10 AM");
    expect(classTimeLabel("Sunday", "11:30")).toBe("Sun 11:30 AM");
    expect(classTimeLabel("saturday", "16:05")).toBe("Sat 4:05 PM");
    expect(classTimeLabel("sunday", null)).toBe("Sun");
    expect(classTimeLabel(null, null)).toBe("—");
  });
  it("handles midnight and noon", () => {
    expect(clockTime("00:15")).toBe("12:15 AM");
    expect(clockTime("12:00")).toBe("12 PM");
    expect(clockTime("25:00")).toBeNull();
  });
});

describe("term stats", () => {
  it("reads app.pathshala_term_stats as an object or a one-row table", () => {
    const row = { students: 420, waitlisted: 12, teachers: 48, background_checks_expiring: 3, attendance_rate: 0.88, signoffs_waiting: 17 };
    const expected = { students: 420, waitlisted: 12, teachers: 48, backgroundChecksExpiring: 3, attendanceRate: 0.88, signoffsWaiting: 17 };
    expect(parseTermStats(row)).toEqual(expected);
    expect(parseTermStats([row])).toEqual(expected);
  });
  it("accepts a percentage and alternative names", () => {
    const s = parseTermStats({ students_placed: "10", on_waitlists: 0, teacher_count: 2, attendance_pct: 75, signoffs_pending: null });
    expect(s).toEqual({ students: 10, waitlisted: 0, teachers: 2, backgroundChecksExpiring: null, attendanceRate: 0.75, signoffsWaiting: null });
  });
  it("rejects unusable shapes so the caller counts directly", () => {
    expect(parseTermStats(null)).toBeNull();
    expect(parseTermStats([])).toBeNull();
    expect(parseTermStats({ students: 1 })).toBeNull();
    expect(parseTermStats("x")).toBeNull();
  });
  it("counts expiries inside the window", () => {
    expect(countExpiring(["2026-09-23", "2026-09-24", "2026-10-24", "2026-10-25"], "2026-09-24", "2026-10-24")).toBe(2);
  });
  it("formats a rate", () => {
    expect(percent(0.876)).toBe("88%");
    expect(percent(null)).toBe("—");
  });
});

describe("Pathshala Home task", () => {
  const base = { students: 420, waitlisted: 12, teachers: 48, backgroundChecksExpiring: 3, attendanceRate: 0.88, signoffsWaiting: 17 };
  it("reads like the prototype", () => {
    expect(pathshalaHomeTask(base)).toEqual({
      title: "17 Gyan Path sign-offs waiting on teachers · 3 background checks expire this month",
      meta: "12 students on class waitlists",
    });
  });
  it("uses singulars and drops empty parts", () => {
    expect(pathshalaHomeTask({ ...base, signoffsWaiting: 1, backgroundChecksExpiring: 0, waitlisted: 1 })).toEqual({
      title: "1 Gyan Path sign-off waiting on teachers",
      meta: "1 student on class waitlists",
    });
    expect(pathshalaHomeTask({ ...base, signoffsWaiting: 0, backgroundChecksExpiring: null, waitlisted: 4 })).toEqual({
      title: "4 students on class waitlists",
      meta: null,
    });
  });
  it("is null when there is nothing to do", () => {
    expect(pathshalaHomeTask({ ...base, signoffsWaiting: 0, backgroundChecksExpiring: 0, waitlisted: 0 })).toBeNull();
  });
});
