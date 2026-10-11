import { describe, expect, it } from "vitest";

import { BRIEFING_COUNTERS, briefingSentence, buildBriefing } from "@/lib/routines/briefing";

import { event, facts, viewer } from "./fixtures";

const COUNTS = { applications: 4, bank_lines: 12, events_week: 2, pledges_overdue: 5, pledges_due_week: 1 };

describe("the morning briefing", () => {
  it("is facts only: a number, a plain label and a link for each, in a fixed order", () => {
    const items = buildBriefing(viewer(["center_admin", "treasurer", "membership_coordinator"]), facts({ counts: COUNTS }));
    expect(items.map((i) => [i.key, i.value, i.label, i.href])).toEqual([
      ["applications", 4, "membership applications waiting", "/memberships/applications"],
      ["bank_lines", 12, "bank lines to match", "/giving/bank"],
      ["events_week", 2, "events in the next 7 days", "/events"],
      ["pledges_overdue", 5, "pledges past their due date", "/giving/pledges"],
      ["pledges_due_week", 1, "pledge falls due in the next 7 days", "/giving/pledges"],
    ]);
  });

  it("uses the singular for one", () => {
    const items = buildBriefing(
      viewer(["treasurer"]),
      facts({ counts: { bank_lines: 1, pledges_overdue: 1, events_week: 1 }, events: [event(2)] }),
    );
    expect(items.map((i) => i.label)).toEqual(["bank line to match", "event in the next 7 days", "pledge past its due date"]);
  });

  it("shows only what the person's role can see", () => {
    const items = buildBriefing(viewer(["membership_coordinator"]), facts({ counts: COUNTS }));
    expect(items.map((i) => i.key)).toEqual(["applications", "events_week"]);
  });

  it("leaves out a module the community switched off", () => {
    const items = buildBriefing(viewer(["treasurer"], { modulesOff: ["giving", "events"] }), facts({ counts: COUNTS }));
    expect(items.map((i) => i.key)).toEqual(["applications"]);
    expect(buildBriefing(viewer(["treasurer"], { modulesOff: ["giving", "events", "membership"] }), facts({ counts: COUNTS }))).toEqual([]);
  });

  it("calls a pledge that is already late an alert, other waiting work attention, and zero quiet", () => {
    const items = buildBriefing(viewer(["treasurer"]), facts({ counts: { bank_lines: 0, pledges_overdue: 3, pledges_due_week: 2 } }));
    expect(Object.fromEntries(items.map((i) => [i.key, i.tone]))).toEqual({ bank_lines: "quiet", pledges_overdue: "alert", pledges_due_week: "attention" });
  });

  it("says out loud when a number could not be counted, never a zero", () => {
    const items = buildBriefing(viewer(["treasurer"]), facts({ counts: { pledges_overdue: 0 }, failed: { bank_lines: "the server did not respond" } }));
    const bank = items.find((i) => i.key === "bank_lines")!;
    expect(bank.value).toBeNull();
    expect(bank.error).toBe("the server did not respond");
    expect(bank.tone).toBe("alert");
    expect(briefingSentence(bank)).toContain("Could not count");
    expect(items.find((i) => i.key === "pledges_overdue")!.value).toBe(0);
  });

  it("sends an event lead who cannot open the list to their nearest event", () => {
    const lead = viewer([{ key: "event_lead", scope: { kind: "event", id: "e1" } }]);
    const items = buildBriefing(lead, facts({ counts: { events_week: 1 }, events: [event(3, "Diwali Dinner", "e1")] }));
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/events/e1");
  });

  it("reads as a sentence for a screen reader", () => {
    const [first] = buildBriefing(viewer(["membership_coordinator"]), facts({ counts: { applications: 1234 } }));
    expect(briefingSentence(first)).toBe("1,234 membership applications waiting");
  });

  it("names the counters the loader must read for it", () => {
    expect([...BRIEFING_COUNTERS]).toEqual(["applications", "bank_lines", "events_week", "pledges_overdue", "pledges_due_week"]);
  });
});
