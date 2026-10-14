import { describe, expect, it } from "vitest";

import { CHECKLIST, CHECKLIST_AREAS, checklistCsv } from "@/lib/onboarding-checklist";

describe("the get-ready checklist", () => {
  it("every row belongs to a listed area and says why and what format", () => {
    const areas = new Set(CHECKLIST_AREAS.map((a) => a.area));
    for (const r of CHECKLIST) {
      expect(areas.has(r.area)).toBe(true);
      expect(r.item.length).toBeGreaterThan(3);
      expect(r.why.length).toBeGreaterThan(3);
      expect(r.format.length).toBeGreaterThan(3);
    }
    for (const a of areas) expect(CHECKLIST.some((r) => r.area === a)).toBe(true);
  });
  it("never asks for a password", () => {
    expect(CHECKLIST.map((r) => `${r.item} ${r.format}`).join(" ").toLowerCase()).not.toMatch(/send (us )?(your )?password|share (your )?password/);
  });
  it("is a CSV with a header, a blank Ready? column and quotes escaped", () => {
    const csv = checklistCsv([{ area: 'A "quoted" area', item: "Item, with comma", why: "w", format: "f", who: "o" }]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Area","What to prepare","Why we need it","Format","Who usually has it","Ready?"');
    expect(lines[1]).toBe('"A ""quoted"" area","Item, with comma","w","f","o",""');
    expect(checklistCsv().trimEnd().split("\r\n")).toHaveLength(CHECKLIST.length + 1);
  });
});
