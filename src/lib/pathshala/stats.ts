// Pure helpers for the Pathshala Classes KPIs (unit-tested).

export type TermStats = {
  /** Students placed or active in a class this term. */
  students: number;
  /** Students on a class or level waitlist this term. */
  waitlisted: number;
  /** Distinct people teaching this term's classes. */
  teachers: number;
  /** Teachers whose current background check expires soon; null when the role cannot see checks. */
  backgroundChecksExpiring: number | null;
  /** Term attendance 0..1 (attended ÷ marked, excused left out); null before any marks. */
  attendanceRate: number | null;
  /** Gyan Path sign-offs waiting on a teacher; null when they could not be counted. */
  signoffsWaiting: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pick(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (k in o) return num(o[k]);
  }
  return null;
}

/**
 * Read app.pathshala_term_stats(p_term) defensively: it may return a json
 * object or a one-row table, and a few reasonable column names are accepted.
 * Attendance may come as a 0..1 ratio or a 0..100 percentage. Returns null
 * when the shape is not usable (the caller then counts directly).
 */
export function parseTermStats(raw: unknown): TermStats | null {
  const obj = Array.isArray(raw) ? raw[0] : raw;
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const students = pick(o, ["students", "students_placed", "placed", "student_count"]);
  const waitlisted = pick(o, ["waitlisted", "on_waitlists", "waitlist", "waitlist_count"]);
  const teachers = pick(o, ["teachers", "teacher_count"]);
  if (students === null || waitlisted === null || teachers === null) return null;
  let rate = pick(o, ["attendance_rate", "attendance", "attendance_pct", "attendance_percent"]);
  if (rate !== null && rate > 1) rate = rate / 100;
  return {
    students,
    waitlisted,
    teachers,
    backgroundChecksExpiring: pick(o, [
      "background_checks_expiring",
      "bg_checks_expiring",
      "checks_expiring",
      "background_checks_expiring_count",
    ]),
    attendanceRate: rate,
    signoffsWaiting: pick(o, ["signoffs_waiting", "signoffs_pending", "gyan_signoffs_waiting", "signoffs"]),
  };
}

/** How many expiry dates (YYYY-MM-DD) fall on or after `today` and on or before `until`. */
export function countExpiring(expiries: string[], today: string, until: string): number {
  return expiries.filter((d) => d >= today && d <= until).length;
}

/** "88%" or "—". */
export function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The Home task for the Pathshala principal (prototype): title "17 Gyan Path
 * sign-offs waiting on teachers · 3 background checks expire this month",
 * meta "12 students on class waitlists". Null when there is nothing to do.
 */
export function pathshalaHomeTask(stats: TermStats): { title: string; meta: string | null } | null {
  const parts: string[] = [];
  if (stats.signoffsWaiting) parts.push(`${count(stats.signoffsWaiting, "Gyan Path sign-off", "Gyan Path sign-offs")} waiting on teachers`);
  if (stats.backgroundChecksExpiring) {
    parts.push(`${count(stats.backgroundChecksExpiring, "background check expires", "background checks expire")} this month`);
  }
  const meta = stats.waitlisted ? `${count(stats.waitlisted, "student", "students")} on class waitlists` : null;
  if (parts.length === 0 && !meta) return null;
  return { title: parts.length ? parts.join(" · ") : (meta as string), meta: parts.length ? meta : null };
}
