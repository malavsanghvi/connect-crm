import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BEGIN, END, MIGRATION, SKIP, jshCalendarEntries, jshCalendarSeedSql } from "../scripts/jsh-calendar-seed";

function block(sql: string): string {
  const a = sql.indexOf(BEGIN);
  const b = sql.indexOf(END);
  if (a < 0 || b < 0) return "";
  return sql.slice(a + BEGIN.length, b).trim();
}

describe("JSH calendar seed (0512)", () => {
  it("matches what the subscription parser makes of the saved calendars", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const want = jshCalendarSeedSql();
    if (process.env.GEN_JSH_CALENDAR_SEED === "1") {
      const a = sql.indexOf(BEGIN);
      const b = sql.indexOf(END);
      writeFileSync(MIGRATION, `${sql.slice(0, a)}${BEGIN}\n${want}\n${sql.slice(b)}`);
      return;
    }
    expect(block(sql)).toBe(want.trim());
  });

  it("covers the six calendars with sensible content", () => {
    const out = jshCalendarEntries();
    expect(out.map((o) => o.layer.file)).toHaveLength(6);
    const by = Object.fromEntries(out.map((o) => [o.layer.file, o]));
    // Nothing the parser could not read.
    for (const o of out) expect(o.skipped, o.layer.file).toEqual([]);
    // The office reminder is not seeded.
    for (const o of out) for (const e of o.entries) expect(SKIP[e.uid.split("#")[0]!]).toBeUndefined();
    // Events: timed in Houston time, with the venue.
    const navpad = by["jsh-events.ics"]!.entries.find((e) => e.title === "Navpad Puja")!;
    expect(navpad).toMatchObject({ starts_on: "2026-10-18", all_day: false, starts_at: "2026-10-18T14:30:00.000Z", location: "Derasar", sub: "9:30 AM – 11:00 AM · Derasar" });
    const bhoomi = by["jsh-events.ics"]!.entries.find((e) => e.title === "Bhoomi Pujan Weekend")!;
    expect(bhoomi).toMatchObject({ starts_on: "2026-04-17", ends_on: "2026-04-19", all_day: true });
    // Weekly online sessions: expanded, with the Zoom link.
    const sat = by["jsh-bhaktamber-online.ics"]!.entries.filter((e) => e.title.includes("Saturday"));
    expect(sat.length).toBeGreaterThan(50);
    expect(sat[0]!.link).toBe("https://bit.ly/jshzoom");
    expect(sat[0]!.notes).toContain("Meeting ID: 343 341 0593");
    const shine = by["jsh-shine-online.ics"]!.entries;
    expect(new Set(shine.map((e) => new Date(`${e.starts_on}T12:00:00Z`).getUTCDay()))).toEqual(new Set([1, 3, 4]));
    // Panchang: all-day tithis; Gyan Panchami ends at its UNTIL (two mornings).
    const panchang = by["jain-panchang.ics"]!.entries;
    expect(panchang.filter((e) => e.title === "AATHAM").length).toBe(22);
    expect(panchang.filter((e) => e.title === "Gyan Panchami").map((e) => e.starts_on)).toEqual(["2026-11-14", "2026-11-15"]);
    // School calendar.
    expect(by["fbisd.ics"]!.entries.find((e) => e.title === "FBISD-Spring BREAK")).toMatchObject({ starts_on: "2026-03-16", ends_on: "2026-03-20", all_day: true });
    // UIDs are unique within each layer.
    for (const o of out) expect(new Set(o.entries.map((e) => e.uid)).size, o.layer.file).toBe(o.entries.length);
  });
});
