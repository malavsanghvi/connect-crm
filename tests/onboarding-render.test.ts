import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The wizard's screens call server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/setup/onboarding/actions", () => ({
  startOnboardingAction: vi.fn(),
  saveProgressAction: vi.fn(),
  saveRowsAction: vi.fn(),
  loadRowsAction: vi.fn(),
  closeProgressAction: vi.fn(),
  loadExistingHouseholdsAction: vi.fn(),
  runStatusAction: vi.fn(),
  loadDecisionRowsAction: vi.fn(),
}));
vi.mock("@/app/(app)/settings/import/actions", () => ({
  startImportAction: vi.fn(),
  defineCustomFieldsAction: vi.fn(),
  stageRowsAction: vi.fn(),
  previewAction: vi.fn(),
  commitBatchAction: vi.fn(),
  cancelImportAction: vi.fn(),
  decideAction: vi.fn(),
}));

import { DatasetStep } from "@/app/(app)/setup/onboarding/dataset-step";
import { ReviewStep } from "@/app/(app)/setup/onboarding/review-step";
import { OnboardingWizard } from "@/app/(app)/setup/onboarding/wizard";
import { existingToInputs, type ExistingHousehold } from "@/lib/onboarding/existing";
import { matchPayers, resolveMerges } from "@/lib/onboarding/match";
import { parseProgressPayload } from "@/lib/onboarding/progress";

const sanghvi: ExistingHousehold = {
  id: "h1",
  number: "OFS-H-2001",
  name: "Malav & Palak Sanghvi",
  address1: "12 Lotus Lane",
  address2: null,
  city: "Sugar Land",
  zip: "77478",
  people: [
    { name: "Malav Sanghvi", email: "malav@example.com", phone: "+12815550142" },
    { name: "Palak Sanghvi", email: null, phone: null },
  ],
  aliases: [],
};

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the wizard's first screens", () => {
  const props = { centerName: "Orbit", timeZone: "America/Chicago", donationsBlocked: null, canCompareExisting: true };

  it("with nothing saved, offers to start", () => {
    const html = render(createElement(OnboardingWizard, { ...props, initial: { draft: null, last: null } }));
    expect(html).toContain("Let&#x27;s set up Orbit");
    expect(html).toContain(">Start<");
    expect(html).not.toContain("Continue where you left off");
    expect(html).toContain("your progress is saved as you go");
  });

  it("with a saved draft, offers to continue where it stopped, or start over, and shows no personal value", () => {
    const initial = parseProgressPayload({
      draft: {
        id: "7f3a2c00-1111-4222-8333-444455556666",
        stage: "review",
        version: 9,
        state: { datasets: { donations: { status: "loaded", fileName: "gifts.csv", rows: 2345 }, members: { status: "skipped" } } },
        merge_answers: { "r2~r9": "merge" },
        outcomes: {},
        created_by_name: "Ada Shah",
        updated_by_name: "Tara Mehta",
        created_at: "2026-09-30T10:00:00Z",
        updated_at: "2026-09-30T16:30:00Z",
        stored: { donations: 2345, members: 0, family: 0, plan: 0 },
        can: { donations: true, members: true, family: true, plan: true },
      },
      last: null,
    })!;
    const html = render(createElement(OnboardingWizard, { ...props, initial }));
    expect(html).toContain("Continue where you left off");
    expect(html).toContain("Started by Ada Shah");
    expect(html).toContain("Tara Mehta");
    expect(html).toContain("Households"); // the step it was at
    expect(html).toContain("2,345 checked rows saved from gifts.csv");
    expect(html).toContain("skipped");
    expect(html).toContain(">Continue<");
    expect(html).toContain(">Start over<");
    expect(html).toContain("1 saved");
  });

  it("after a finished onboarding, says so and links to the imports it made", () => {
    const initial = parseProgressPayload({
      draft: null,
      last: { finished_at: "2026-09-01T12:00:00Z", finished_by: "Ada Shah", outcomes: { households: { runId: "11111111-1111-4111-8111-111111111111", runNumber: 7, state: "done", created: 4, updated: 0, failed: 0 } } },
    })!;
    const html = render(createElement(OnboardingWizard, { ...props, initial }));
    expect(html).toContain("Guided onboarding was finished");
    expect(html).toContain("/settings/import/11111111-1111-4111-8111-111111111111");
    expect(html).toContain("households import #7");
  });
});

describe("the upload step", () => {
  it("says plainly when past donations cannot be loaded here, and offers to skip", () => {
    const html = render(
      createElement(DatasetStep, {
        kind: "donations",
        initial: null,
        meta: undefined,
        blocked: "Pledges & donations is switched off for your community, so past donations cannot be loaded.",
        onMeta: () => {},
        onSave: async () => {},
        onKeep: () => {},
        onSkip: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("switched off for your community");
    expect(html).toContain("Skip this step");
  });

  it("reminds a returning owner of the file they had chosen but not finished", () => {
    const html = render(
      createElement(DatasetStep, {
        kind: "members",
        initial: null,
        meta: { status: "mapping", fileName: "members.xlsx", fileRows: 812 },
        blocked: null,
        onMeta: () => {},
        onSave: async () => {},
        onKeep: () => {},
        onSkip: null,
        onBack: () => {},
      }),
    );
    expect(html).toContain("members.xlsx");
    expect(html).toContain("812 rows");
    expect(html).toContain("column choices are reused");
  });

  it("offers the saved rows instead of asking for the file again", () => {
    const html = render(
      createElement(DatasetStep, {
        kind: "family",
        initial: { kind: "family", rows: [{ rowNo: 2000002, firstName: "Arav", lastName: "Sanghvi", extras: {} } as never] },
        meta: { status: "loaded", fileName: "family.csv", rows: 1 },
        blocked: null,
        onMeta: () => {},
        onSave: async () => {},
        onKeep: () => {},
        onSkip: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("1 checked rows from family.csv are saved");
    expect(html).toContain("Continue with the saved rows");
  });
});

describe("the households review", () => {
  const upload = [
    { rowNo: 2, name: "Sanghvi, Malav", phone: "281-555-0142" },
    { rowNo: 3, name: "Amit Patel", phone: "713-555-0000" },
    { rowNo: 4, name: "Palak Sanghvi" },
  ];
  const match = matchPayers([...upload, ...existingToInputs([sanghvi])]);
  const lines = new Map([
    [2, { label: "Sanghvi, Malav", detail: "$1,001.00 · 2024-09-02" }],
    [3, { label: "Amit Patel", detail: "$51.00 · 2024-10-03" }],
    [4, { label: "Palak Sanghvi", detail: "$10.00 · 2024-10-04" }],
  ]);
  const base = {
    donations: 3,
    people: 0,
    existingById: new Map([[sanghvi.id, sanghvi]]),
    compared: true,
    existingNote: null,
    rowLines: lines,
    blockedAnswers: 0,
    onAnswer: () => {},
    onQuestion: () => {},
    onBack: () => {},
    onContinue: () => {},
  };

  it("names the households you already have, with enough to tell them apart, and says nothing new is created for them", () => {
    const finalGroups = resolveMerges(match, new Set()).groups;
    const html = render(createElement(ReviewStep, { ...base, match, finalGroups, answers: {}, qi: 0 }));
    expect(html).toContain("Already in your records: Malav &amp; Palak Sanghvi");
    expect(html).toContain("OFS-H-2001");
    expect(html).toContain("12 Lotus Lane");
    expect(html).toContain("members: Malav Sanghvi, Palak Sanghvi");
    expect(html).toMatch(/nothing new is created for (it|them)/);
    expect(html).toContain("1 donation");
  });

  it("asks a question that involves a household you already have with that household's own card", () => {
    const only = matchPayers([{ rowNo: 4, name: "Palak Sanghvi" }, ...existingToInputs([sanghvi])]);
    expect(only.questions).toHaveLength(1);
    const finalGroups = resolveMerges(only, new Set()).groups;
    const html = render(createElement(ReviewStep, { ...base, match: only, finalGroups, answers: {}, qi: 0 }));
    expect(html).toContain("Question 1 of 1");
    expect(html).toContain("Already in your records");
    expect(html).toContain("Yes, it is that household");
    expect(html).toContain("No, keep separate");
    expect(html).toContain("Same household?");
    // Nothing can be continued until it is answered.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Continue<\/button>/);
  });

  it("warns, rather than staying quiet, when the records could not be compared", () => {
    const solo = matchPayers(upload);
    const finalGroups = resolveMerges(solo, new Set()).groups;
    const html = render(createElement(ReviewStep, { ...base, match: solo, finalGroups, answers: {}, qi: 0, compared: false, existingNote: "You chose to go on without comparing with the households you already have." }));
    expect(html).toContain("You chose to go on without comparing");
    expect(html).toContain("may be created a second time");
  });
});
