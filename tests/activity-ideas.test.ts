import { describe, expect, it } from "vitest";

import {
  allowedDecisions,
  buildIdeaCard,
  buildLabelMap,
  canMoveIdea,
  decisionTarget,
  groupIdeas,
  ideaFacts,
  ideaKind,
  ideaStatus,
  ideaTitle,
  IDEA_STATUSES,
  isIdeaDecision,
  MAX_REASON_LENGTH,
  minutesPhrase,
  parseIdeaReason,
  roleLabel,
  stepPhrase,
  summariseUsage,
  timesPerMonth,
  type IdeaRow,
  type IdeaStatus,
  type UsageRow,
} from "@/lib/activity/ideas";

const LABELS = buildLabelMap([
  { key: "giving.record_payment", label: "Record a payment", surface: "portal" },
  { key: "giving.confirm_bank_match", label: "Confirm a bank match", surface: "portal" },
  { key: "giving.apply_payment", label: "Apply a payment to pledges", surface: "portal" },
  { key: "accounting.post_to_qbo", label: "Post to QuickBooks", surface: "portal" },
  { key: "rsvp_started", label: "RSVP started", surface: "member" },
  { key: "payment_completed", label: "Payment completed", surface: "member" },
  { key: "screen:/", label: "Home", surface: "portal" },
  { key: "screen:/", label: "Home screen of the app", surface: "member" },
  { key: "screen:/events", label: "All events", surface: "portal" },
]);

const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const row = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: ID,
  role_key: "treasurer",
  pattern: ["giving.record_payment", "giving.confirm_bank_match"],
  support: 36,
  distinct_actors: 3,
  median_seconds: 133,
  minutes_per_month: 40,
  score: 30,
  suggested_kind: "niva_command",
  status: "new",
  last_seen: "2026-10-09T10:00:00Z",
  ...over,
});

describe("the sentence an idea is shown as", () => {
  it("turns two steps into 'After you ... you usually ...' from the catalog labels", () => {
    expect(ideaTitle(row().pattern, "treasurer", LABELS)).toBe("After you record a payment you usually confirm a bank match.");
  });

  it("keeps going with 'then' for a longer sequence", () => {
    expect(ideaTitle(["giving.record_payment", "giving.confirm_bank_match", "giving.apply_payment"], "treasurer", LABELS)).toBe(
      "After you record a payment you usually confirm a bank match, then apply a payment to pledges.",
    );
  });

  it("keeps the capitals of a first word like RSVP or QuickBooks", () => {
    expect(stepPhrase("rsvp_started", LABELS)).toBe("RSVP started");
    expect(stepPhrase("accounting.post_to_qbo", LABELS)).toBe("post to QuickBooks");
  });

  it("says a key with no label in words, never as the key", () => {
    expect(stepPhrase("giving.write_off_pledge", {})).toBe("write off pledge");
    expect(ideaTitle(["people.add_person", "people.merge_people"], "staff", {})).toBe("After you add person you usually merge people.");
  });

  it("describes what members do in the app without 'you'", () => {
    expect(ideaTitle(["rsvp_started", "payment_completed"], "member", LABELS)).toBe("Members often go through these steps in a row: RSVP started, then payment completed.");
  });
});

describe("the numbers of an idea", () => {
  it("says how often, how many people and how long, in the owner's words", () => {
    expect(ideaFacts(row())).toBe("Done about 18 times a month by 3 people, about 40 minutes a month.");
  });

  it("works out times a month from the minutes and the length of one run", () => {
    expect(timesPerMonth(40, 133)).toBeCloseTo(18.05, 1);
    expect(timesPerMonth(40, 0)).toBeNull();
    expect(timesPerMonth(0, 60)).toBeNull();
  });

  it("handles one time, one person, less than once a month and short or long totals", () => {
    expect(ideaFacts(row({ distinct_actors: 1, minutes_per_month: 1, median_seconds: 60 }))).toBe("Done about 1 time a month by 1 person, about 1 minute a month.");
    expect(ideaFacts(row({ minutes_per_month: 0.4, median_seconds: 120 }))).toBe("Done less than once a month by 3 people, less than a minute a month.");
    expect(minutesPhrase(0.4)).toBe("less than a minute");
    expect(minutesPhrase(59.6)).toBe("about 60 minutes");
    expect(minutesPhrase(150)).toBe("about 2.5 hours");
    expect(minutesPhrase(180)).toBe("about 3 hours");
  });

  it("falls back to the count it saw when the length of a run is not known", () => {
    expect(ideaFacts(row({ median_seconds: 0 }))).toBe("Seen 36 times by 3 people, about 40 minutes a month.");
  });

  it("shows no numbers for an idea that has gone quiet, and says so", () => {
    const quiet = ideaFacts(row({ support: 0, distinct_actors: 0, minutes_per_month: 0, median_seconds: 0 }));
    expect(quiet).toMatch(/not seen this lately/);
    expect(quiet).not.toMatch(/\d/);
  });
});

describe("an idea card", () => {
  it("shows words and counts only: no id, no name, no raw key", () => {
    const decider = "5b1d6c0e-1111-4222-8333-444455556666";
    const hostile = { ...row(), decided_by: decider, actor_name: "Priya Shah", household: "Shah family" } as unknown as IdeaRow;
    const card = buildIdeaCard(hostile, LABELS, { treasurer: "Treasurer" });
    // The card's id is only for the buttons that answer it; everything else is what the screen prints.
    const { id, ...shown } = card;
    expect(id).toBe(ID);
    const text = JSON.stringify(shown);
    expect(text).not.toContain(decider);
    expect(text).not.toContain("Priya");
    expect(text).not.toContain("Shah");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toContain("giving.record_payment");
    expect(card).toMatchObject({
      status: "new",
      title: "After you record a payment you usually confirm a bank match.",
      who: "Treasurer",
      kind: "niva_command",
      kindLabel: "Something Niva could do for you",
      quiet: false,
    });
  });

  it("carries the card's own id so the buttons can answer it (and nothing else of the row)", () => {
    expect(Object.keys(buildIdeaCard(row(), LABELS)).sort()).toEqual(["facts", "id", "kind", "kindHint", "kindLabel", "quiet", "score", "status", "title", "who"]);
  });

  it("names every suggested kind in words", () => {
    const words = (kind: string) => buildIdeaCard(row({ suggested_kind: kind }), LABELS).kindLabel;
    expect(words("routine")).toBe("A step in a daily routine");
    expect(words("niva_command")).toBe("Something Niva could do for you");
    expect(words("scheduled_job")).toBe("A reminder");
    expect(words("default")).toBe("A default value");
    expect(words("playbook")).toBe("A shared checklist");
    expect(ideaKind("something_new")).toBe("routine");
  });

  it("names the role from the role's name, and falls back to words", () => {
    expect(roleLabel("treasurer", { treasurer: "Treasurer" })).toBe("Treasurer");
    expect(roleLabel("event_lead")).toBe("Event lead");
    expect(roleLabel("member")).toBe("Members in the app");
    expect(roleLabel("staff")).toBe("Staff");
    expect(roleLabel("owner")).toBe("The owner");
  });

  it("is quiet when the numbers are gone", () => {
    expect(buildIdeaCard(row({ support: 0, distinct_actors: 0 }), LABELS).quiet).toBe(true);
  });
});

describe("the labels by key", () => {
  it("prefers the portal's label for a key both surfaces list, and keeps each surface's own", () => {
    expect(LABELS["screen:/"]).toBe("Home");
    expect(LABELS["member|screen:/"]).toBe("Home screen of the app");
    expect(LABELS["portal|screen:/"]).toBe("Home");
  });
});

describe("the idea state machine", () => {
  const moves = (from: IdeaStatus) => IDEA_STATUSES.filter((to) => canMoveIdea(from, to));

  it("lets a new idea be accepted or set aside", () => {
    expect(moves("new")).toEqual(["accepted", "dismissed"]);
  });
  it("lets an accepted idea be set aside or put back", () => {
    expect(moves("accepted")).toEqual(["new", "dismissed"]);
  });
  it("lets a set-aside idea only be brought back (not accepted in one step)", () => {
    expect(moves("dismissed")).toEqual(["new"]);
  });
  it("leaves a built idea alone: that is Weaver's to set", () => {
    expect(moves("built")).toEqual([]);
    expect(canMoveIdea("new", "built")).toBe(false);
    expect(canMoveIdea("accepted", "built")).toBe(false);
  });
  it("never lets a status move to itself", () => {
    for (const s of IDEA_STATUSES) expect(canMoveIdea(s, s)).toBe(false);
  });
  it("maps the three buttons to the three statuses", () => {
    expect(decisionTarget("accept")).toBe("accepted");
    expect(decisionTarget("dismiss")).toBe("dismissed");
    expect(decisionTarget("restore")).toBe("new");
    expect(isIdeaDecision("accept")).toBe(true);
    expect(isIdeaDecision("delete")).toBe(false);
    expect(isIdeaDecision(null)).toBe(false);
  });
  it("shows the buttons that fit where the idea stands", () => {
    expect(allowedDecisions("new")).toEqual(["accept", "dismiss"]);
    expect(allowedDecisions("accepted")).toEqual(["dismiss", "restore"]);
    expect(allowedDecisions("dismissed")).toEqual(["restore"]);
    expect(allowedDecisions("built")).toEqual([]);
  });
  it("treats an unknown status as new", () => {
    expect(ideaStatus("whatever")).toBe("new");
    expect(ideaStatus("accepted")).toBe("accepted");
  });
});

describe("the optional reason", () => {
  it("is empty, trimmed, or refused when too long", () => {
    expect(parseIdeaReason(undefined)).toEqual({ ok: true, reason: null });
    expect(parseIdeaReason("   ")).toEqual({ ok: true, reason: null });
    expect(parseIdeaReason("  we do this by hand on purpose ")).toEqual({ ok: true, reason: "we do this by hand on purpose" });
    expect(parseIdeaReason("x".repeat(MAX_REASON_LENGTH))).toEqual({ ok: true, reason: "x".repeat(MAX_REASON_LENGTH) });
    expect(parseIdeaReason("x".repeat(MAX_REASON_LENGTH + 1))).toEqual({ ok: false });
  });
});

describe("grouping the list", () => {
  const rows = [
    row({ id: "a", score: 5, status: "new" }),
    row({ id: "b", score: 50, status: "new" }),
    row({ id: "c", score: 20, status: "accepted" }),
    row({ id: "d", score: 10, status: "built" }),
    row({ id: "e", score: 1, status: "dismissed" }),
  ];
  it("puts new ideas best first, accepted and built together, and set-aside ones last", () => {
    const g = groupIdeas(rows, LABELS);
    expect(g.fresh.map((c) => c.id)).toEqual(["b", "a"]);
    expect(g.accepted.map((c) => c.id)).toEqual(["c", "d"]);
    expect(g.dismissed.map((c) => c.id)).toEqual(["e"]);
  });
});

describe("how the community uses Weaver", () => {
  const usage = (over: Partial<UsageRow>): UsageRow => ({ item_key: "screen:/events", item_kind: "screen", surface: "portal", events: 10, errors: 0, ...over });
  const rows: UsageRow[] = [
    usage({ events: 40 }),
    usage({ events: 15, errors: 2 }), // the same screen on another platform or app version: added together
    usage({ item_key: "giving.record_payment", item_kind: "action", events: 22, errors: 3 }),
    usage({ item_key: "screen:/", surface: "member", events: 60 }),
    usage({ item_key: "screen:/", surface: "portal", events: 5 }),
    usage({ item_key: "events.some_new_thing", item_kind: "action", events: 1 }),
  ];
  it("adds up what happened and where, without counting people", () => {
    const s = summariseUsage(rows, LABELS);
    expect(s.total).toBe(143);
    expect(s.inApp).toBe(60);
    expect(s.inPortal).toBe(83);
    expect(Object.keys(s).sort()).toEqual(["actions", "inApp", "inPortal", "screens", "total"]);
  });
  it("lists the busiest screens and actions in the catalog's words, each surface with its own label", () => {
    const s = summariseUsage(rows, LABELS);
    expect(s.screens).toEqual([
      { label: "Home screen of the app", where: "app", times: 60, failed: 0 },
      { label: "All events", where: "portal", times: 55, failed: 2 },
      { label: "Home", where: "portal", times: 5, failed: 0 },
    ]);
    expect(s.actions.map((a) => a.label)).toEqual(["Record a payment", "Some new thing"]);
  });
  it("shows at most the number asked for", () => {
    expect(summariseUsage(rows, LABELS, 1).screens).toHaveLength(1);
  });
  it("is empty for no rows", () => {
    expect(summariseUsage([], LABELS)).toEqual({ total: 0, inPortal: 0, inApp: 0, screens: [], actions: [] });
  });
});
