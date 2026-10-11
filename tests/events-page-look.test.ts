import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/app/(app)/events/[id]/classic-event-page", () => ({ ClassicEventPage: vi.fn(() => null) }));
vi.mock("@/app/(app)/events/[id]/workspace-page", () => ({ EventWorkspacePage: vi.fn(() => null) }));

import { cookies } from "next/headers";

import { ClassicEventPage } from "@/app/(app)/events/[id]/classic-event-page";
import EventPage, { metadata } from "@/app/(app)/events/[id]/page";
import { EventWorkspacePage } from "@/app/(app)/events/[id]/workspace-page";
import { LOOK_COOKIE } from "@/lib/look";

// The event page chooses by the person's look: the new look's Events workspace for "v2", the classic page for everyone else, with
// the same params and search params. The classic page itself was moved, unchanged, into classic-event-page.tsx.

const props = { params: Promise.resolve({ id: "00000000-0000-4000-8000-00000000e001" }), searchParams: Promise.resolve({ tab: "rsvps" }) };

function withLook(value: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (name === LOOK_COOKIE && value !== undefined ? { name, value } : undefined) } as never);
}

beforeEach(() => vi.mocked(cookies).mockReset());

describe("the event page wrapper", () => {
  it("keeps the title", () => {
    expect(metadata).toEqual({ title: "Event" });
  });

  it("shows the classic page, with the same props, to anyone who has not chosen the new look", async () => {
    for (const look of [undefined, "classic", "V2", "junk"]) {
      withLook(look);
      const el = (await EventPage(props)) as { type: unknown; props: unknown };
      expect(el.type, String(look)).toBe(ClassicEventPage);
      expect(el.props).toEqual(props);
    }
  });

  it("shows the Events workspace, with the same props, in the new look", async () => {
    withLook("v2");
    const el = (await EventPage(props)) as { type: unknown; props: unknown };
    expect(el.type).toBe(EventWorkspacePage);
    expect(el.props).toEqual(props);
  });

  it("left the classic page's own markup where it was: header, status buttons, the seven classic tabs", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/app/(app)/events/[id]/classic-event-page.tsx", import.meta.url)), "utf8");
    expect(src).toContain("export async function ClassicEventPage({ params, searchParams }");
    for (const key of ["details", "checklist", "rsvps", "volunteers", "lunch", "survey", "report"]) expect(src).toContain(`{ key: "${key}", label:`);
    expect(src).toContain('<AskNiva prompt="What is blocking this event from going live, and how is it doing?" />');
    expect(src).toContain("EVENT_STATUS_BUTTONS[event.status]");
  });
});
