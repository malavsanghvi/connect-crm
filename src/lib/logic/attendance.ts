// Pathshala attendance: summaries for a session and "which Sunday" helpers.

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export function isAttendanceStatus(v: unknown): v is AttendanceStatus {
  return typeof v === "string" && (ATTENDANCE_STATUSES as readonly string[]).includes(v);
}

export type AttendanceSummary = {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  /** present + late */
  attended: number;
  /** attended / (marked - excused), 0..1, or null when nothing countable yet */
  rate: number | null;
  state: "not_taken" | "partial" | "complete";
};

/**
 * Summarize one session. `rosterIds` are the enrollments expected in class;
 * marks for students no longer on the roster are ignored.
 */
export function summarizeAttendance(
  rosterIds: string[],
  marks: { enrollment_id: string; status: string }[],
): AttendanceSummary {
  const roster = new Set(rosterIds);
  const byStudent = new Map<string, AttendanceStatus>();
  for (const m of marks) {
    if (roster.has(m.enrollment_id) && isAttendanceStatus(m.status)) byStudent.set(m.enrollment_id, m.status);
  }
  const count = (s: AttendanceStatus) => [...byStudent.values()].filter((v) => v === s).length;
  const present = count("present");
  const late = count("late");
  const absent = count("absent");
  const excused = count("excused");
  const marked = byStudent.size;
  const total = roster.size;
  const unmarked = total - marked;
  const attended = present + late;
  const countable = marked - excused;
  return {
    total,
    present,
    late,
    absent,
    excused,
    unmarked,
    attended,
    rate: countable > 0 ? attended / countable : null,
    state: marked === 0 ? "not_taken" : unmarked === 0 ? "complete" : "partial",
  };
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseIsoDate(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The most recent class day on or before `todayIso` (e.g. last Sunday, or today if it is Sunday). */
export function latestClassDay(todayIso: string, meetsOn = "sunday"): string {
  const target = Math.max(0, WEEKDAYS.indexOf(meetsOn.toLowerCase()));
  const d = parseIsoDate(todayIso);
  const back = (d.getUTCDay() - target + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return toIsoDate(d);
}

/** The next class day on or after `todayIso`. */
export function nextClassDay(todayIso: string, meetsOn = "sunday"): string {
  const target = Math.max(0, WEEKDAYS.indexOf(meetsOn.toLowerCase()));
  const d = parseIsoDate(todayIso);
  const ahead = (target - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  return toIsoDate(d);
}

/** Class days in a term, skipping no-class dates. */
export function classDaysInTerm(startsOn: string, endsOn: string, meetsOn = "sunday", noClass: string[] = []): string[] {
  const skip = new Set(noClass);
  const out: string[] = [];
  let cur = nextClassDay(startsOn, meetsOn);
  while (cur <= endsOn) {
    if (!skip.has(cur)) out.push(cur);
    const d = parseIsoDate(cur);
    d.setUTCDate(d.getUTCDate() + 7);
    cur = toIsoDate(d);
  }
  return out;
}

/**
 * Counts for a progress report (pathshala_progress_reports.attendance_*):
 * excused days are left out of the total, as they are for the class rate.
 */
export function reportAttendance(statuses: readonly string[]): { present: number; late: number; total: number } {
  let present = 0;
  let late = 0;
  let total = 0;
  for (const s of statuses) {
    if (s === "excused") continue;
    if (s === "present") present += 1;
    else if (s === "late") late += 1;
    else if (s !== "absent") continue;
    total += 1;
  }
  return { present, late, total };
}
