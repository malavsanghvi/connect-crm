import { describe, expect, it } from "vitest";

import { defaultMemberStep, isMemberStep, publishEffect } from "@/lib/content";
import { markedMessage, needsNewPrimary, parseDeceasedForm, primaryCandidates } from "@/lib/deceased";
import { platformDocState, suggestVersion, type PlatformDoc } from "@/lib/legal-platform";
import { SUPPRESSION_REASON } from "@/lib/messaging/labels";

describe("deceased form", () => {
  const ok = { deceased_on: "2026-09-20", note: " peaceful ", reason: " son called ", confirm: "on" };
  it("accepts a past date with a reason and the confirmation", () => {
    expect(parseDeceasedForm(ok, "2026-09-25")).toEqual({ ok: true, value: { deceasedOn: "2026-09-20", note: "peaceful", reason: "son called" } });
  });
  it("refuses what the database refuses, in plain English", () => {
    expect(parseDeceasedForm({ ...ok, deceased_on: "" }, "2026-09-25")).toMatchObject({ ok: false, error: expect.stringContaining("date of death") });
    expect(parseDeceasedForm({ ...ok, deceased_on: "2026-02-30" }, "2026-09-25")).toMatchObject({ ok: false, error: expect.stringContaining("not a valid date") });
    expect(parseDeceasedForm({ ...ok, deceased_on: "2026-09-26" }, "2026-09-25")).toMatchObject({ ok: false, error: expect.stringContaining("future") });
    expect(parseDeceasedForm(ok, "2026-09-25", "2026-09-21")).toMatchObject({ ok: false, error: expect.stringContaining("date of birth") });
    expect(parseDeceasedForm({ ...ok, reason: "  " }, "2026-09-25")).toMatchObject({ ok: false, error: expect.stringContaining("reason") });
    expect(parseDeceasedForm({ ...ok, confirm: null }, "2026-09-25")).toMatchObject({ ok: false, error: expect.stringContaining("confirm") });
  });
  it("reads the households that need a new primary and words the result", () => {
    const r = { ended_memberships: 1, suppressed_messages: 2, needs_new_primary: [{ household_id: "h1", name: "Shah family", living_members: 2 }, { bad: true }] };
    expect(needsNewPrimary(r)).toEqual([{ householdId: "h1", name: "Shah family", livingMembers: 2 }]);
    expect(needsNewPrimary(null)).toEqual([]);
    expect(markedMessage("Ramesh Shah", r)).toBe(
      "Ramesh Shah is recorded as deceased · 1 membership ended · 2 queued messages stopped · audit logged. Choose a new primary member for Shah family.",
    );
    expect(markedMessage("Ramesh Shah", { needs_new_primary: [{ household_id: "h1", name: "Alone", living_members: 0 }] })).toBe(
      "Ramesh Shah is recorded as deceased · audit logged.",
    );
  });
  it("offers only living adults as the new primary", () => {
    const base = { merged_into_id: null as string | null };
    const people = [
      { id: "a", is_deceased: true, date_of_birth: "1950-01-01", ...base },
      { id: "b", is_deceased: false, date_of_birth: "1954-01-01", ...base },
      { id: "c", is_deceased: false, date_of_birth: "2015-01-01", ...base },
      { id: "d", is_deceased: false, date_of_birth: null, ...base },
      { id: "e", is_deceased: false, date_of_birth: "2008-09-25", ...base },
      { id: "f", is_deceased: false, date_of_birth: "1990-01-01", merged_into_id: "x" },
    ];
    expect(primaryCandidates(people, "2026-09-25").map((p) => p.id)).toEqual(["b", "d", "e"]);
  });
});

describe("legal texts", () => {
  it("defaults each member document kind to how the app asks for it", () => {
    expect(defaultMemberStep("privacy")).toBe("accept");
    expect(defaultMemberStep("disclaimer")).toBe("accept");
    expect(defaultMemberStep("photo_release")).toBe("consent");
    expect(defaultMemberStep("children_consent")).toBe("consent");
    expect(defaultMemberStep("volunteer_waiver")).toBe("none");
    expect(isMemberStep("consent")).toBe(true);
    expect(isMemberStep("yes")).toBe(false);
    expect(publishEffect("accept")).toMatch(/before they continue/);
  });
  it("splits a platform agreement into current, draft and history", () => {
    const d = (id: string, version: string, published_at: string | null, created_at = "2026-01-01"): PlatformDoc => ({
      id,
      kind: "dpa",
      version,
      title: "DPA",
      body_md: "x",
      published_at,
      created_at,
    });
    const s = platformDocState([d("1", "2026-09-draft", "2026-09-01"), d("2", "2026-10", "2026-10-01"), d("3", "2026-11", null)], "dpa");
    expect(s.current?.id).toBe("2");
    expect(s.draft?.id).toBe("3");
    expect(s.history.map((h) => h.id)).toEqual(["1"]);
    expect(platformDocState([], "dpa")).toEqual({ current: null, draft: null, history: [] });
  });
  it("suggests a unique version name", () => {
    expect(suggestVersion(["2026-09-draft"], "2026-10-04")).toBe("2026-10");
    expect(suggestVersion(["2026-10", "2026-10.2"], "2026-10-04")).toBe("2026-10.3");
  });
});

describe("#15 newsletters-only unsubscribe", () => {
  it("says receipts still go", () => {
    expect(SUPPRESSION_REASON.unsubscribe).toMatch(/newsletters/);
    expect(SUPPRESSION_REASON.unsubscribe).toMatch(/receipts still go/);
  });
});
