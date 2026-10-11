import { describe, expect, it, vi } from "vitest";

// "This year" and "last year" in Reports are the community's own financial years (Setup > Organization profile, migration 0180), named by
// the calendar year they start in. A community that starts its year in January sees exactly what it always saw.

vi.mock("server-only", () => ({}));

import { loadFiscalStart, FISCAL_NOT_READ } from "@/lib/reports/fiscal";
import { chosenYear, currentFiscalYear, fiscalStartMonth, fiscalYearLabel, startOfFiscalYear, yearWindow } from "@/lib/reports/periods";

describe("which financial year a day is in", () => {
  it("is the calendar year for a year that starts in January", () => {
    expect(currentFiscalYear("2026-01-01", 1)).toBe(2026);
    expect(currentFiscalYear("2026-12-31", 1)).toBe(2026);
    expect(currentFiscalYear("2026-10-10")).toBe(2026);
  });

  it("changes on the first day of the starting month, and not a day before", () => {
    // a year that starts on July 1
    expect(currentFiscalYear("2026-06-30", 7)).toBe(2025);
    expect(currentFiscalYear("2026-07-01", 7)).toBe(2026);
    expect(currentFiscalYear("2026-12-31", 7)).toBe(2026);
    expect(currentFiscalYear("2027-01-01", 7)).toBe(2026);
    // a year that starts on April 1 (Britain and India)
    expect(currentFiscalYear("2026-03-31", 4)).toBe(2025);
    expect(currentFiscalYear("2026-04-01", 4)).toBe(2026);
    // a year that starts on October 1
    expect(currentFiscalYear("2026-09-30", 10)).toBe(2025);
    expect(currentFiscalYear("2026-10-01", 10)).toBe(2026);
    // a year that starts in December
    expect(currentFiscalYear("2026-11-30", 12)).toBe(2025);
    expect(currentFiscalYear("2026-12-01", 12)).toBe(2026);
  });

  it("starts on the first day of that month", () => {
    expect(startOfFiscalYear("2026-10-10", 1)).toBe("2026-01-01");
    expect(startOfFiscalYear("2026-10-10", 7)).toBe("2026-07-01");
    expect(startOfFiscalYear("2026-06-30", 7)).toBe("2025-07-01");
    expect(startOfFiscalYear("2026-03-31", 4)).toBe("2025-04-01");
  });

  it("reads anything but a month from 1 to 12 as January", () => {
    for (const bad of [null, undefined, 0, 13, 6.5, "7", Number.NaN, -1]) expect(fiscalStartMonth(bad), String(bad)).toBe(1);
    expect(fiscalStartMonth(7)).toBe(7);
    expect(fiscalStartMonth(12)).toBe(12);
  });

  it("names the year by the calendar year it starts in", () => {
    expect(fiscalYearLabel(2026, 1)).toBe("2026");
    expect(fiscalYearLabel(2025, 7)).toBe("2025-26");
    expect(fiscalYearLabel(1999, 4)).toBe("1999-00");
  });
});

describe("the window a report covers", () => {
  it("keeps the calendar year exactly as before for a January start", () => {
    expect(yearWindow(2026, 2026, "2026-10-10", 1)).toEqual({
      year: 2026,
      label: "2026",
      isCurrentYear: true,
      from: "2026-01-01",
      yearEnd: "2026-12-31",
      periodEnd: "2026-10-10",
      prevFrom: "2025-01-01",
      prevEnd: "2025-10-10",
    });
    expect(yearWindow(2026, 2026, "2026-10-10")).toEqual(yearWindow(2026, 2026, "2026-10-10", 1));
  });

  it("runs from July 1 to June 30 for a July start, and compares with the same days of the year before", () => {
    const now = yearWindow(2026, currentFiscalYear("2026-10-10", 7), "2026-10-10", 7);
    expect(now).toEqual({
      year: 2026,
      label: "2026-27",
      isCurrentYear: true,
      from: "2026-07-01",
      yearEnd: "2027-06-30",
      periodEnd: "2026-10-10",
      prevFrom: "2025-07-01",
      prevEnd: "2025-10-10",
    });
    // "last year" is the whole financial year before
    const last = yearWindow(2025, 2026, "2026-10-10", 7);
    expect(last).toMatchObject({ label: "2025-26", isCurrentYear: false, from: "2025-07-01", yearEnd: "2026-06-30", periodEnd: "2026-06-30", prevFrom: "2024-07-01", prevEnd: "2025-06-30" });
  });

  it("is still the previous year on the last day before the new one starts, and the new one on its first day", () => {
    const june30 = currentFiscalYear("2026-06-30", 7);
    expect(yearWindow(june30, june30, "2026-06-30", 7)).toMatchObject({ label: "2025-26", from: "2025-07-01", yearEnd: "2026-06-30", periodEnd: "2026-06-30" });
    const july1 = currentFiscalYear("2026-07-01", 7);
    expect(yearWindow(july1, july1, "2026-07-01", 7)).toMatchObject({ label: "2026-27", from: "2026-07-01", periodEnd: "2026-07-01", prevEnd: "2025-07-01" });
  });

  it("ends on the right last day for a year that ends in February", () => {
    // starts March 1, ends the last day of February: a leap day only in a leap year
    expect(yearWindow(2023, 2023, "2023-09-09", 3).yearEnd).toBe("2024-02-29");
    expect(yearWindow(2024, 2024, "2024-09-09", 3).yearEnd).toBe("2025-02-28");
    // starts February 1, ends January 31
    expect(yearWindow(2026, 2026, "2026-09-09", 2)).toMatchObject({ from: "2026-02-01", yearEnd: "2027-01-31" });
    // starts December 1, ends November 30
    expect(yearWindow(2026, 2026, "2026-12-09", 12)).toMatchObject({ from: "2026-12-01", yearEnd: "2027-11-30" });
  });

  it("takes the same day last year on a leap day inside a financial year", () => {
    expect(yearWindow(2023, 2023, "2024-02-29", 7)).toMatchObject({ periodEnd: "2024-02-29", prevEnd: "2023-02-28" });
  });

  it("accepts a year picked from the list (the year it starts in) up to next year", () => {
    expect(chosenYear(2025, currentFiscalYear("2026-03-31", 4))).toBe(2025);
    expect(chosenYear(2027, 2026)).toBe(2027);
    expect(chosenYear(1980, 2026)).toBe(2026);
  });
});

describe("reading the month a community's year starts in", () => {
  const dbReturning = (result: { data?: unknown; error?: { message: string; code?: string } | null }) => {
    const table: string[] = [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
    };
    return { db: { from: (t: string) => (table.push(t), chain) } as never, table };
  };

  it("reads it from the organization profile", async () => {
    const { db, table } = dbReturning({ data: { fiscal_year_start_month: 7 } });
    expect(await loadFiscalStart(db, "c1")).toEqual({ month: 7, problem: null });
    expect(table).toEqual(["org_profiles"]);
  });

  it("is January when the profile has none (no profile yet, or no month chosen)", async () => {
    expect(await loadFiscalStart(dbReturning({ data: null }).db, "c1")).toEqual({ month: 1, problem: null });
    expect(await loadFiscalStart(dbReturning({ data: { fiscal_year_start_month: null } }).db, "c1")).toEqual({ month: 1, problem: null });
  });

  it("says so, and logs the detail, when it cannot be read: never a silent calendar year", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await loadFiscalStart(dbReturning({ error: { message: "connection reset", code: "XX000" } }).db, "c1");
    expect(result.month).toBe(1);
    expect(result.problem).toBe(`${FISCAL_NOT_READ}.`);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
