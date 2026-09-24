import { describe, expect, it } from "vitest";

import { describeAudit, changedFields } from "@/lib/activity";
import { householdVotingStatus, overrideStep, tenureMet, votingRules } from "@/lib/voting";

describe("voting rules", () => {
  it("reads the center's wait and cutoff, with a 180-day default", () => {
    expect(votingRules({ voting: { life_member_wait_days: 90, ballot_cutoff: "2026-10-31" } })).toEqual({ waitDays: 90, ballotCutoff: "2026-10-31" });
    expect(votingRules({})).toEqual({ waitDays: 180, ballotCutoff: null });
    expect(votingRules({ voting: { ballot_cutoff: "Oct 31" } }).ballotCutoff).toBeNull();
  });

  it("checks tenure against the wait", () => {
    expect(tenureMet("2026-01-01", 180, "2026-06-30")).toBe(true);
    expect(tenureMet("2026-01-01", 180, "2026-06-29")).toBe(false);
  });

  it("rolls adults up to a household status", () => {
    expect(householdVotingStatus([])).toBe("not_computed");
    expect(householdVotingStatus([true, true])).toBe("eligible");
    expect(householdVotingStatus([true, false])).toBe("not_eligible");
  });

  it("tracks the two-person override", () => {
    expect(overrideStep({ requestedBy: null, secondApprover: null, applied: null })).toBe("none");
    expect(overrideStep({ requestedBy: "a", secondApprover: null, applied: null })).toBe("awaiting_second");
    expect(overrideStep({ requestedBy: "a", secondApprover: "b", applied: null })).toBe("ready_to_apply");
    expect(overrideStep({ requestedBy: "a", secondApprover: "b", applied: true })).toBe("applied");
  });
});

describe("audit sentences", () => {
  it("names changed fields in plain words", () => {
    expect(changedFields({ display_name: "A", updated_at: "1", zone_id: "x" }, { display_name: "B", updated_at: "2", zone_id: "x" })).toEqual(["name"]);
    expect(changedFields({ email: "a", phone_e164: "1" }, { email: "b", phone_e164: "2" })).toEqual(["email", "mobile"]);
  });

  it("describes common rows", () => {
    expect(describeAudit({ action: "households.update", record_table: "households", before: { display_name: "A" }, after: { display_name: "B" } })).toEqual({
      what: "Household details changed",
      detail: "name",
    });
    expect(describeAudit({ action: "household_members.update", record_table: "household_members", before: { left_at: null }, after: { left_at: "2026-09-01" } }).what).toBe(
      "Left a household",
    );
    expect(describeAudit({ action: "memberships.insert", record_table: "memberships", before: null, after: { tier: "life", status: "active" } }).what).toBe(
      "Life membership started",
    );
    expect(describeAudit({ action: "pledges.insert", record_table: "pledges", before: null, after: { pledge_number: "P-1" } })).toEqual({
      what: "Pledge recorded",
      detail: "P-1",
    });
    expect(describeAudit({ action: "zones.update", record_table: null, before: null, after: null }).what).toBe("Changed");
  });
});
