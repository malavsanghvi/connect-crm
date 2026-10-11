import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The forms call Server Actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/automation/actions", () => ({ decideIdeaAction: vi.fn() }));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { IdeaList, UsagePanel } from "@/app/(app)/settings/automation/ideas-view";
import { buildIdeaCard, buildLabelMap, summariseUsage, type IdeaRow } from "@/lib/activity/ideas";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const LABELS = buildLabelMap([
  { key: "giving.record_payment", label: "Record a payment", surface: "portal" },
  { key: "giving.confirm_bank_match", label: "Confirm a bank match", surface: "portal" },
]);
const IDEA = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";
const row = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: IDEA,
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
const card = (over: Partial<IdeaRow> = {}) => buildIdeaCard(row(over), LABELS, { treasurer: "Treasurer" });

describe("Settings › Automation ideas · the list", () => {
  const html = render(createElement(IdeaList, { title: "Ideas to look at", cards: [card()], empty: "No ideas yet." }));

  it("shows the idea in plain English with its numbers, who does it and what it could become", () => {
    expect(html).toContain("After you record a payment you usually confirm a bank match.");
    expect(html).toContain("Done about 18 times a month by 3 people, about 40 minutes a month.");
    expect(html).toContain("Done by: Treasurer");
    expect(html).toContain("something Niva could do for you");
  });
  it("offers Accept and Not useful, with an optional reason, for a new idea", () => {
    expect(html).toContain(">Accept<");
    expect(html).toContain(">Not useful<");
    expect(html).toContain('name="reason"');
    expect(html).toContain("optional");
    expect(html).toContain('name="decision"');
    expect(html).toContain('value="accept"');
    expect(html).toContain('value="dismiss"');
    expect(html).toContain(`name="from" value="new"`);
  });
  it("carries the idea's id only in the form that answers it, never in the words", () => {
    expect(html).toContain(`name="id" value="${IDEA}"`);
    expect(html.replace(`name="id" value="${IDEA}"`, "")).not.toContain(IDEA);
    expect(html).not.toContain("giving.record_payment");
  });
  it("says so when there is nothing to show", () => {
    expect(render(createElement(IdeaList, { title: "Ideas to look at", cards: [], empty: "No ideas yet." }))).toContain("No ideas yet.");
  });
  it("lets an accepted idea be set aside or put back, and a set-aside one be brought back", () => {
    const accepted = render(createElement(IdeaList, { title: "Ideas you accepted", cards: [card({ status: "accepted" })], empty: "" }));
    expect(accepted).toContain("Not useful after all");
    expect(accepted).toContain("Put back in the list");
    expect(accepted).not.toContain(">Accept<");
    const dismissed = render(createElement(IdeaList, { title: "Ideas you set aside", cards: [card({ status: "dismissed" })], empty: "" }));
    expect(dismissed).toContain("Bring back");
    expect(dismissed).not.toContain('value="dismiss"');
  });
  it("shows a built idea as built, with no buttons", () => {
    const built = render(createElement(IdeaList, { title: "Ideas you accepted", cards: [card({ status: "built" })], empty: "" }));
    expect(built).toContain("Built");
    expect(built).not.toContain("<button");
  });
  it("says an idea has gone quiet instead of showing numbers of zero", () => {
    const quiet = render(createElement(IdeaList, { title: "Ideas you accepted", cards: [card({ status: "accepted", support: 0, distinct_actors: 0, minutes_per_month: 0 })], empty: "" }));
    expect(quiet).toContain("not seen this lately");
    expect(quiet).not.toContain("0 people");
  });
});

describe("Settings › Automation ideas · how the community uses Weaver", () => {
  it("says there is nothing yet, and what is needed, when nothing is counted", () => {
    const html = render(createElement(UsagePanel, { usage: summariseUsage([], LABELS) }));
    expect(html).toContain("How the community uses Weaver");
    expect(html).toContain("Nothing to show yet");
    expect(html).toContain("at least 3 people");
  });
  it("shows counts in the catalog's words and nothing personal", () => {
    const usage = summariseUsage(
      [
        { item_key: "giving.record_payment", item_kind: "action", surface: "portal", events: 120, errors: 4 },
        { item_key: "screen:/", item_kind: "screen", surface: "member", events: 30, errors: 0 },
      ],
      LABELS,
    );
    const html = render(createElement(UsagePanel, { usage }));
    expect(html).toContain("150");
    expect(html).toContain("Record a payment");
    expect(html).toContain("120 times");
    expect(html).toContain("4 did not work");
    expect(html).toContain("in the member app");
    expect(html).toContain("counts only");
  });
});

describe("Weaver staff looking at a community that shares", () => {
  it("see the ideas but get no buttons: only the community's own administrator answers", () => {
    const html = render(createElement(IdeaList, { title: "Ideas to look at", cards: [card()], empty: "", canAnswer: false }));
    expect(html).toContain("After you record a payment you usually confirm a bank match.");
    expect(html).not.toContain("<button");
    expect(html).not.toContain('name="reason"');
  });
});
