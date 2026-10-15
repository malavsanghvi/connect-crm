import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The dev-only preview of Spotlight (src/app/dev/spotlight): sample pages and the real treasurer tour pointed at them, no database, and
// never in production.
vi.mock("server-only", () => ({}));
vi.mock("@/app/demo/actions", () => ({ startDemoAction: vi.fn(), leaveDemoAction: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import SpotlightBooksPreview from "@/app/dev/spotlight/books/page";
import SpotlightPreviewLayout from "@/app/dev/spotlight/layout";
import SpotlightHomePreview from "@/app/dev/spotlight/page";
import { PREVIEW_PAGES, previewTour } from "@/app/dev/spotlight/preview-tour";
import { TREASURER_BANK_MATCH } from "@/lib/spotlight/tours/treasurer-bank-match";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the dev preview route", () => {
  it("returns notFound() in production, on every page", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const page of [() => SpotlightHomePreview(), () => SpotlightBooksPreview(), () => SpotlightPreviewLayout({ children: null })]) {
      expect(page).toThrow(expect.objectContaining({ digest: expect.stringContaining("404") }));
    }
  });

  // Vitest runs with NODE_ENV "test": outside production, like `next dev`.
  it("draws the treasurer's Home with the row the tour starts from, outside production", () => {
    const html = renderToStaticMarkup(SpotlightHomePreview());
    expect(html).toContain('data-spotlight="home-bank-task"');
    expect(html).toContain("4 bank lines to match");
  });

  it("draws the QuickBooks tiles the tour ends on", () => {
    const html = renderToStaticMarkup(SpotlightBooksPreview());
    expect(html).toContain('data-spotlight="qbo-sync-status"');
    expect(html).toContain("Posted today");
  });
});

describe("the preview tour", () => {
  const preview = previewTour();

  it("is the real tour, with the same steps, words and targets, so what is tried here is what the treasurer gets", () => {
    expect(preview.steps.map((s) => s.id)).toEqual(TREASURER_BANK_MATCH.steps.map((s) => s.id));
    expect(preview.steps.map((s) => [s.target, s.title, s.body, s.optional, s.interactive])).toEqual(
      TREASURER_BANK_MATCH.steps.map((s) => [s.target, s.title, s.body, s.optional, s.interactive]),
    );
  });

  it("only goes to the sample pages, never to a real page that needs a session", () => {
    const samples = new Set(Object.values(PREVIEW_PAGES));
    for (const s of preview.steps) if (s.href) expect(samples.has(s.href), `${s.id}: ${s.href}`).toBe(true);
    for (const real of Object.keys(PREVIEW_PAGES)) expect(preview.steps.some((s) => s.href === real)).toBe(false);
  });

  it("does not change the real tour", () => {
    expect(TREASURER_BANK_MATCH.steps.some((s) => s.href?.startsWith("/dev/"))).toBe(false);
  });
});
