import { describe, expect, it } from "vitest";

import {
  approvalView,
  formatBytes,
  mergeReadiness,
  parseApprovalStatus,
  parseLegacySystems,
  parseNumbering,
  parseNumberingOverview,
  parseRetentionDays,
  parseStorageOverview,
  READINESS_CHECKS,
  routeAvailable,
} from "@/lib/setup";

const reader = (o: Record<string, string>) => (n: string) => o[n] ?? null;

describe("readiness (o-golive)", () => {
  it("every check says where its evidence is, and checks 8 and 12 say they are interim", () => {
    expect(READINESS_CHECKS.every((c) => typeof c.href === "string" && routeAvailable(c.href))).toBe(true);
    expect(READINESS_CHECKS.filter((c) => c.interim).map((c) => c.n)).toEqual([8, 12]);
    expect(READINESS_CHECKS.find((c) => c.n === 6)?.title).toMatch(/test mode in a sandbox/);
  });
  it("the background-service check follows the 13 with a link to Integrations", () => {
    const rows = mergeReadiness([{ key: "background_service", title: "Background service running", ok: false, detail: "Not running." }]);
    expect(rows[13]).toMatchObject({ n: 14, key: "background_service", state: "fail", href: "/settings/integrations" });
  });
});

describe("approvals", () => {
  it("reads the status JSON defensively and words each state", () => {
    const s = parseApprovalStatus({
      statement_templates: { state: "current", approved_by_name: "Tara", approved_at: "2026-09-24T10:00:00Z" },
      niva_content: { state: "bogus" },
      is_treasurer: true,
    });
    expect(s.statements?.state).toBe("current");
    expect(s.niva).toBeNull();
    expect(s.isTreasurer).toBe(true);
    expect(s.canApproveNiva).toBe(false);
    expect(parseApprovalStatus(null)).toEqual({ statements: null, niva: null, isTreasurer: false, canApproveNiva: false });
    expect(approvalView(null)).toMatchObject({ state: "none", tone: "warn" });
    expect(approvalView({ state: "changed" })).toMatchObject({ label: "Changed since approved", tone: "bad" });
    expect(approvalView({ state: "current" })).toMatchObject({ label: "Approved", tone: "ok" });
  });
});

describe("numbering", () => {
  it("parses the form, upper-casing prefixes and dropping thousands separators", () => {
    const r = parseNumbering(reader({ prefix_member: "gt-", next_member: "50,001", prefix_household: "GT-H-", next_household: "2001" }));
    expect(r).toEqual({ ok: true, value: [{ kind: "member", prefix: "GT-", next_value: "50001" }, { kind: "household", prefix: "GT-H-", next_value: "2001" }] });
  });
  it("refuses bad prefixes, zero, and an empty form", () => {
    expect(parseNumbering(reader({ prefix_member: "G T!", next_member: "5" }))).toMatchObject({ ok: false });
    expect(parseNumbering(reader({ prefix_member: "GT-", next_member: "0" }))).toMatchObject({ ok: false });
    expect(parseNumbering(reader({}))).toEqual({ ok: false, error: "there is nothing to save." });
  });
  it("reads the overview and ignores unknown kinds", () => {
    const rows = parseNumberingOverview([
      { kind: "member", label: "Member numbers", prefix: "GT-", next_value: 10001, started: true },
      { kind: "nope", label: "x" },
    ]);
    expect(rows).toEqual([{ kind: "member", label: "Member numbers", prefix: "GT-", next_value: 10001, started: true }]);
    expect(parseNumberingOverview(null)).toEqual([]);
  });
  it("parses identifier systems, one per line", () => {
    expect(parseLegacySystems("Neon | Neon CRM account\n\nNamoCRM")).toEqual({
      ok: true,
      value: [
        { system: "Neon", label: "Neon CRM account" },
        { system: "NamoCRM", label: "NamoCRM" },
      ],
    });
    expect(parseLegacySystems("Neon\nneon")).toMatchObject({ ok: false });
    expect(parseLegacySystems("!bad")).toMatchObject({ ok: false });
    expect(parseLegacySystems("")).toEqual({ ok: true, value: [] });
  });
});

describe("storage", () => {
  it("reads the overview and formats sizes", () => {
    const o = parseStorageOverview({
      available: true,
      limit_bytes: 2147483648,
      used_bytes: 1536,
      areas: [{ bucket: "imports", public: false, max_file_bytes: 52428800, types: ["text/csv"], files: 2, bytes: 1536, retention_days: 90, retention_editable: true, module: null, module_on: true }],
    });
    expect(o.available).toBe(true);
    expect(o.areas[0]).toMatchObject({ bucket: "imports", retention_days: 90, retention_editable: true });
    expect(formatBytes(o.usedBytes)).toBe("1.5 KB");
    expect(formatBytes(o.limitBytes ?? 0)).toBe("2 GB");
    expect(formatBytes(512)).toBe("512 B");
    expect(parseStorageOverview(undefined)).toEqual({ available: false, areas: [], limitBytes: null, usedBytes: 0 });
  });
  it("retention is 1–3,650 days", () => {
    expect(parseRetentionDays("30")).toEqual({ ok: true, value: 30 });
    expect(parseRetentionDays("0")).toMatchObject({ ok: false });
    expect(parseRetentionDays("4000")).toMatchObject({ ok: false });
    expect(parseRetentionDays(null)).toMatchObject({ ok: false });
  });
});
