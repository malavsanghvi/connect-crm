import { describe, expect, it } from "vitest";

import {
  groupUnanswered,
  NIVA_OUTCOMES,
  NIVA_TEST_DAILY_LIMIT,
  NIVA_TEST_MAX_WAIT_MS,
  NIVA_TEST_POLL_MS,
  NIVA_USAGE_WARN_AT,
  nivaAnswerFrom,
  nivaAnswerFromKinds,
  nivaAnswerFromLine,
  nivaBodyPreview,
  nivaConversationView,
  nivaHealthView,
  nivaOutcomeLabel,
  nivaOutcomeStatus,
  nivaSourceGroupKey,
  nivaSourceStatus,
  nivaSourceTotals,
  nivaTestFinished,
  nivaTestOutcome,
  nivaTestPhase,
  nivaTestSourceStatus,
  nivaTestsToday,
  nivaTestWaitingLine,
  nivaUsage,
  parseNivaTestAsked,
  parseNivaTestResult,
  sourceCountsLine,
  splitIntoGroups,
  summarizeSourceGroups,
  type NivaSourceLite,
} from "@/lib/niva";

const C = "00000000-0000-4000-8000-000000000001";

describe("why a Niva question has no answer", () => {
  it("words every outcome the database records", () => {
    expect(NIVA_OUTCOMES).toEqual(["pending", "answered", "no_source", "unsure", "refused", "paused", "failed"]);
    expect(nivaOutcomeLabel("pending")).toBe("Waiting for Niva");
    expect(nivaOutcomeLabel("answered")).toBe("Answered");
    expect(nivaOutcomeLabel("no_source")).toBe("No approved source mentions these words");
    expect(nivaOutcomeLabel("unsure")).toBe("Sources found but none clearly answers it");
    expect(nivaOutcomeLabel("unsure", "Niva found sources, but none of them clearly answers the question.")).toBe("Sources found but none clearly answers it");
    expect(nivaOutcomeLabel("unsure", "Niva wrote an answer but could not point to an approved source for it, so it was not shown.")).toBe(
      "Niva wrote an answer but could not point to an approved source for it, so it was not shown",
    );
    expect(nivaOutcomeLabel("refused")).toBe("Niva declined");
    expect(nivaOutcomeLabel("paused", "The AI service's spending limit was reached; Niva will try again at 3:00 pm.")).toBe(
      "AI service paused — The AI service's spending limit was reached; Niva will try again at 3:00 pm.",
    );
    expect(nivaOutcomeLabel("failed", "The AI service refused the Anthropic API key.")).toBe("Failed — The AI service refused the Anthropic API key.");
  });
  it("says only the outcome when there is no detail, and never shows a fixed outcome's detail", () => {
    expect(nivaOutcomeLabel("paused", null)).toBe("AI service paused");
    expect(nivaOutcomeLabel("failed", "  ")).toBe("Failed");
    expect(nivaOutcomeLabel("no_source", "No approved source mentions what was asked.")).toBe("No approved source mentions these words");
    expect(nivaOutcomeLabel(undefined)).toBe("Not known");
    expect(nivaOutcomeLabel("something_new", "x")).toBe("something new — x");
  });
  it("gives each outcome a short status", () => {
    expect(nivaOutcomeStatus("answered")).toEqual({ label: "Answered", tone: "ok" });
    expect(nivaOutcomeStatus("pending")).toEqual({ label: "Waiting", tone: "warn" });
    expect(nivaOutcomeStatus("paused")).toEqual({ label: "Paused", tone: "warn" });
    expect(nivaOutcomeStatus("failed")).toEqual({ label: "Failed", tone: "bad" });
    expect(nivaOutcomeStatus("no_source").label).toBe("Unanswered");
    expect(nivaOutcomeStatus("unsure").label).toBe("Unanswered");
    expect(nivaOutcomeStatus("refused").label).toBe("Unanswered");
  });
  it("a question that shows an answer is answered; a later try that kept it says why", () => {
    expect(nivaConversationView({ answer: "Open 6 am to 9 pm.", answer_status: "answered", outcome_detail: null })).toEqual({
      status: { label: "Answered", tone: "ok" },
      why: "—",
    });
    expect(nivaConversationView({ answer: "Open 6 am to 9 pm.", answer_status: "answered", outcome_detail: "Niva found sources, but none of them clearly answers the question." }).why).toBe(
      "The last try kept this answer: Niva found sources, but none of them clearly answers the question.",
    );
    expect(nivaConversationView({ answer: null, answer_status: "no_source", outcome_detail: null })).toEqual({
      status: { label: "Unanswered", tone: "warn" },
      why: "No approved source mentions these words",
    });
    expect(nivaConversationView({ answer: null, answer_status: "answered", outcome_detail: null }).why).toBe("Waiting for Niva");
  });
});

describe("unanswered questions grouped by what was asked", () => {
  const rows = [
    { id: "a1", question: "When is Paryushan?", answer_status: "no_source", outcome_detail: null, created_at: "2026-09-28T10:00:00Z" },
    { id: "a2", question: "  when is   paryushan? ", answer_status: "failed", outcome_detail: "The AI service refused the key.", created_at: "2026-09-30T10:00:00Z" },
    { id: "b1", question: "Is there parking?", answer_status: "pending", outcome_detail: null, created_at: "2026-10-01T09:00:00Z" },
    { id: "c1", question: "   ", answer_status: "pending", outcome_detail: null, created_at: "2026-10-01T09:00:00Z" },
  ];
  it("groups by normalised text, keeps every id newest first, and shows the newest outcome", () => {
    const g = groupUnanswered(rows);
    expect(g).toHaveLength(2);
    expect(g[0]).toEqual({
      text: "when is   paryushan?",
      ids: ["a2", "a1"],
      n: 2,
      latest: { status: "failed", detail: "The AI service refused the key.", created_at: "2026-09-30T10:00:00Z" },
    });
    expect(g[1].ids).toEqual(["b1"]);
  });
  it("orders by how often it was asked, then most recent, and keeps the top N", () => {
    const tie = [
      { id: "x", question: "Old one", answer_status: "unsure", outcome_detail: null, created_at: "2026-09-01T00:00:00Z" },
      { id: "y", question: "New one", answer_status: "unsure", outcome_detail: null, created_at: "2026-09-02T00:00:00Z" },
    ];
    expect(groupUnanswered(tie).map((q) => q.text)).toEqual(["New one", "Old one"]);
    expect(groupUnanswered(tie, 1).map((q) => q.text)).toEqual(["New one"]);
  });
});

describe("Niva sources grouped by imported page", () => {
  const url = "https://www.jainsocietyhouston.org/faq";
  const other = "https://www.jainsocietyhouston.org/about";
  const imp = (id: string, status: string, u = url, extra: Record<string, unknown> = {}): NivaSourceLite => ({
    id,
    center_id: C,
    status,
    metadata: { imported: true, source_url: u, page_title: "FAQ", ...extra },
  });
  const rows: NivaSourceLite[] = [
    imp("1", "published"),
    imp("2", "published"),
    imp("3", "in_review"),
    imp("4", "draft"),
    imp("5", "retired"),
    imp("6", "approved"),
    imp("7", "draft", other, { page_title: "" }),
    { id: "8", center_id: C, status: "published", metadata: {} },
    { id: "9", center_id: C, status: "draft", metadata: { items_count: 3 } },
    { id: "10", center_id: null, status: "published", metadata: { source_url: url } },
  ];
  it("keys a row by page address; shared rows and those written here have their own group", () => {
    expect(nivaSourceGroupKey(rows[0])).toBe(`url:${url}`);
    expect(nivaSourceGroupKey(rows[7])).toBe("hand");
    expect(nivaSourceGroupKey({ center_id: C, metadata: { source_url: "  " } })).toBe("hand");
    expect(nivaSourceGroupKey({ center_id: C, metadata: null })).toBe("hand");
    expect(nivaSourceGroupKey(rows[9])).toBe("shared");
  });
  it("counts each page's sections as included, waiting (approved too), draft and retired", () => {
    const g = summarizeSourceGroups(rows);
    expect([...g.keys()]).toEqual([`url:${url}`, `url:${other}`, "hand", "shared"]);
    expect(g.get(`url:${url}`)).toEqual({
      key: `url:${url}`,
      kind: "page",
      url,
      pageTitle: "FAQ",
      counts: { total: 6, included: 2, waiting: 2, draft: 1, retired: 1 },
      importedDrafts: 1,
    });
    expect(g.get(`url:${other}`)).toMatchObject({ pageTitle: null, importedDrafts: 1, counts: { total: 1, draft: 1 } });
    expect(g.get("hand")).toMatchObject({ kind: "hand", url: null, importedDrafts: 0, counts: { total: 2, included: 1, draft: 1 } });
    expect(g.get("shared")).toMatchObject({ kind: "shared", url: null, counts: { total: 1, included: 1 } });
  });
  it("totals every source and counts the imported drafts that can be sent for approval", () => {
    expect(nivaSourceTotals(rows)).toEqual({ total: 10, included: 4, waiting: 2, draft: 3, retired: 1, importedDrafts: 2 });
  });
  it("words a group's counts", () => {
    expect(sourceCountsLine({ total: 6, included: 2, waiting: 2, draft: 1, retired: 1 })).toBe("6 sections · 2 included · 2 awaiting approval · 1 draft · 1 retired");
    expect(sourceCountsLine({ total: 1, included: 1, waiting: 0, draft: 0, retired: 0 })).toBe("1 section · 1 included");
  });
  it("splits one page of rows into consecutive groups", () => {
    const page = [rows[9], rows[7], rows[8], rows[0], rows[1], rows[6]];
    expect(splitIntoGroups(page).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["shared", ["10"]],
      ["hand", ["8", "9"]],
      [`url:${url}`, ["1", "2"]],
      [`url:${other}`, ["7"]],
    ]);
  });
  it("labels statuses from the content statuses, with Included for what Niva answers from", () => {
    expect(nivaSourceStatus("published")).toEqual({ label: "Included", tone: "ok" });
    expect(nivaSourceStatus("in_review")).toEqual({ label: "Awaiting approval", tone: "warn" });
    expect(nivaSourceStatus("approved")).toEqual({ label: "Approved, not included yet", tone: "warn" });
    expect(nivaSourceStatus("draft")).toEqual({ label: "Draft", tone: "warn" });
    expect(nivaSourceStatus("retired")).toEqual({ label: "Retired", tone: "bad" });
  });
  it("previews the first 200 characters of a source's text, on one line, cut at a word", () => {
    expect(nivaBodyPreview("Short\n\ntext.")).toBe("Short text.");
    expect(nivaBodyPreview(null)).toBe("");
    const long = `${"word ".repeat(60)}end`;
    const p = nivaBodyPreview(long);
    expect(p.endsWith("…")).toBe(true);
    expect(p.length).toBeLessThanOrEqual(201);
    expect(p).toBe(`${"word ".repeat(39)}word…`);
    expect(nivaBodyPreview("x".repeat(300), 200)).toBe(`${"x".repeat(200)}…`);
  });
});

describe("usage against the monthly question limit", () => {
  it("counts against the limit and warns from 80 %", () => {
    expect(NIVA_USAGE_WARN_AT).toBe(0.8);
    expect(nivaUsage(142, 300)).toEqual({ used: 142, limit: 300, pct: 142 / 300, level: "ok", label: "142 of 300 questions this month" });
    expect(nivaUsage(239, 300).level).toBe("ok");
    expect(nivaUsage(240, 300).level).toBe("warn");
    expect(nivaUsage(299, 300).level).toBe("warn");
    expect(nivaUsage(300, 300).level).toBe("full");
    expect(nivaUsage(301, 300).level).toBe("full");
    expect(nivaUsage(1200, 5000).label).toBe("1,200 of 5,000 questions this month");
  });
  it("has no warning without a limit", () => {
    expect(nivaUsage(1, null)).toMatchObject({ limit: null, pct: null, level: "ok", label: "1 question this month · no monthly limit" });
    expect(nivaUsage(0, 0).level).toBe("full");
  });
});

describe("Niva health (app.niva_health)", () => {
  const healthy = {
    state: "running",
    last_beat_at: "2026-10-02T12:00:00Z",
    age_seconds: 20,
    module_on: true,
    handler: { configured: true },
    jobs: { queued: 0, running: 0, failed_24h: 0, done_24h: 12, next_run_after: null, last_error: null, last_error_at: null, last_error_status: null },
    month: { used: 42, limit: 300 },
    outcomes_7d: { pending: 0, answered: 10, no_source: 2, unsure: 0, refused: 0, paused: 0, failed: 0 },
  };
  it("says nothing when Niva can answer, and reads the usage", () => {
    const v = nivaHealthView(healthy);
    expect(v.problems).toEqual([]);
    expect(v.state).toBe("running");
    expect(v.usage?.label).toBe("42 of 300 questions this month");
    expect(v.jobs.done24h).toBe(12);
    expect(v.outcomes7d.no_source).toBe(2);
  });
  it("speaks up when the background service never started or has stopped", () => {
    const never = nivaHealthView({ ...healthy, state: "not_configured", age_seconds: null, handler: null });
    expect(never.problems).toHaveLength(1);
    expect(never.problems[0]).toMatchObject({ tone: "danger", retry: false });
    expect(never.problems[0].title).toMatch(/never started/);
    const stopped = nivaHealthView({ ...healthy, state: "stopped", age_seconds: 7200 });
    expect(stopped.problems[0].title).toMatch(/has stopped/);
    expect(stopped.problems[0].detail).toMatch(/2 hours ago/);
  });
  it("speaks up when Niva's answering job is not set up, with the service's reason", () => {
    const v = nivaHealthView({ ...healthy, handler: { configured: false, reason: "ANTHROPIC_API_KEY is not set" } }, { canRetry: true });
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toMatchObject({ tone: "danger", retry: true });
    expect(v.problems[0].detail).toMatch(/^The background service says: ANTHROPIC_API_KEY is not set\. /);
    expect(v.problems[0].detail).toMatch(/Press "Try all unanswered questions again" once it is fixed\.$/);
  });
  it("speaks up while questions of the last 7 days are failed, with the last error", () => {
    const failed = { ...healthy, jobs: { ...healthy.jobs, failed_24h: 3, last_error: "The Anthropic key on the background service was refused (401)" }, outcomes_7d: { ...healthy.outcomes_7d, failed: 3 } };
    const v = nivaHealthView(failed, { canRetry: true });
    expect(v.problems[0].title).toBe("3 questions from the last 7 days could not be answered");
    expect(v.problems[0].detail).toMatch(/^The last error: The Anthropic key on the background service was refused \(401\)\. /);
    expect(v.problems[0].retry).toBe(true);
    // A question that failed twice is one question.
    expect(nivaHealthView({ ...failed, outcomes_7d: { ...healthy.outcomes_7d, failed: 1 } }).problems[0].title).toBe("1 question from the last 7 days could not be answered");
  });
  it("says nothing about failures once every failed question was answered by a later try", () => {
    const fixed = { ...healthy, jobs: { ...healthy.jobs, failed_24h: 5, last_error: "The Anthropic key on the background service was refused (401)" } };
    expect(nivaHealthView(fixed, { canRetry: true }).problems).toEqual([]);
  });
  it("speaks up when questions are paused by the AI service's spending limit", () => {
    const v = nivaHealthView({ ...healthy, outcomes_7d: { ...healthy.outcomes_7d, paused: 4 } }, { canRetry: true });
    expect(v.problems).toEqual([expect.objectContaining({ tone: "warning", retry: true, title: "4 questions are waiting for the AI service" })]);
    expect(v.problems[0].detail).toMatch(/Once the limit is raised, press "Try all/);
  });
  it("tells staff without the button that a content manager can press it", () => {
    const bad = { ...healthy, handler: { configured: false }, outcomes_7d: { ...healthy.outcomes_7d, failed: 2, paused: 1 } };
    const details = nivaHealthView(bad).problems.map((p) => p.detail);
    expect(details).toHaveLength(3);
    for (const d of details) expect(d).toMatch(/a content manager can press "Try all unanswered questions again"/);
    expect(details[0]).toMatch(/Once it is fixed, a content manager can press/);
    expect(details[1]).toMatch(/Once the cause is fixed, a content manager can press/);
    for (const d of details) expect(d).not.toMatch(/Press "Try all/);
  });
  it("lists several problems together, and none while Niva is switched off", () => {
    const bad = { ...healthy, state: "stopped", handler: { configured: false }, jobs: { ...healthy.jobs, failed_24h: 2 }, outcomes_7d: { ...healthy.outcomes_7d, failed: 2, paused: 1 } };
    expect(nivaHealthView(bad).problems.map((p) => p.tone)).toEqual(["danger", "danger", "danger", "warning"]);
    expect(nivaHealthView({ ...bad, module_on: false }).problems).toEqual([]);
  });
  it("reads a missing or odd answer safely", () => {
    const v = nivaHealthView(null);
    expect(v).toMatchObject({ state: "unknown", problems: [], usage: null, testsToday: null, jobs: { queued: 0, failed24h: 0, lastError: null } });
    expect(nivaHealthView({ ...healthy, month: { used: 5, limit: "300" } }).usage?.limit).toBeNull();
  });
  it("reads today's staff tests (0575), and nothing before 0575", () => {
    expect(nivaHealthView(healthy).testsToday).toBeNull();
    expect(nivaHealthView({ ...healthy, tests_today: { used: 12, limit: 100 } }).testsToday).toMatchObject({ used: 12, limit: 100, left: 88, full: false, label: "12 of 100 staff tests today" });
    expect(nivaHealthView({ ...healthy, tests_today: { used: 100, limit: 100 } }).testsToday?.full).toBe(true);
  });
});

describe("staff tests (app.niva_test_ask and app.niva_test_result, 0575)", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const base = {
    id: T,
    question: "Where do I park?",
    answer: null,
    answer_status: "pending",
    outcome_detail: null,
    created_at: "2026-10-02T12:00:00Z",
    answered_at: null,
    attempted_at: null,
    model: null,
    include_in_review: false,
    job: { status: "queued", attempts: 0, max_attempts: 3, run_after: "2026-10-02T12:00:00Z" },
    sources: [],
  };
  const parse = (over: Record<string, unknown> = {}) => {
    const r = parseNivaTestResult({ ...base, ...over });
    if (!r) throw new Error("did not parse");
    return r;
  };

  it("keeps a daily allowance of 100 tests per community, and says when it is used up", () => {
    expect(NIVA_TEST_DAILY_LIMIT).toBe(100);
    expect(nivaTestsToday(0)).toEqual({ used: 0, limit: 100, left: 100, full: false, label: "0 of 100 staff tests today" });
    expect(nivaTestsToday(99).full).toBe(false);
    expect(nivaTestsToday(100)).toMatchObject({ left: 0, full: true });
    expect(nivaTestsToday(100).label).toMatch(/^All 100 of today's staff tests are used\. Testing opens again tomorrow/);
    expect(nivaTestsToday(Number.NaN, 0)).toMatchObject({ used: 0, limit: 100 });
  });

  it("reads what niva_test_ask returns", () => {
    expect(parseNivaTestAsked({ id: T, question: "Where do I park?", created_at: "x", include_in_review: true, tests_today: 3, daily_limit: 100 })).toEqual({
      id: T,
      question: "Where do I park?",
      includeInReview: true,
      testsToday: nivaTestsToday(3, 100),
    });
    expect(parseNivaTestAsked(null)).toBeNull();
    expect(parseNivaTestAsked({ question: "no id" })).toBeNull();
  });

  it("reads what niva_test_result returns, and an odd answer safely", () => {
    const r = parse({
      answer: "Park in the east lot.",
      answer_status: "answered",
      model: "claude-opus-5-5",
      include_in_review: true,
      job: { status: "done", attempts: 1, max_attempts: 3, run_after: "2026-10-02T12:00:00Z" },
      sources: [
        { id: "a", title: "Parking", url: "https://example.org/visit", kind: "niva_source", status: "in_review" },
        { id: "guide_section:b", title: "Visiting", url: null, kind: "guide_section", status: "published" },
        { title: "no id" },
        "junk",
      ],
    });
    expect(r).toMatchObject({ answer: "Park in the east lot.", answerStatus: "answered", model: "claude-opus-5-5", includeInReview: true });
    expect(r.job).toEqual({ status: "done", attempts: 1, maxAttempts: 3, runAfter: "2026-10-02T12:00:00Z" });
    expect(r.sources).toEqual([
      { id: "a", title: "Parking", url: "https://example.org/visit", kind: "niva_source", status: "in_review" },
      { id: "guide_section:b", title: "Visiting", url: null, kind: "guide_section", status: "published" },
    ]);
    expect(parse({ job: null, sources: null })).toMatchObject({ job: null, sources: [] });
    expect(parseNivaTestResult({ ...base, id: null })).toBeNull();
    expect(parseNivaTestResult("nope")).toBeNull();
  });

  it("keeps checking while the test waits, and stops after 90 seconds", () => {
    expect(NIVA_TEST_POLL_MS).toBeGreaterThanOrEqual(2000);
    expect(NIVA_TEST_POLL_MS).toBeLessThanOrEqual(3000);
    expect(NIVA_TEST_MAX_WAIT_MS).toBe(90_000);
    expect(nivaTestPhase(null, 0)).toBe("waiting");
    expect(nivaTestPhase(parse(), 30_000)).toBe("waiting");
    expect(nivaTestPhase(parse({ job: { status: "running", attempts: 1 } }), 89_999)).toBe("waiting");
    expect(nivaTestPhase(parse(), 90_000)).toBe("timed_out");
    expect(nivaTestPhase(null, 95_000)).toBe("timed_out");
    // "answered" with no answer to show is not an outcome yet.
    expect(nivaTestPhase(parse({ answer_status: "answered" }), 5_000)).toBe("waiting");
  });

  it("stops as soon as the test has an answer or an outcome, or its job ended without one", () => {
    expect(nivaTestFinished(parse({ answer: "Yes.", answer_status: "answered" }))).toBe(true);
    for (const s of ["no_source", "unsure", "refused", "paused", "failed"]) expect(nivaTestPhase(parse({ answer_status: s }), 1_000)).toBe("done");
    // The AI service is not set up: the job fails before Niva runs, and the question stays pending.
    expect(nivaTestPhase(parse({ job: { status: "failed", attempts: 1 } }), 1_000)).toBe("done");
    expect(nivaTestPhase(parse({ job: { status: "done", attempts: 1 } }), 1_000)).toBe("done");
    expect(nivaTestFinished(parse({ job: null }))).toBe(false);
  });

  it("says what is happening while it waits", () => {
    expect(nivaTestWaitingLine(null, 2_400)).toBe("Niva is looking this up… (2 s)");
    expect(nivaTestWaitingLine(parse(), 5_000)).toBe("Waiting for the background service to pick the question up… (5 s)");
    expect(nivaTestWaitingLine(parse({ job: { status: "running", attempts: 1 } }), 7_500)).toBe("Niva is reading the sources and writing an answer… (8 s)");
    expect(nivaTestWaitingLine(parse({ job: { status: "queued", attempts: 1 } }), 20_000)).toBe("The first try ran into a problem; Niva is trying again… (20 s)");
  });

  it("shows an answer, and warns when members would not get it yet", () => {
    const pub = { id: "a", title: "Timings", url: null, kind: "niva_source", status: "published" };
    const ok = nivaTestOutcome(parse({ answer: "6 AM.", answer_status: "answered", sources: [pub] }));
    expect(ok).toEqual({ status: { label: "Answered", tone: "ok" }, why: null, note: null });
    const waiting = nivaTestOutcome(parse({ answer: "East lot.", answer_status: "answered", sources: [pub, { ...pub, id: "b", status: "in_review" }] }));
    expect(waiting.note).toMatch(/^Members would not get this answer yet: it uses a source that is not included in Niva/);
    const two = nivaTestOutcome(
      parse({ answer: "East lot.", answer_status: "answered", sources: [{ ...pub, status: "draft" }, { ...pub, id: "g", kind: "guide_section", status: "hidden" }] }),
    );
    expect(two.note).toMatch(/it uses 2 sources that are not included/);
  });

  it("says why a test has no answer", () => {
    expect(nivaTestOutcome(parse({ answer_status: "no_source" }))).toMatchObject({ why: "No approved source mentions these words" });
    expect(nivaTestOutcome(parse({ answer_status: "no_source", include_in_review: true })).why).toBe("No source mentions these words, approved or waiting for approval");
    expect(nivaTestOutcome(parse({ answer_status: "unsure" })).why).toBe("Sources found but none clearly answers it");
    expect(nivaTestOutcome(parse({ answer_status: "paused", outcome_detail: "Niva will try again at 3:00 PM." }))).toMatchObject({
      status: { label: "Paused", tone: "warn" },
      why: "AI service paused — Niva will try again at 3:00 PM.",
    });
    const jobFailed = nivaTestOutcome(parse({ job: { status: "failed", attempts: 1 } }));
    expect(jobFailed.status).toEqual({ label: "Failed", tone: "bad" });
    expect(jobFailed.why).toMatch(/^The background service could not run Niva's answering job/);
    expect(nivaTestOutcome(parse({ job: { status: "done", attempts: 1 } })).why).toMatch(/^Niva finished without saying why/);
    expect(nivaTestOutcome(parse()).why).toBe("Waiting for Niva");
  });

  it("labels each cited source by whether members get answers from it", () => {
    expect(nivaTestSourceStatus({ kind: "niva_source", status: "published" })).toEqual({ label: "Included", tone: "ok" });
    expect(nivaTestSourceStatus({ kind: "faq", status: "published" })).toEqual({ label: "FAQ, published", tone: "ok" });
    expect(nivaTestSourceStatus({ kind: "guide_section", status: "published" })).toEqual({ label: "Guide section, public", tone: "ok" });
    expect(nivaTestSourceStatus({ kind: "guide_section", status: "hidden" })).toEqual({ label: "Guide section, not public", tone: "warn" });
    expect(nivaTestSourceStatus({ kind: "niva_source", status: "in_review" })).toEqual({ label: "Awaiting approval", tone: "warn" });
    expect(nivaTestSourceStatus({ kind: "niva_source", status: "retired" }).tone).toBe("bad");
    expect(nivaTestSourceStatus({ kind: null, status: "missing" })).toEqual({ label: "No longer exists", tone: "bad" });
  });
});

describe("what Niva also answers from (centers.rules.niva.answer_from)", () => {
  it("reads the rules: approved sources always, the Guide and FAQ when listed", () => {
    expect(nivaAnswerFrom(null)).toEqual({ guide: false, faq: false });
    expect(nivaAnswerFrom({ version: 3 })).toEqual({ guide: false, faq: false });
    expect(nivaAnswerFrom({ niva: { answer_from: ["niva_source"] } })).toEqual({ guide: false, faq: false });
    expect(nivaAnswerFrom({ niva: { answer_from: ["niva_source", "guide", "faq"] } })).toEqual({ guide: true, faq: true });
    expect(nivaAnswerFrom({ niva: { answer_from: ["faq"] } })).toEqual({ guide: false, faq: true });
    expect(nivaAnswerFrom({ niva: { answer_from: "guide" } })).toEqual({ guide: false, faq: false });
  });
  it("sends only the optional kinds, in a fixed order", () => {
    expect(nivaAnswerFromKinds({ guide: false, faq: false })).toEqual([]);
    expect(nivaAnswerFromKinds({ guide: true, faq: true })).toEqual(["guide", "faq"]);
    expect(nivaAnswerFromKinds({ guide: false, faq: true })).toEqual(["faq"]);
  });
  it("says it in a sentence", () => {
    expect(nivaAnswerFromLine({ guide: false, faq: false })).toBe("Niva answers from its approved sources only.");
    expect(nivaAnswerFromLine({ guide: true, faq: false })).toBe("Niva answers from its approved sources and the Guide's public sections.");
    expect(nivaAnswerFromLine({ guide: false, faq: true })).toBe("Niva answers from its approved sources and published FAQ items.");
    expect(nivaAnswerFromLine({ guide: true, faq: true })).toBe("Niva answers from its approved sources, the Guide's public sections and published FAQ items.");
  });
});
