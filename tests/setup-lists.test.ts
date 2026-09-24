import { describe, expect, it } from "vitest";

import { centsLabel, dollarsToCents, isSetupList, keyFromName, parseFund, parseInbox, parseMembershipType, parseTrack, parseZone } from "@/lib/setup-lists";

const reader = (o: Record<string, string>) => (n: string) => o[n] ?? null;

describe("setup lists", () => {
  it("keys and money", () => {
    expect(keyFromName("Life membership (family)")).toBe("life_membership_family");
    expect(keyFromName("  ")).toBe("item");
    expect(dollarsToCents("$1,250.5")).toBe(125050);
    expect(dollarsToCents("")).toBe(0);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("-5")).toBeNull();
    expect(centsLabel(125050)).toBe("$1,250.50");
    expect(isSetupList("funds")).toBe(true);
    expect(isSetupList("people")).toBe(false);
  });
  it("membership types", () => {
    const ok = parseMembershipType(reader({ name: "Yearly family", tier: "yearly", fee: "150", period_months: "12", voting_wait_days: "180", reference_required: "on" }));
    expect(ok).toEqual({
      ok: true,
      value: { name: "Yearly family", tier: "yearly", fee_cents: 15000, period_months: 12, includes_spouse: false, reference_required: true, ec_approval_required: false, voting_wait_days: 180, active: true },
    });
    expect(parseMembershipType(reader({ name: "Yearly", tier: "yearly", fee: "150" }))).toMatchObject({ ok: false, error: expect.stringContaining("period") });
    expect(parseMembershipType(reader({ name: "X", tier: "gold", fee: "abc" }))).toMatchObject({ ok: false });
    expect(parseMembershipType(reader({ name: "Life", tier: "life", fee: "501", active: "false" }))).toMatchObject({ ok: true, value: { active: false, period_months: null } });
  });
  it("funds, inboxes, zones, tracks", () => {
    expect(parseFund(reader({ name: "General fund" }))).toEqual({ ok: true, value: { name: "General fund", restricted: false, active: true } });
    expect(parseFund(reader({ name: "G" }))).toMatchObject({ ok: false });
    expect(parseInbox(reader({ name: "Office" }))).toEqual({ ok: true, value: { name: "Office", response_target_hours: 48 } });
    expect(parseInbox(reader({ name: "Office", response_target_hours: "0" }))).toMatchObject({ ok: false });
    expect(parseZone(reader({ name: "North", zip_codes: "78701, 78702 78701" }))).toEqual({ ok: true, value: { name: "North", zip_codes: ["78701", "78702"] } });
    expect(parseZone(reader({ name: "North", zip_codes: "7870" }))).toMatchObject({ ok: false });
    expect(parseTrack(reader({ name: "Weekend Pathshala" }))).toEqual({ ok: true, value: { name: "Weekend Pathshala" } });
  });
});
