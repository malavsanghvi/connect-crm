import { describe, expect, it } from "vitest";
import {
  classDaysInTerm,
  formatRate,
  latestClassDay,
  nextClassDay,
  summarizeAttendance,
} from "@/lib/logic/attendance";

describe("summarizeAttendance", () => {
  const roster = ["e1", "e2", "e3", "e4", "e5"];

  it("reports not taken when nothing is marked", () => {
    const s = summarizeAttendance(roster, []);
    expect(s).toMatchObject({ total: 5, unmarked: 5, attended: 0, rate: null, state: "not_taken" });
  });

  it("counts late as attended and leaves excused out of the rate", () => {
    const s = summarizeAttendance(roster, [
      { enrollment_id: "e1", status: "present" },
      { enrollment_id: "e2", status: "late" },
      { enrollment_id: "e3", status: "absent" },
      { enrollment_id: "e4", status: "excused" },
    ]);
    expect(s.present).toBe(1);
    expect(s.late).toBe(1);
    expect(s.absent).toBe(1);
    expect(s.excused).toBe(1);
    expect(s.attended).toBe(2);
    expect(s.unmarked).toBe(1);
    expect(s.state).toBe("partial");
    // 2 attended of 3 countable (4 marked - 1 excused)
    expect(s.rate).toBeCloseTo(2 / 3);
    expect(formatRate(s.rate)).toBe("67%");
  });

  it("is complete when every rostered student is marked", () => {
    const marks = roster.map((id) => ({ enrollment_id: id, status: "present" }));
    const s = summarizeAttendance(roster, marks);
    expect(s.state).toBe("complete");
    expect(s.rate).toBe(1);
  });

  it("ignores marks for students no longer on the roster and unknown statuses", () => {
    const s = summarizeAttendance(["e1"], [
      { enrollment_id: "gone", status: "present" },
      { enrollment_id: "e1", status: "maybe" },
    ]);
    expect(s.total).toBe(1);
    expect(s.unmarked).toBe(1);
    expect(s.state).toBe("not_taken");
  });

  it("has no rate when everyone marked is excused", () => {
    const s = summarizeAttendance(["e1"], [{ enrollment_id: "e1", status: "excused" }]);
    expect(s.rate).toBeNull();
    expect(formatRate(s.rate)).toBe("—");
  });
});

describe("class days", () => {
  it("finds the latest Sunday on or before a date", () => {
    expect(latestClassDay("2026-09-23")).toBe("2026-09-20"); // Wednesday -> previous Sunday
    expect(latestClassDay("2026-09-20")).toBe("2026-09-20"); // Sunday -> same day
  });

  it("finds the next Sunday on or after a date", () => {
    expect(nextClassDay("2026-09-23")).toBe("2026-09-27");
    expect(nextClassDay("2026-09-27")).toBe("2026-09-27");
  });

  it("lists term class days and skips no-class dates", () => {
    expect(classDaysInTerm("2026-09-01", "2026-09-30", "sunday", ["2026-09-13"])).toEqual([
      "2026-09-06",
      "2026-09-20",
      "2026-09-27",
    ]);
  });
});
