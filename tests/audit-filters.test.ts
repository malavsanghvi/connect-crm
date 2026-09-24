import { describe, expect, it } from "vitest";

import { needsTraceColumns, parseTraceFilters } from "@/lib/audit-filters";

const from = (o: Record<string, string>) => (k: string) => o[k];

describe("parseTraceFilters", () => {
  it("accepts known modules, core, known apps and cleans reason text", () => {
    expect(parseTraceFilters(from({ mod: "giving", app: "member", reason: "  write-off (Asha)  " }))).toEqual({
      recordedModule: "giving",
      clientApp: "member",
      reason: "write-off Asha",
    });
    expect(parseTraceFilters(from({ mod: "core" })).recordedModule).toBe("core");
  });
  it("drops anything unknown", () => {
    expect(parseTraceFilters(from({ mod: "bogus", app: "admin", reason: "%%%" }))).toEqual({ recordedModule: null, clientApp: null, reason: null });
    expect(parseTraceFilters(from({}))).toEqual({ recordedModule: null, clientApp: null, reason: null });
  });
  it("caps reason text", () => {
    expect(parseTraceFilters(from({ reason: "a".repeat(400) })).reason!.length).toBe(200);
  });
  it("needsTraceColumns only for module/app", () => {
    expect(needsTraceColumns({ recordedModule: null, clientApp: null, reason: "x" })).toBe(false);
    expect(needsTraceColumns({ recordedModule: "core", clientApp: null, reason: null })).toBe(true);
    expect(needsTraceColumns({ recordedModule: null, clientApp: "kiosk", reason: null })).toBe(true);
  });
});
