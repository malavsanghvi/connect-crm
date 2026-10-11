import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The screen calls Server Actions and the router; here nothing is called, only rendered.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/setup/onboarding/questions/actions", () => ({
  findMatchesAction: vi.fn(),
  loadInboxAction: vi.fn(),
  loadItemAction: vi.fn(),
  answerQuestionAction: vi.fn(),
  deferQuestionAction: vi.fn(),
  reopenQuestionAction: vi.fn(),
}));

import { FindMatchesButton } from "@/app/(app)/setup/onboarding/questions/find-matches";
import { InboxScreen } from "@/app/(app)/setup/onboarding/questions/inbox-screen";
import { SIGNATURES, type Question } from "@/lib/onboarding/resolve/exceptions";
import type { RunMetrics } from "@/lib/onboarding/resolve/metrics";
import type { InboxGroup, InboxView } from "@/lib/onboarding/resolve/views";

import { run } from "./fixtures/onboarding-resolve/helpers";

function question(signature: keyof typeof SIGNATURES): Question {
  const spec = SIGNATURES[signature];
  return {
    id: `q:${signature}`,
    signature,
    tier: spec.tier,
    title: `3 rows share a phone number with a household that has a different address and family name. Are they the same household?`,
    detail: "The phone number matches. Nothing else does.",
    count: 3,
    answers: spec.answers.map((code, i) => ({ code, label: i === 0 ? "No, keep them separate" : "Yes, same household", recommended: i === 0 })),
    recommended: spec.answers[0],
    sameForRest: { available: true, others: 2, label: "" },
    rememberable: spec.rememberable,
    routeTo: spec.routeTo,
    examples: [],
    value: { moneyCents: 0, members: 3, contacts: 1 },
  };
}

const phone: InboxGroup = {
  id: "g-phone",
  signature: "shared_phone_households",
  tier: "C",
  status: "open",
  question: question("shared_phone_households"),
  recommended: "separate",
  routeSuggested: "membership",
  routedTo: null,
  subjectCount: 3,
  itemCount: 3,
  openItems: 3,
  answeredItems: 0,
  moneyCents: 0,
  members: 3,
  contacts: 1,
  rank: 0,
  answer: null,
  applyToRest: false,
  nextItemId: "i-1",
  money: false,
  sameForRest: true,
  rememberable: true,
};

const metrics: RunMetrics = {
  ...run([]).metrics,
  rows: 1000,
  auto: 818,
  held: 60,
  autoShare: 0.818,
  questions: 9,
  questionsPer1000: 9,
  questionTarget: 10,
  withinQuestionTarget: true,
  minutes: 9.4,
  withinMinuteTarget: true,
};

const view = (groups: InboxGroup[], over: Partial<InboxView> = {}): InboxView => ({
  status: "ready",
  stalled: false,
  engineVersion: "resolve-1",
  storedAt: "2026-10-11T10:00:00.000Z",
  recordCount: 1000,
  metrics,
  progress: {
    groupsTotal: groups.length,
    groupsOpen: groups.length,
    groupsAnswered: 0,
    groupsPostponed: 0,
    groupsSkipped: 0,
    groupsSent: 0,
    questionsLeft: groups.length,
    itemsTotal: 3,
    itemsOpen: 3,
    itemsAnswered: 0,
    answeredByPeople: 0,
    answeredByRules: 0,
    suggestionsAccepted: 0,
    firstAnsweredAt: null,
    lastAnsweredAt: null,
    minutesLeft: 0.6,
  },
  groups,
  ...over,
});

const html = (v: InboxView) => renderToStaticMarkup(createElement(InboxScreen, { runId: "r1", runLabel: "Import #3 · people.csv", initial: v }));

describe("the questions screen", () => {
  it("puts the plain question first, with the recommended answer chosen and marked", () => {
    const out = html(view([phone]));
    expect(out).toContain("3 rows share a phone number with a household that has a different address and family name. Are they the same household?");
    expect(out).toContain("The phone number matches. Nothing else does.");
    expect(out).toContain("Recommended");
    // The first radio (the recommended answer) is the one that is checked.
    const radios = out.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('checked=""');
    expect(radios[1]).not.toContain("checked");
  });

  it("offers one answer for one, the same answer for the others, later, skip, and ask someone else (coming soon)", () => {
    const out = html(view([phone]));
    expect(out).toContain("Use this answer");
    expect(out).toContain("Use the same answer for the other 2");
    expect(out).toContain(">Later<");
    expect(out).toContain(">Skip<");
    expect(out).toContain("Ask someone else");
    expect(out).toContain("coming soon");
    const ask = (out.match(/<button[^>]*>Ask someone else<\/button>/) ?? [""])[0];
    expect(ask).toContain("disabled");
  });

  it("shows the progress bar, the questions left and the minutes, and the numbers at the top", () => {
    const out = html(view([phone]));
    expect(out).toContain("1 question left");
    expect(out).toContain("less than a minute of your time");
    expect(out).toContain('role="progressbar"');
    expect(out).toContain("Resolved automatically");
    expect(out).toContain("82%");
    expect(out).toContain("818 of 1,000 rows");
    expect(out).toContain("Questions per 1,000 rows");
    expect(out).toContain("Minutes of your time");
    expect(out).toContain("Held for a person");
  });

  it("says that one answer cannot cover the others when it is money, and says nothing is remembered for a child", () => {
    const money: InboxGroup = { ...phone, id: "g-money", signature: "amount_differs", tier: "D", question: question("amount_differs"), recommended: "hold", money: true, sameForRest: false, rememberable: false, routeSuggested: "treasurer" };
    const out = html(view([money]));
    expect(out).not.toContain("Use the same answer for the other");
    expect(out).toContain("Each of these needs its own answer, because it involves money");
    expect(out).toContain("A person decides this each time. Nothing is remembered.");
    expect(out).toContain("The treasurer is best placed to answer this one.");
  });

  it("answers a child's row one at a time: no 'same answer for the others'", () => {
    const child: InboxGroup = { ...phone, id: "g-child", signature: "minor_record", tier: "D", question: question("minor_record"), recommended: "person_will_add", sameForRest: false, rememberable: false };
    const out = html(view([child]));
    expect(out).not.toContain("Use the same answer for the other");
    expect(out).toContain("Rows about children are answered one at a time.");
  });

  it("lists every question with where it stands, and offers to take answers back", () => {
    const answered: InboxGroup = { ...phone, id: "g-done", signature: "name_only", question: { ...question("name_only"), title: "2 rows only share a name. Are they the same person?" }, status: "answered", openItems: 0, answeredItems: 2, rank: 1, nextItemId: null };
    const out = html(view([phone, answered]));
    expect(out).toContain("All the questions");
    expect(out).toContain("2 rows only share a name. Are they the same person?");
    expect(out).toContain("Answered");
    expect(out).toContain("Take the answers back");
  });

  it("says plainly when there is nothing left, without claiming the import used the answers", () => {
    const out = html(view([{ ...phone, status: "answered", openItems: 0, answeredItems: 3, nextItemId: null }], { progress: { ...view([phone]).progress!, questionsLeft: 0, groupsAnswered: 1, minutesLeft: 0 } }));
    expect(out).toContain("No questions left to answer");
    expect(out).toContain("Everything is answered, skipped or passed on.");
    expect(out).toContain("The import will use them in a later update.");
    expect(out).toContain("Back to guided onboarding");
  });

  it("says when Weaver found nothing to ask", () => {
    const out = html(view([], { progress: { ...view([phone]).progress!, groupsTotal: 0, questionsLeft: 0, minutesLeft: 0 } }));
    expect(out).toContain("Weaver found nothing it needs to ask about in this file.");
  });
});

describe("the button that looks for matches", () => {
  it("is a button, and says the check takes a while only once it is running", () => {
    const out = renderToStaticMarkup(createElement(FindMatchesButton, { runId: "r1" }));
    expect(out).toContain("Look for matches");
    expect(out).not.toContain("Reading the rows");
  });
});
