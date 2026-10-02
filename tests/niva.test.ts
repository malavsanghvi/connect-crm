import { describe, expect, it } from "vitest";

import {
  groupUnanswered,
  NIVA_OUTCOMES,
  NIVA_USAGE_WARN_AT,
  nivaBodyPreview,
  nivaConversationView,
  nivaHealthView,
  nivaOutcomeLabel,
  nivaOutcomeStatus,
  nivaSourceGroupKey,
  nivaSourceStatus,
  nivaSourceTotals,
  nivaUsage,
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
    expect(v).toMatchObject({ state: "unknown", problems: [], usage: null, jobs: { queued: 0, failed24h: 0, lastError: null } });
    expect(nivaHealthView({ ...healthy, month: { used: 5, limit: "300" } }).usage?.limit).toBeNull();
  });
});
