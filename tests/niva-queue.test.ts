import { describe, expect, it } from "vitest";

import {
  cleanNivaBody,
  displayUrl,
  groupQueueItems,
  importedSourceUrl,
  isNivaRetryFailure,
  NIVA_RETRY_FAILED,
  NIVA_RETRY_LIMIT,
  NIVA_SOURCE_MAX_CHARS,
  nivaBodyCounter,
  nivaBodyLength,
  nivaBodyProblem,
  pageDecisionWhat,
  pageRowLabel,
  pageTitleOf,
  paginateQueue,
  publishedMessage,
  publishPageConfirm,
  publishSourceConfirm,
  queuePageSummary,
  retryFailedContext,
  retrySentence,
  sectionHeading,
  type QueueSourceRow,
} from "@/lib/niva-queue";

const URL_A = "https://jsh.org/relocation-faq/";
const URL_B = "https://jsh.org/new-to-houston";

function row(id: string, over: Partial<QueueSourceRow> = {}): QueueSourceRow {
  return { id, title: `Item ${id}`, kind: "niva_source", created_by: "u1", updated_at: "2026-10-01T10:00:00+00:00", metadata: {}, ...over };
}
function section(id: string, url: string, n: number, title: string, at = "2026-10-01T10:00:00+00:00", pageTitle = "JSH Relocation FAQs"): QueueSourceRow {
  return row(id, { title, updated_at: at, metadata: { imported: true, source_url: url, page_title: pageTitle, section: n } });
}

describe("a Niva source's text", () => {
  it("is counted as the database counts it, after the save's clean-up", () => {
    expect(nivaBodyLength("  hello \r\n world  ")).toBe("hello \n world".length);
    expect(cleanNivaBody("a\r\nb\rc")).toBe("a\nb\nc");
    // Code points, not UTF-16 units: char_length() counts an emoji once.
    expect(nivaBodyLength("🙏")).toBe(1);
    expect(nivaBodyLength("જય જિનેન્દ્ર")).toBe(Array.from("જય જિનેન્દ્ર").length);
    expect(nivaBodyLength(null)).toBe(0);
  });

  it("may be empty in a draft, but never when sent for approval", () => {
    expect(nivaBodyProblem("", false)).toBeNull();
    expect(nivaBodyProblem("   \n ", false)).toBeNull();
    expect(nivaBodyProblem("", true)).toBe("a Niva source needs its text before it is sent for approval. Write the text Niva may answer from, then send it again.");
    expect(nivaBodyProblem("Derasar opens at 6:30 am.", true)).toBeNull();
  });

  it("holds 4,000 characters at most, saved or sent", () => {
    expect(NIVA_SOURCE_MAX_CHARS).toBe(4000);
    expect(nivaBodyProblem("x".repeat(4000), true)).toBeNull();
    for (const sending of [false, true]) {
      expect(nivaBodyProblem("x".repeat(4312), sending)).toBe(
        "the text is 4,312 characters, 312 more than a source holds. Split it into two sources — Niva reads a source in full only up to 4,000 characters.",
      );
    }
    // A Windows line break counts once: this text is 3,001 characters as saved, not 4,501.
    expect(nivaBodyLength("a\r\n".repeat(1500) + "b")).toBe(3001);
    expect(nivaBodyProblem("a\r\n".repeat(1500) + "b", true)).toBeNull();
  });

  it("an imported section (3,600 characters at most) always fits", () => {
    expect(nivaBodyProblem("y".repeat(3600), true)).toBeNull();
  });

  it("shows a live counter that turns red once the text is too long", () => {
    expect(nivaBodyCounter("")).toEqual({ label: "0 of 4,000 characters — add the text before sending it for approval", tone: "warn" });
    expect(nivaBodyCounter("x".repeat(1234))).toEqual({ label: "1,234 of 4,000 characters", tone: "ok" });
    expect(nivaBodyCounter("x".repeat(4001))).toEqual({ label: "4,001 of 4,000 characters — 1 too many; split it into two sources", tone: "bad" });
  });
});

describe("grouping the queue by imported page", () => {
  it("knows an imported source by its page address, and nothing else", () => {
    expect(importedSourceUrl("niva_source", { source_url: URL_A })).toBe(URL_A);
    expect(importedSourceUrl("niva_source", { source_url: "  " })).toBeNull();
    expect(importedSourceUrl("niva_source", {})).toBeNull();
    expect(importedSourceUrl("niva_source", null)).toBeNull();
    expect(importedSourceUrl("guide_page", { source_url: URL_A })).toBeNull();
  });

  it("makes one row per page, sections in page order, other items one row each", () => {
    const rows = [
      row("hand", { title: "Membership dues", updated_at: "2026-09-30T09:00:00+00:00" }),
      section("a2", URL_A, 2, "JSH Relocation FAQs: Parking", "2026-10-01T10:00:00+00:00"),
      row("sutra", { kind: "sutra", title: "Navkar", updated_at: "2026-10-01T10:00:00+00:00" }),
      section("b1", URL_B, 1, "New to Houston: Welcome", "2026-10-01T11:00:00+00:00", "New to Houston"),
      section("a1", URL_A, 1, "JSH Relocation FAQs: Moving day", "2026-10-01T09:30:00+00:00"),
      section("a3", URL_A, 3, "JSH Relocation FAQs: Prayer hall", "2026-10-01T10:00:00+00:00"),
    ];
    const q = groupQueueItems(rows);
    expect(q.map((e) => (e.kind === "page" ? `page:${e.url}` : `item:${e.id}`))).toEqual([`item:hand`, `page:${URL_A}`, `item:sutra`, `page:${URL_B}`]);
    const a = q[1];
    if (a.kind !== "page") throw new Error("expected a page");
    expect(a.title).toBe("JSH Relocation FAQs");
    expect(a.sections.map((s) => s.id)).toEqual(["a1", "a2", "a3"]);
    expect(a.sections.map((s) => s.heading)).toEqual(["Moving day", "Parking", "Prayer hall"]);
    // A page sits where its oldest section would.
    expect(a.at).toBe("2026-10-01T09:30:00+00:00");
    expect(a.by).toEqual(["u1"]);
    expect(q[0]).toEqual({ kind: "item", id: "hand", title: "Membership dues", itemKind: "niva_source", by: "u1", at: "2026-09-30T09:00:00+00:00" });
  });

  it("names the page from page_title, else the section titles, else the address", () => {
    expect(pageTitleOf([{ title: "x", metadata: { page_title: " Timings " } }], URL_A)).toBe("Timings");
    expect(pageTitleOf([{ title: "Pathshala: Classes", metadata: { page_title: "" } }], URL_A)).toBe("Pathshala");
    expect(pageTitleOf([{ title: "Classes", metadata: {} }], "https://jsh.org/pathshala/")).toBe("jsh.org/pathshala");
    expect(displayUrl("https://jsh.org/")).toBe("jsh.org");
    expect(displayUrl("not a url")).toBe("not a url");
  });

  it("strips the page title from a section's heading only when it is in front", () => {
    expect(sectionHeading("Timings: Weekdays", "Timings")).toBe("Weekdays");
    expect(sectionHeading("Weekdays", "Timings")).toBe("Weekdays");
    expect(sectionHeading("Timings: ", "Timings")).toBe("Timings: ");
    expect(sectionHeading("Timings: Weekdays", "")).toBe("Timings: Weekdays");
  });

  it("labels a page row with its title, section count and address", () => {
    expect(pageRowLabel({ title: "JSH Relocation FAQs", url: URL_A, sections: [1, 2] })).toBe(`JSH Relocation FAQs · 2 sections · ${URL_A}`);
    expect(pageRowLabel({ title: "New to Houston", url: URL_B, sections: [1] })).toBe(`New to Houston · 1 section · ${URL_B}`);
  });
});

describe("pages of the queue", () => {
  const items = Array.from({ length: 450 }, (_, i) => ({ id: i, w: 1 }));

  it("shows about 200 at a time and says how many more are waiting", () => {
    const p1 = paginateQueue(items, (r) => r.w, 1);
    expect(p1.rows).toHaveLength(200);
    expect(p1).toMatchObject({ page: 1, pages: 3, total: 450, from: 1, to: 200, after: 250 });
    expect(queuePageSummary(p1)).toBe("Showing 1–200 of 450 waiting. 250 more are waiting after this page.");
    const p3 = paginateQueue(items, (r) => r.w, 3);
    expect(p3).toMatchObject({ page: 3, from: 401, to: 450, after: 0 });
    expect(queuePageSummary(p3)).toBe("Showing 401–450 of 450 waiting.");
  });

  it("never splits a page's sections across pages of the queue", () => {
    const rows = [...Array.from({ length: 190 }, () => ({ w: 1 })), { w: 40 }, ...Array.from({ length: 5 }, () => ({ w: 1 }))];
    const p1 = paginateQueue(rows, (r) => r.w, 1);
    expect(p1.rows).toHaveLength(190);
    const p2 = paginateQueue(rows, (r) => r.w, 2);
    expect(p2.rows[0]).toEqual({ w: 40 });
    expect(p2).toMatchObject({ from: 191, to: 235, after: 0, pages: 2 });
    // A page heavier than a whole page of the queue gets one of its own.
    const big = paginateQueue([{ w: 250 }, { w: 1 }], (r) => r.w, 1);
    expect(big.rows).toHaveLength(1);
    expect(big.after).toBe(1);
  });

  it("clamps a page number that does not exist, and copes with an empty queue", () => {
    expect(paginateQueue(items, (r) => r.w, 99).page).toBe(3);
    expect(paginateQueue(items, (r) => r.w, 0).page).toBe(1);
    expect(paginateQueue([], () => 1, 1)).toEqual({ rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0, after: 0 });
    expect(queuePageSummary({ from: 1, to: 200, total: 201, after: 1 })).toBe("Showing 1–200 of 201 waiting. 1 more is waiting after this page.");
  });
});

describe("publishing to Niva", () => {
  it("asks first, saying Niva repeats whatever is approved", () => {
    expect(publishPageConfirm(12)).toBe("Publish all 12 sections of this page to Niva? Niva repeats whatever is approved.");
    expect(publishPageConfirm(1)).toBe("Publish the one section of this page to Niva? Niva repeats whatever is approved.");
    expect(publishSourceConfirm("Derasar timings")).toBe("Publish “Derasar timings” to Niva? Niva repeats whatever is approved.");
  });

  it("says how many unanswered questions will be tried again", () => {
    expect(publishedMessage(`"Derasar timings"`, 3)).toBe(`"Derasar timings" published. 3 unanswered questions will be tried again.`);
    expect(publishedMessage(`"Derasar timings"`, 1)).toBe(`"Derasar timings" published. 1 unanswered question will be tried again.`);
    expect(publishedMessage(`"Derasar timings"`, 0)).toBe(`"Derasar timings" published. No unanswered questions were waiting.`);
    // The Niva module is off: nothing to try, so nothing is claimed.
    expect(publishedMessage(`"Derasar timings"`, null)).toBe(`"Derasar timings" published.`);
    expect(retrySentence(NIVA_RETRY_LIMIT)).toBe(
      "150 unanswered questions will be tried again, the most at one time; any others are tried the next time a source is published.",
    );
  });

  it("names a retry that failed after the publish, so the queue can offer it again", () => {
    expect(retryFailedContext(`"Derasar timings"`, true)).toBe(`"Derasar timings" was published, but Niva could not try its unanswered questions again`);
    expect(retryFailedContext(pageDecisionWhat(12, 12, "JSH Relocation FAQs"), false)).toBe(
      "All 12 sections of “JSH Relocation FAQs” were published, but Niva could not try its unanswered questions again",
    );
    // failure() appends the reason: the banner still knows it.
    expect(isNivaRetryFailure(`${retryFailedContext(`"Derasar timings"`, true)} — Niva is switched off for this community.`)).toBe(true);
    expect(isNivaRetryFailure(`Could not publish the item — "Derasar timings" is no longer awaiting approval.`)).toBe(false);
    expect(isNivaRetryFailure(undefined)).toBe(false);
    expect(NIVA_RETRY_FAILED).toBe("Niva could not try its unanswered questions again");
  });

  it("says what a page decision changed, including sections that had moved on", () => {
    expect(pageDecisionWhat(12, 12, "JSH Relocation FAQs")).toBe("All 12 sections of “JSH Relocation FAQs”");
    expect(pageDecisionWhat(1, 1, "New to Houston")).toBe("The one section of “New to Houston”");
    expect(pageDecisionWhat(9, 12, "JSH Relocation FAQs")).toBe("9 of the 12 sections of “JSH Relocation FAQs” (the other 3 were no longer waiting)");
    expect(pageDecisionWhat(11, 12, "X")).toBe("11 of the 12 sections of “X” (the other 1 was no longer waiting)");
    expect(publishedMessage(pageDecisionWhat(12, 12, "JSH Relocation FAQs"), 5)).toBe(
      "All 12 sections of “JSH Relocation FAQs” published. 5 unanswered questions will be tried again.",
    );
  });
});
