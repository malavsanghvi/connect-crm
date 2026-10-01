import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { matchPayers } from "@/lib/onboarding/match";
import {
  ROW_CHUNK,
  STAGES,
  answersForQuestions,
  chunkRows,
  createStarted,
  describeDatasets,
  firstUnanswered,
  isEmptyPatch,
  isParsedDonation,
  isParsedPerson,
  isStoredGroup,
  mergePatches,
  parseProgressPayload,
  resumeStage,
} from "@/lib/onboarding/progress";

const draftJson = (over: Record<string, unknown> = {}) => ({
  id: "7f3a2c00-1111-4222-8333-444455556666",
  stage: "review",
  version: 7,
  state: { v: 1, datasets: { donations: { status: "loaded", fileName: "gifts.csv", rows: 2345 }, members: { status: "skipped" } }, qi: 3 },
  merge_answers: { "r2~r9": "merge", "r4~hh:abc": "separate", bogus: "maybe" },
  outcomes: { households: { runId: "11111111-1111-4111-8111-111111111111", runNumber: 12, state: "stopped", created: 0, updated: 0, failed: 0, stopKind: "decision", stoppedFor: "3 rows need your decision" } },
  created_by_name: "Ada Shah",
  updated_by_name: "Tara Mehta",
  created_at: "2026-09-30T10:00:00Z",
  updated_at: "2026-09-30T11:30:00Z",
  stored: { donations: 2345, members: 0, family: 0, plan: 0 },
  can: { donations: true, members: true, family: true, plan: true },
  ...over,
});

describe("reading what the database saved", () => {
  it("a draft comes back typed, with only valid answers", () => {
    const p = parseProgressPayload({ draft: draftJson(), last: null })!;
    expect(p.draft!.id).toBe("7f3a2c00-1111-4222-8333-444455556666");
    expect(p.draft!.stage).toBe("review");
    expect(p.draft!.version).toBe(7);
    expect(p.draft!.answers).toEqual({ "r2~r9": "merge", "r4~hh:abc": "separate" });
    expect(p.draft!.outcomes.households).toMatchObject({ runNumber: 12, state: "stopped", stopKind: "decision" });
    expect(p.draft!.stored.donations).toBe(2345);
    expect(p.draft!.can.plan).toBe(true);
    expect(p.draft!.createdByName).toBe("Ada Shah");
  });

  it("no draft, and the last finished one, are both understood", () => {
    const p = parseProgressPayload({ draft: null, last: { finished_at: "2026-09-01T00:00:00Z", finished_by: "Ada Shah", outcomes: { people: { runId: "x", runNumber: 3, state: "done", created: 10, updated: 2, failed: 0 } } } })!;
    expect(p.draft).toBeNull();
    expect(p.last).toMatchObject({ finishedBy: "Ada Shah", finishedAt: "2026-09-01T00:00:00Z" });
    expect(p.last!.outcomes.people).toMatchObject({ runNumber: 3, state: "done", created: 10 });
  });

  it("something that is not that shape is refused, never guessed at", () => {
    expect(parseProgressPayload(null)).toBeNull();
    expect(parseProgressPayload("draft")).toBeNull();
    expect(parseProgressPayload({ draft: { stage: "review" }, last: null })).toBeNull();
  });

  it("an unknown stage falls back to the first step; a list the person may not read is not readable", () => {
    const d = parseProgressPayload({ draft: draftJson({ stage: "elsewhere", can: { donations: false } }), last: null })!.draft!;
    expect(d.stage).toBe("donations");
    expect(d.can).toEqual({ donations: false, members: false, family: false, plan: false });
  });
});

describe("checking saved rows before trusting them", () => {
  const donation = { rowNo: 2, name: "Malav Sanghvi", amountCents: 100100, receivedOn: "2024-09-02", method: "zelle", extras: {} };
  const person = { rowNo: 1000002, firstName: "Malav", lastName: "Sanghvi", extras: {} };
  it("accepts rows in the form the wizard saved and refuses the rest", () => {
    expect(isParsedDonation(donation)).toBe(true);
    expect(isParsedDonation({ ...donation, amountCents: 10.5 })).toBe(false);
    expect(isParsedDonation({ ...donation, name: 5 })).toBe(false);
    expect(isParsedDonation(null)).toBe(false);
    expect(isParsedPerson(person)).toBe(true);
    expect(isParsedPerson({ ...person, firstName: undefined })).toBe(false);
    expect(isParsedPerson([])).toBe(false);
  });
  it("the saved household plan is checked the same way", () => {
    const g = { id: 0, rows: [2, 3], displayName: "Sanghvi family", names: ["Sanghvi family"], existing: null, alsoMatches: [] };
    expect(isStoredGroup(g)).toBe(true);
    expect(isStoredGroup({ ...g, existing: { householdId: "h", number: "OFS-H-2001", label: "Sanghvi" } })).toBe(true);
    expect(isStoredGroup({ ...g, existing: { householdId: "h" } })).toBe(false);
    expect(isStoredGroup({ ...g, rows: ["2"] })).toBe(false);
    expect(isStoredGroup({ ...g, alsoMatches: [{}] })).toBe(false);
  });
});

describe("chunks", () => {
  it("rows go to the database in batches of at most 250, in order, none lost", () => {
    const rows = Array.from({ length: 601 }, (_, i) => i);
    const parts = chunkRows(rows);
    expect(ROW_CHUNK).toBe(250);
    expect(parts.map((p) => p.length)).toEqual([250, 250, 101]);
    expect(parts.flat()).toEqual(rows);
    expect(chunkRows([])).toEqual([]);
  });
  it("stays inside what the database takes in one call", () => {
    expect(ROW_CHUNK).toBeLessThanOrEqual(300);
  });
});

describe("saving in bursts", () => {
  it("later values win, and a burst of answers goes out as one save", () => {
    const a = mergePatches(null, { answers: { q1: "merge" }, state: { qi: 1 } });
    const b = mergePatches(a, { answers: { q2: "separate", q1: null }, state: { qi: 2, compareExisting: false }, stage: "review" });
    expect(b).toEqual({ stage: "review", state: { qi: 2, compareExisting: false }, answers: { q1: null, q2: "separate" } });
  });
  it("a stage set earlier is kept unless a later one replaces it", () => {
    expect(mergePatches({ stage: "members" }, { state: { qi: 0 } }).stage).toBe("members");
    expect(mergePatches({ stage: "members" }, { stage: "family" }).stage).toBe("family");
  });
  it("outcomes merge by run", () => {
    const run = (n: number) => ({ runId: `r${n}`, runNumber: n, state: "done" as const, created: n, updated: 0, failed: 0 });
    expect(mergePatches({ outcomes: { households: run(1) } }, { outcomes: { people: run(2) } }).outcomes).toEqual({ households: run(1), people: run(2) });
  });
  it("knows when there is nothing to send", () => {
    expect(isEmptyPatch(null)).toBe(true);
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ state: { qi: 0 } })).toBe(false);
    expect(isEmptyPatch({ stage: "review" })).toBe(false);
  });
});

describe("answers and where to resume", () => {
  const r = matchPayers([
    { rowNo: 2, name: "Malav Sanghvi", phone: "2815550142" },
    { rowNo: 3, name: "Palak Sheth", phone: "281-555-0142" },
    { rowNo: 4, name: "Amit Patel", phone: "713-555-0000" },
    { rowNo: 5, name: "Amit Shah", phone: "713-555-0000" },
  ]);
  it("a saved answer belongs to its question, whatever number the question has now", () => {
    expect(r.questions).toHaveLength(2);
    const saved = { [r.questions[1]!.key]: "merge" as const };
    expect(answersForQuestions(r.questions, saved)).toEqual({ [r.questions[1]!.id]: "merge" });
  });
  it("resumes at the first question without an answer", () => {
    expect(firstUnanswered(r.questions, {})).toBe(0);
    expect(firstUnanswered(r.questions, { [r.questions[0]!.id]: "merge" })).toBe(1);
    expect(firstUnanswered(r.questions, { [r.questions[0]!.id]: "merge", [r.questions[1]!.id]: "separate" })).toBe(2);
  });
  it("a draft that was left on the welcome step resumes at the first step", () => {
    expect(resumeStage({ stage: "welcome" })).toBe("donations");
    expect(resumeStage({ stage: "review" })).toBe("review");
    expect(STAGES).toContain(resumeStage({ stage: "confirm" }));
  });
  it("Create has started once any run was made (going back could disagree with what exists)", () => {
    expect(createStarted({})).toBe(false);
    expect(createStarted({ households: { runId: "r", runNumber: 1, state: "started", created: 0, updated: 0, failed: 0 } })).toBe(true);
  });
});

describe("the 'Continue where you left off' card", () => {
  it("says what is saved in words, without a single personal value", () => {
    const view = parseProgressPayload({ draft: draftJson({ stored: { donations: 2345, members: 0, family: 0, plan: 0 } }), last: null })!.draft!;
    const lines = describeDatasets(view);
    expect(lines.map((l) => l.dataset)).toEqual(["donations", "members", "family"]);
    expect(lines[0]!.text).toBe("2,345 checked rows saved from gifts.csv");
    expect(lines[1]!.text).toBe("skipped");
    expect(lines[2]!.text).toBe("not started");
  });
  it("a file chosen but not finished is named, and a list the person cannot read is said so", () => {
    const view = parseProgressPayload({
      draft: draftJson({ state: { datasets: { members: { status: "mapping", fileName: "members.xlsx" } } }, stored: { donations: 10, members: 0, family: 0, plan: 0 }, can: { donations: false, members: true, family: true, plan: true } }),
      last: null,
    })!.draft!;
    const lines = describeDatasets(view);
    expect(lines[0]!.text).toContain("you do not have access to read them back");
    expect(lines[1]!.text).toContain("members.xlsx was chosen but not finished");
  });
});

// Personal data in the saved rows is treated like import staging data: nothing in the server actions may write a
// row, a value or a database error's `details` (a constraint error quotes the row there) to a log.
describe("the server actions keep personal data out of logs", () => {
  const src = readFileSync(join(process.cwd(), "src/app/(app)/setup/onboarding/actions.ts"), "utf8");
  it("does not use the shared failure() helper, which logs the whole error object", () => {
    expect(src).not.toMatch(/import\s*\{[^}]*\bfailure\b[^}]*\}\s*from\s*"@\/lib\/errors"/);
    expect(src).not.toMatch(/\bfailure\(/);
  });
  it("logs only an error's code and message", () => {
    const logs = src.match(/console\.error\([^;]*\);/g) ?? [];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).toMatch(/code: e\.code \?\? null, message: String\(e\.message/);
      expect(l).not.toMatch(/details|rows|input/);
    }
  });
});
