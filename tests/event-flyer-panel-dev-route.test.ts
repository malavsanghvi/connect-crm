import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The panel imports its Server Actions (server-only modules); the preview never calls them.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import EventFlyerPanelPreview from "@/app/dev/event-flyer-panel/page";
import { FIXTURES, PREVIEW_KINDS, sampleSetup } from "@/app/dev/event-flyer-panel/fixtures";
import { POST as render } from "@/app/dev/event-flyer-panel/render/route";
import { approvalState, publishState } from "@/lib/events/publish-schedule";

// The dev-only preview of the event creator's flyer and publish panel (src/app/dev/event-flyer-panel): sample events for a
// church, a chamber and a temple, real renders without a database, and never in production.

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (sp: Record<string, string> = {}) => EventFlyerPanelPreview({ searchParams: Promise.resolve(sp) });
const post = (body: unknown) => render(new Request("http://localhost/dev/event-flyer-panel/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

describe("the dev preview of the flyer and publish panel", () => {
  it("returns notFound() in production, and the render route answers 404 there", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect((await post({ design: sampleSetup("church", "draft").defaults, kind: "church" })).status).toBe(404);
  });

  it("draws the page with sample data outside production, for every kind", async () => {
    for (const kind of PREVIEW_KINDS) {
      const html = renderToStaticMarkup(await call({ kind }));
      expect(html).toContain("DEV PREVIEW · SAMPLE DATA");
      expect(html).toContain(FIXTURES[kind].org);
    }
  });

  it("has fixtures in each state the panel shows", () => {
    expect(approvalState(sampleSetup("chamber", "draft").event, sampleSetup("chamber", "draft").event).state).toBe("none");
    const scheduled = sampleSetup("temple", "scheduled");
    expect(approvalState(scheduled.event, scheduled.event).state).toBe("approved");
    expect(publishState({ ...scheduled.event, guestVisible: true })).toBe("scheduled");
    expect(publishState({ ...sampleSetup("church", "live").event, guestVisible: true })).toBe("live");
    expect(publishState({ ...sampleSetup("church", "failed").event, guestVisible: true })).toBe("failed");
    // Only a kind that keeps a tradition gets its occasion packs; the others draw the general pack.
    expect(sampleSetup("church", "draft").defaults.poster?.occasion).toBe("general");
    expect(sampleSetup("temple", "draft").defaults.poster?.occasion).toBe("diwali");
  });

  it("renders a real PNG without a database, and refuses a photo it cannot load", async () => {
    const res = await post({ design: sampleSetup("chamber", "draft").defaults, kind: "chamber" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const photo = await post({ design: { ...sampleSetup("chamber", "draft").defaults, template: "photo", background: { source: "photo", photo_id: "33333333-3333-4333-8333-333333333333" } }, kind: "chamber" });
    expect(photo.status).toBe(422);
    expect((await post({ design: { nope: true } })).status).toBe(400);
  }, 60_000);
});
