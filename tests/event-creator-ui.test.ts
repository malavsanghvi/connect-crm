// The guided event creator's screens: the dev preview (sample data, never in production) draws every card for every kind of
// community without a database; the Events page's "New event" is unchanged in the classic look; and nothing in the creator's
// code names one tradition or one customer.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dev/event-creator",
}));
vi.mock("@/app/(app)/events/people-search", () => ({ searchPeopleAction: vi.fn() }));

import EventCreatorPreview from "@/app/dev/event-creator/page";
import { NewEventActions } from "@/components/event-creator/new-event-actions";
import { buttonClass } from "@/components/ui";
import Link from "next/link";
import { CARD_IDS } from "@/lib/event-creator/types";

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (sp: Record<string, string> = {}) => EventCreatorPreview({ searchParams: Promise.resolve(sp) });

describe("the dev preview of the creator", () => {
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws the temple's first card with its calendar and history suggestions, and a placeholder flyer", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const html = renderToStaticMarkup(await call());
    expect(html).toContain("DEV PREVIEW · SAMPLE DATA");
    expect(html).toContain("Create an event");
    expect(html).toContain("What are we calling it, and when is it?");
    expect(html).toContain("Diwali, on your Festivals calendar.");
    expect(html).toContain("From your calendar");
    expect(html).toContain("From your history");
    expect(html).toContain("Your flyer draft appears here");
    expect(html).toContain("Ready to publish");
    expect(html).toContain("Advanced form");
  });

  it.each(CARD_IDS)("draws the %s card for every kind of community", async (step) => {
    for (const kind of ["temple", "church", "chamber", "club"]) {
      const html = renderToStaticMarkup(await call({ kind, step }));
      expect(html, `${kind}/${step}`).toContain('id="creator-question"');
    }
  });

  it("the club's More settings holds tickets, meals and the reminder, and says why", async () => {
    const html = renderToStaticMarkup(await call({ kind: "club", more: "1" }));
    expect(html).toContain("Anything else to set?");
    expect(html).toContain("Your last 3 events were all free, so tickets and donations are here.");
    expect(html).toContain("Give people a meal time at check-in");
    expect(html).toContain("Ask people to confirm before the day");
    expect(html).toContain("Owner (event lead)");
    expect(html).toContain("RSVP opens");
  });

  it("Review links onward and never offers to publish or send", async () => {
    const html = renderToStaticMarkup(await call({ step: "review" }));
    expect(html).toContain("Open the event page");
    expect(html).toContain("Saved as a draft. Nothing is published and nothing has been sent.");
    expect(html).not.toMatch(/>Publish( event| now)?</);
    expect(html).not.toMatch(/>Send</);
  });

  it("Sending shows what is not built yet as Coming next", async () => {
    const html = renderToStaticMarkup(await call({ step: "sending" }));
    expect(html).toContain("Coming next");
    expect(html).toContain("Publishing to your website, Facebook and Instagram from here");
  });
});

describe("the Events page's New event button", () => {
  it("is unchanged in the classic look", () => {
    const before = renderToStaticMarkup(createElement(Link, { href: "/events/builder", className: buttonClass("primary") }, "New event"));
    expect(renderToStaticMarkup(createElement(NewEventActions, { v2: false }))).toBe(before);
  });

  it("opens the creator in the New look, with the builder as Advanced form", () => {
    const html = renderToStaticMarkup(createElement(NewEventActions, { v2: true }));
    expect(html).toContain('href="/events/new"');
    expect(html).toContain('href="/events/builder"');
    expect(html).toContain("Advanced form");
  });
});

describe("the creator's code serves every kind of organization", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  it("names no tradition and no customer (fixtures aside)", () => {
    const root = process.cwd();
    const list = [...files(join(root, "src/lib/event-creator")), ...files(join(root, "src/components/event-creator"))].filter((p) => !p.endsWith("fixtures.ts"));
    for (const p of list) expect(readFileSync(p, "utf8"), p).not.toMatch(/\bjain\b|\bjsh\b|derasar|gujarati|paryushan|jai jinendra/i);
  });
});
