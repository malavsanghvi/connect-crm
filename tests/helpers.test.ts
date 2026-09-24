import { describe, expect, it } from "vitest";

import { agingBucket } from "@/lib/aging";
import { planDecision } from "@/lib/applications";
import { identifierRules, validateRulesJson } from "@/lib/center-rules";
import { addDays, ageOn, daysBetween, formatDate, formatMonth, startOfDayInTz, todayInTz } from "@/lib/dates";
import { checkPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { describeResolvedHit, identifierTarget, padOrgId } from "@/lib/identifiers";
import { hrefWith, safeFilterText } from "@/lib/search-params";

describe("aging buckets", () => {
  it("ages from the due date, else the pledge date", () => {
    expect(agingBucket("2026-10-01", "2026-01-01", "2026-09-23")).toBe("not_due");
    expect(agingBucket(null, "2026-09-01", "2026-09-23")).toBe("d0_30");
    expect(agingBucket("2026-08-01", "2026-01-01", "2026-09-23")).toBe("d31_60");
    expect(agingBucket(null, "2026-07-01", "2026-09-23")).toBe("d61_90");
    expect(agingBucket(null, "2025-12-01", "2026-09-23")).toBe("d90_plus");
    expect(agingBucket("2026-09-23", "2026-01-01", "2026-09-23")).toBe("d0_30");
  });
});

describe("dates", () => {
  it("never shifts calendar dates", () => {
    expect(formatDate("2026-09-14", "America/Chicago")).toBe("Sep 14, 2026");
    expect(formatDate("2026-01-01", "Pacific/Kiritimati")).toBe("Jan 1, 2026");
    expect(formatMonth("2026-09-01")).toBe("Sep 2026");
  });
  it("formats timestamps in the center's zone", () => {
    expect(formatDate("2026-09-14T03:00:00Z", "America/Chicago")).toBe("Sep 13, 2026");
    expect(todayInTz("America/Chicago", new Date("2026-09-14T03:00:00Z"))).toBe("2026-09-13");
  });
  it("finds local midnight across DST", () => {
    expect(startOfDayInTz("2026-07-01", "America/Chicago")).toBe("2026-07-01T05:00:00.000Z");
    expect(startOfDayInTz("2026-01-01", "America/Chicago")).toBe("2026-01-01T06:00:00.000Z");
    expect(startOfDayInTz("2026-03-08", "America/Chicago")).toBe("2026-03-08T06:00:00.000Z");
  });
  it("counts days and ages", () => {
    expect(daysBetween("2026-09-01", "2026-09-23")).toBe(22);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(ageOn("2008-09-24", "2026-09-23")).toBe(17);
    expect(ageOn("2008-09-23", "2026-09-23")).toBe(18);
    expect(ageOn(null, "2026-09-23")).toBeNull();
  });
});

describe("org ids", () => {
  it("pads numeric ids to the center's width", () => {
    expect(padOrgId("417", 4)).toBe("0417");
    expect(padOrgId("0417", 4)).toBe("0417");
    expect(padOrgId("00417", 4)).toBe("0417");
    expect(padOrgId("12345", 4)).toBe("12345");
    expect(padOrgId("LM-0417", 4)).toBe("LM-0417");
    expect(padOrgId("417", null)).toBe("417");
  });
  it("knows which record each kind must point at", () => {
    expect(identifierTarget("org_member")).toBe("person");
    expect(identifierTarget("org_household")).toBe("household");
    expect(identifierTarget("crm")).toBe("either");
  });
  it("describes a resolver hit with more than a name", () => {
    const rules = { orgMemberLabel: "JSH member ID", orgHouseholdLabel: "JSH household ID" };
    const base = { system: "jsh_register", value: "0417", org_household_id: null, members: null };
    expect(
      describeResolvedHit(
        { ...base, kind: "org_member", person_id: "p", household_id: "h", display_name: "Priya Shah", household_name: "Shah family", household_number: "JSH-H-2041" },
        rules,
      ),
    ).toBe("JSH member ID 0417 → Priya Shah, Shah family (JSH-H-2041)");
    expect(
      describeResolvedHit(
        { ...base, kind: "org_household", person_id: null, household_id: "h2", display_name: "x", household_name: "Rahul & Mira Shah Household", household_number: null },
        rules,
      ),
    ).toBe("JSH household ID 0417 → Rahul & Mira Shah Household");
  });
});

describe("center rules", () => {
  it("reads identifier labels with sensible defaults", () => {
    const r = identifierRules({
      identifiers: {
        org_member_label: "JSH member ID",
        org_member_system: "jsh_register",
        org_member_digits: 4,
        org_household_label: "JSH household ID",
        legacy_systems: [{ system: "neon", label: "Neon ID" }, { system: "namocrm" }, { bad: true }],
      },
    });
    expect(r).toMatchObject({ orgMemberLabel: "JSH member ID", orgMemberDigits: 4, orgHouseholdLabel: "JSH household ID", orgHouseholdSystem: "jsh_register", orgHouseholdDigits: null });
    expect(r.legacySystems).toEqual([
      { system: "neon", label: "Neon ID" },
      { system: "namocrm", label: "namocrm" },
    ]);
    expect(identifierRules({}).orgMemberLabel).toBe("Organization member ID");
  });

  it("validates the rules JSON", () => {
    expect(validateRulesJson('{"child_login_age":13,"lunch":{"slot_minutes":15},"custom":{"x":1}}').ok).toBe(true);
    const bad = validateRulesJson('{"child_login_age":"13","lunch":{"slot_minutes":2},"accounting":{"basis":"modified"},"bank":{"statement_format":"pdf"}}');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors).toEqual([
        '"child_login_age" must be a whole number.',
        '"lunch.slot_minutes" must be at least 5.',
        '"bank.statement_format" must be "chase_csv", "generic_csv" or "ofx".',
        '"accounting.basis" must be "cash" or "accrual".',
      ]);
    }
    expect(validateRulesJson("[1,2]")).toEqual({ ok: false, errors: ["The rules must be a JSON object ({ … })."] });
    expect(validateRulesJson("{nope").ok).toBe(false);
  });
});

describe("membership application decisions", () => {
  const me = { userId: "u1", isExecutiveCommittee: false };
  const ec = { userId: "u2", isExecutiveCommittee: true };
  it("approves a yearly membership in one step", () => {
    expect(planDecision({ status: "awaiting_center", tier: "yearly", ecApprovalRequired: false, centerDecidedBy: null }, "approve", me)).toEqual({
      ok: true,
      next: "approved",
      step: "center",
    });
  });
  it("sends a life membership to the EC, and needs a different EC member", () => {
    expect(planDecision({ status: "awaiting_center", tier: "life", ecApprovalRequired: false, centerDecidedBy: null }, "approve", me)).toMatchObject({ next: "awaiting_ec" });
    expect(planDecision({ status: "awaiting_ec", tier: "life", ecApprovalRequired: true, centerDecidedBy: "u1" }, "approve", me).ok).toBe(false);
    expect(planDecision({ status: "awaiting_ec", tier: "life", ecApprovalRequired: true, centerDecidedBy: "u2" }, "approve", ec).ok).toBe(false);
    expect(planDecision({ status: "awaiting_ec", tier: "life", ecApprovalRequired: true, centerDecidedBy: "u1" }, "approve", ec)).toMatchObject({ next: "approved", step: "ec" });
  });
  it("won't approve before the reference, but can reject any open application", () => {
    expect(planDecision({ status: "awaiting_reference", tier: "yearly", ecApprovalRequired: false, centerDecidedBy: null }, "approve", me).ok).toBe(false);
    expect(planDecision({ status: "awaiting_reference", tier: "yearly", ecApprovalRequired: false, centerDecidedBy: null }, "reject", me)).toMatchObject({ next: "rejected" });
    expect(planDecision({ status: "approved", tier: "yearly", ecApprovalRequired: false, centerDecidedBy: null }, "reject", me).ok).toBe(false);
  });
});

describe("errors in plain English", () => {
  it("maps database errors", () => {
    expect(explainError({ code: "42501", message: 'new row violates row-level security policy for table "payments"' })).toBe(
      "you don't have permission to make this change",
    );
    expect(explainError({ code: "23505", message: "duplicate key" })).toBe("a record with the same key already exists");
    expect(explainError({ code: "P0001", message: "bank line already matched" })).toBe("bank line already matched");
    expect(explainError({ code: "23514", message: "a pledge write-off needs two different approvers" })).toBe("a pledge write-off needs two different approvers");
    expect(explainError({ code: "23514", message: 'new row for relation "x" violates check constraint "y"' })).toBe("one of the values is not allowed");
    expect(explainError({ code: "P0001", message: "the second approver must be a different person" })).toMatch(/different person/);
    expect(explainError({ message: "TypeError: fetch failed" })).toMatch(/could not be reached/);
    expect(explainError(null)).toBe("an unknown error occurred");
  });
});

describe("env", () => {
  it("names what is missing", () => {
    const r = checkPublicEnv({ url: "", anonKey: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.name)).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  });
  it("defaults the center to jsh", () => {
    expect(checkPublicEnv({ url: "http://localhost:54321", anonKey: "k" })).toEqual({
      ok: true,
      env: { supabaseUrl: "http://localhost:54321", supabaseAnonKey: "k", centerSlug: "jsh" },
    });
  });
  it("rejects a malformed URL", () => {
    expect(checkPublicEnv({ url: "localhost", anonKey: "k" }).ok).toBe(false);
  });
});

describe("search params", () => {
  it("builds links that keep filters", () => {
    expect(hrefWith("/giving/pledges", { status: "open", page: "3" }, { page: 4 })).toBe("/giving/pledges?status=open&page=4");
    expect(hrefWith("/x", { a: "1" }, { a: undefined })).toBe("/x");
  });
  it("strips PostgREST filter syntax from search text", () => {
    expect(safeFilterText('Shah, (Rahul) "x"*%')).toBe("Shah Rahul x");
  });
});
