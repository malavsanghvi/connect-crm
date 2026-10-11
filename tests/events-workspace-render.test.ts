import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The new-look Events workspace, rendered on the server with the dev preview's sample club (no database, no session). The rail and
// the top bar come from the real v2 shell; the Server Actions are replaced and nothing is called.
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  usePathname: () => "/events/00000000-0000-4000-8000-00000000e001",
  useParams: () => ({ id: "00000000-0000-4000-8000-00000000e001" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/tenancy-actions", () => ({ switchCenterAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("@/app/look-actions", () => ({ setLookAction: vi.fn() }));
vi.mock("@/app/(app)/events/[id]/workspace-actions", () => ({ draftEventChangeAction: vi.fn(), draftCloneAction: vi.fn(), audienceAtAction: vi.fn() }));

import AdminEventsPreview from "@/app/dev/admin-events/page";
import { EventOverview, type OverviewProps } from "@/components/events-v2/event-workspace";
import { PreviewNiva } from "@/components/events-v2/preview-niva";
import { sampleOverview } from "@/lib/events/workspace-fixtures";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const call = (sp: Record<string, string> = {}) => AdminEventsPreview({ searchParams: Promise.resolve(sp) });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the dev preview route", () => {
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws the event workspace inside the v2 shell, with Niva beside it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const html = renderToStaticMarkup(await call());
    const t = text(html);
    expect(html).toContain('data-look="v2"');
    expect(html).toContain('aria-label="Workspaces"');
    expect(t).toContain("Harvest Supper 2026");
    expect(t).toContain("Looking at: Harvest Supper 2026");
    expect(html).toContain('aria-label="Niva, for this event"');
    for (const tab of ["Overview", "RSVPs", "Meals", "Volunteers", "Check-in", "Feedback"]) expect(t).toContain(tab);
    for (const tile of ["Attending", "Households", "Meal seats taken", "Volunteers"]) expect(t).toContain(tile);
    expect(t).toContain("What is left before the day");
    // Not built yet: visible, and said so.
    expect(t).toContain("By area, against last year Coming next");
    expect(t).toContain("Month calendar Coming next");
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>Schedule the reminder<\/button>/);
    // The reminder in the community's own languages, not a fixed list.
    for (const lang of ["English", "Español", "हिन्दी"]) expect(html).toContain(`>${lang}`);
    expect(t).not.toMatch(/Gujarati|ગુજરાતી/);
    // Households as cards (numbers and adults), never a name alone; children are never listed.
    expect(t).toContain("Okafor household · 0144 · LCC-H-1873 · Riverside");
    expect(t).toContain("Adults: Chidi Okafor, Ada Okafor");
    expect(t).not.toMatch(/under 12|children/i);
    // Built for any organization: no tradition words.
    expect(t).not.toMatch(/Jain|Pathshala|derasar/);
  });

  it("starts on a language that needs translating when asked, and says so", async () => {
    const t = text(renderToStaticMarkup(await call({ lang: "es" })));
    expect(t).toContain("Needs translation");
    expect(t).toContain("Weaver has no Spanish wording for this yet, so this is the English text.");
  });
});

describe("the overview's honest states", () => {
  const base = sampleOverview() as OverviewProps;
  const render = (p: Partial<OverviewProps>) => text(renderToStaticMarkup(h(PreviewNiva, null, h(EventOverview, { ...base, ...p }))));

  it("says why a person cannot prepare a change or a copy, instead of a form", () => {
    const t = render({ cannot: { change: "Could not draft a change to an event — you don't have permission (needs events.manage).", clone: "Could not prepare a copy of an earlier event — you don't have permission (needs events.manage)." } });
    expect(t).toContain("Could not draft a change to an event — you don't have permission");
    expect(t).toContain("Could not prepare a copy of an earlier event — you don't have permission");
    expect(t).not.toContain("Show before and after");
  });

  it("shows each part's own problem on its card, and the rest still shows", () => {
    const t = render({
      drafts: { ok: false, error: "Could not draft an event reminder — you don't have permission (needs comms.send)." },
      audience: { ok: false, error: "Could not count who a reminder would reach — the database did not answer." },
    });
    expect(t).toContain("Could not draft an event reminder — you don't have permission (needs comms.send).");
    expect(t).toContain("Could not count who a reminder would reach — the database did not answer.");
    expect(t).toContain("Attending");
  });

  it("offers Niva's sentence box and the before-and-after form when the person may prepare a change", () => {
    const t = render({});
    expect(t).toContain("Say what to change");
    expect(t).toContain("Show before and after");
    expect(t).toContain("Prepare the copy");
  });
});
