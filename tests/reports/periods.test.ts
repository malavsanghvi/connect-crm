import { describe, expect, it } from "vitest";

import { chosenYear, compareMonths, daysInMonth, lastDays, monthLabel, pctChange, pctText, sameDayLastYear, yearWindow } from "@/lib/reports/periods";

describe("days", () => {
  it("knows leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
  });
  it("takes the same day a year earlier, and February 29 becomes February 28", () => {
    expect(sameDayLastYear("2026-10-10")).toBe("2025-10-10");
    expect(sameDayLastYear("2024-02-29")).toBe("2023-02-28");
    expect(sameDayLastYear("2025-02-28")).toBe("2024-02-28");
    expect(sameDayLastYear("not a day")).toBe("not a day");
  });
  it("lists the last days up to and including today", () => {
    expect(lastDays("2026-10-10", 30)).toEqual({ from: "2026-09-11", to: "2026-10-10" });
    expect(lastDays("2026-10-10", 1)).toEqual({ from: "2026-10-10", to: "2026-10-10" });
  });
});

describe("the year a report covers", () => {
  it("runs to today in the current year and compares with the same days last year", () => {
    expect(yearWindow(2026, 2026, "2026-10-10")).toEqual({
      year: 2026,
      label: "2026",
      isCurrentYear: true,
      from: "2026-01-01",
      yearEnd: "2026-12-31",
      periodEnd: "2026-10-10",
      prevFrom: "2025-01-01",
      prevEnd: "2025-10-10",
    });
  });
  it("runs the whole year for any other year", () => {
    expect(yearWindow(2024, 2026, "2026-10-10")).toMatchObject({ isCurrentYear: false, periodEnd: "2024-12-31", prevFrom: "2023-01-01", prevEnd: "2023-12-31" });
  });
  it("handles February 29 as 'today' (the old page asked the database for a day that did not exist)", () => {
    expect(yearWindow(2028, 2028, "2028-02-29").prevEnd).toBe("2027-02-28");
  });
  it("accepts a year from 1991 to next year and anything else means this year", () => {
    expect(chosenYear(2024, 2026)).toBe(2024);
    expect(chosenYear(2027, 2026)).toBe(2027);
    expect(chosenYear(2028, 2026)).toBe(2026);
    expect(chosenYear(1990, 2026)).toBe(2026);
    expect(chosenYear(Number.NaN, 2026)).toBe(2026);
    expect(chosenYear(2024.5, 2026)).toBe(2026);
  });
});

describe("change against before", () => {
  it("is a signed whole percent, or nothing when there is nothing to compare with", () => {
    expect(pctText(150, 100)).toBe("+50%");
    expect(pctText(100, 100)).toBe("+0%");
    expect(pctText(50, 100)).toBe("-50%");
    expect(pctText(5, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(1, 0)).toBeNull();
    expect(pctChange(1, 3)).toBe(-67);
  });
});

describe("this month with last month", () => {
  it("compares the month in progress with the same days of the month before", () => {
    const r = compareMonths("2026-10-10");
    expect(r).toEqual({
      ok: true,
      partial: true,
      current: { month: "2026-10", label: "October 2026", from: "2026-10-01", to: "2026-10-10" },
      previous: { month: "2026-09", label: "September 2026", from: "2026-09-01", to: "2026-09-10" },
      previousFull: { month: "2026-09", label: "September 2026", from: "2026-09-01", to: "2026-09-30" },
    });
  });
  it("squeezes the same days into a shorter month before (March 31 against February)", () => {
    const r = compareMonths("2026-03-31");
    expect(r).toMatchObject({ ok: true, partial: true, current: { to: "2026-03-31" }, previous: { from: "2026-02-01", to: "2026-02-28" }, previousFull: { to: "2026-02-28" } });
  });
  it("compares a finished month in full with the month before it", () => {
    const r = compareMonths("2026-10-10", "2026-09");
    expect(r).toEqual({
      ok: true,
      partial: false,
      current: { month: "2026-09", label: "September 2026", from: "2026-09-01", to: "2026-09-30" },
      previous: { month: "2026-08", label: "August 2026", from: "2026-08-01", to: "2026-08-31" },
      previousFull: { month: "2026-08", label: "August 2026", from: "2026-08-01", to: "2026-08-31" },
    });
  });
  it("goes back over the new year", () => {
    expect(compareMonths("2026-01-15", "2026-01")).toMatchObject({ ok: true, current: { to: "2026-01-15" }, previous: { month: "2025-12", from: "2025-12-01", to: "2025-12-15" } });
    expect(compareMonths("2026-10-10", "2026-02")).toMatchObject({ ok: true, current: { to: "2026-02-28" } });
  });
  it("says so in plain words when the month has not started or is not a month", () => {
    expect(compareMonths("2026-10-10", "2026-11")).toEqual({ ok: false, error: "November 2026 has not started yet, so there is nothing to compare." });
    expect(compareMonths("2026-10-10", "2026-13")).toEqual({ ok: false, error: "The month must look like 2026-10." });
    expect(compareMonths("2026-10-10", "October")).toEqual({ ok: false, error: "The month must look like 2026-10." });
    expect(compareMonths("yesterday")).toEqual({ ok: false, error: "Today's date could not be read." });
  });
  it("names a month", () => {
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("junk")).toBe("junk");
  });
});
