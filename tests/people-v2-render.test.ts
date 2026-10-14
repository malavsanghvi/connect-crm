import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The People workspace in the new look, rendered on the server with the dev preview's invented data (a neutral neighbourhood
// association): what the board draws is there, what is not built says "Coming next", children are shown to the person but never
// put in anything sent to Niva (D2), and the dev route exists only outside production. Server actions are replaced.
vi.mock("next/navigation", async (orig) => ({
  ...((await orig()) as object),
  usePathname: () => "/dev/admin-people",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/households/actions", () => ({ dismissDuplicateAction: vi.fn() }));
vi.mock("@/app/(app)/people/saved-actions", () => ({ saveViewAction: vi.fn(), renameViewAction: vi.fn(), deleteViewAction: vi.fn(), setPinAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/(app)/people/add-family-actions", () => ({ addFamilyAction: vi.fn(), findFamilyMatchesAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/tenancy-actions", () => ({ switchCenterAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("@/app/look-actions", () => ({ setLookAction: vi.fn() }));

import AdminPeoplePreview from "@/app/dev/admin-people/page";
import { sampleModel, SAMPLE_IDS } from "@/app/dev/admin-people/fixtures";
import { PreviewNiva } from "@/app/dev/admin-people/preview-niva";
import { PeopleWorkspace } from "@/components/people-v2/people-workspace";
import type { PeopleWorkspaceModel } from "@/lib/people-v2/model";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const draw = (model: PeopleWorkspaceModel, niva = true, mergeTicked = false) => renderToStaticMarkup(h(PreviewNiva, { enabled: niva, mergeTicked }, h(PeopleWorkspace, { model })));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

afterEach(() => vi.unstubAllEnvs());

describe("the households view", () => {
  const html = draw(sampleModel({ view: "households", hh: null, niva: true }));
  const words = text(html);

  it("draws the list: a way back to the People home, the Lists menu, chips, the sentence read into chips, the summary and the list", () => {
    expect(words).toContain("People");
    expect(html).toMatch(/<h1[^>]*>Families<\/h1>/);
    expect(html).toMatch(/href="\/people">‹ People</);
    expect(words).toContain("Lists");
    expect(words).toContain("All people");
    // The pill and the tab row are gone, and so is the list's own input: the find box takes the words.
    expect(html).not.toContain("aria-label=\"Show\"");
    expect(html).not.toContain("name=\"ask\"");
    expect(words).toContain("Possible duplicates · 4");
    expect(words).toContain("Niva read this as");
    expect(words).toContain("Area is North Riverside");
    expect(words).toContain("Open balance over $100.00");
    expect(words).toContain("No RSVP in 2026");
    expect(words).toContain("9 households");
    expect(words).toContain("open in total");
    expect(words).toContain("Showing 7 of 9");
    // Households are never a name alone: the numbers are on every row.
    expect(words).toContain("Household 0212 · RNA-H-2041");
  });

  it("saves a list as a view and exports it for real, and still shows what is not built as switched off with Coming next", () => {
    // Save this view and Export are working controls now (slice 8); the export asks for a fresh 2FA code and says what it holds.
    expect(words).toContain("Save this view");
    expect(html).toMatch(/<button type="button" class="[^"]*">Export</);
    expect(words).toContain("without any child's name");
    expect(words).toContain("fresh 2FA code");
    expect(words).not.toContain("+ Save this view");
    expect(words).toContain("Coming next");
    expect(html).toMatch(/<button type="button" disabled[^>]*>Message the household</);
  });

  it("opens the first household's card beside the list, with children shown to the person", () => {
    expect(html).toContain('aria-label="Household card"');
    expect(words).toContain("Chidi Okafor (member 0417)");
    expect(words).toContain("Ada (child)");
    expect(words).toContain("Children (shown to you only)");
    expect(words).toContain("Niva noticed");
    expect(words).toContain("Niva only suggests.");
  });

  it("asks Niva about the household with its numbers and adults only (D2)", () => {
    const model = sampleModel({ view: "households", hh: null, niva: true });
    const card = model.panel.state === "ok" ? model.panel.card : null;
    expect(card?.nivaPrompt).toContain("household 0212");
    expect(card?.nivaPrompt).toContain("Chidi Okafor");
    for (const child of card?.children ?? []) expect(card?.nivaPrompt).not.toContain(child.name.split(" ")[0]);
    expect(card?.nivaPrompt).not.toContain(card?.name ?? "");
    expect(model.draftPrompt).not.toMatch(/Ada|Emeka/);
    expect(html).toContain(`aria-label="Ask Niva about this household: ${card?.nivaPrompt}"`);
  });
});

describe("with Niva switched off", () => {
  const html = draw(sampleModel({ view: "households", hh: null, niva: false }), false);
  const words = text(html);
  it("keeps the box (search by any ID and the filters) and says nothing about Niva", () => {
    expect(words).toContain("Read as");
    expect(words).not.toContain("Niva read this as");
    expect(words).toContain("Possible duplicate");
    expect(words).not.toContain("Niva noticed");
    expect(words).not.toContain("Ask Niva");
    expect(words).toContain("Needs Niva");
  });
});

describe("the other views", () => {
  it("opens a household card as a sheet with a way back on a phone", () => {
    const html = draw(sampleModel({ view: "households", hh: SAMPLE_IDS.first, niva: true }));
    expect(html).toContain("Back to the list");
    expect(html).toMatch(/aria-label="Household card" class="fixed inset-0/);
  });

  it("lists duplicates with a compare link, a not-the-same button, and the merge card only when ticked", () => {
    const off = text(draw(sampleModel({ view: "duplicates", hh: null, niva: true })));
    expect(off).toContain("Compare side by side");
    expect(off).toContain("Not the same");
    expect(off).toContain("Merging from a confirmation card is not switched on");
    expect(off).not.toContain("Merge, keeping");
    const on = text(draw(sampleModel({ view: "duplicates", hh: null, niva: true }), true, true));
    expect(on).toContain("Merge, keeping Chidi & Ngozi Okafor Household");
    expect(on).toContain("Merge, keeping Okafor family");
    expect(on).toContain("Merge, keeping María García");
    expect(on).not.toContain("Merge, keeping Maria Garcia");
    expect(on).toContain("1 more pair involves a child");
  });

  it("lists applications and family requests with their household cards", () => {
    const words = text(draw(sampleModel({ view: "reviews", hh: null, niva: true })));
    expect(words).toContain("Waiting for a decision");
    expect(words).toContain("Tunde Adeyemi");
    expect(words).toContain("Add Grace Okafor, asked for as their parent");
    expect(words).toContain("1 more request is decided on the family requests screen");
  });

  it("lists people with their member numbers and households", () => {
    const words = text(draw(sampleModel({ view: "people", hh: null, niva: true })));
    expect(words).toContain("Member 0417");
    expect(words).toContain("Chidi & Ngozi Okafor Household · 0212");
  });
});

describe("the dev preview route", () => {
  const call = (sp: Record<string, string> = {}) => AdminPeoplePreview({ searchParams: Promise.resolve(sp) });

  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws the page inside the new shell with sample data, without a database", async () => {
    const html = renderToStaticMarkup(await call());
    expect(html).toContain('data-look="v2"');
    expect(html).toContain("v2-rail");
    expect(html).toContain("Riverside Neighbours Association");
    expect(html).toContain("Household card");
    expect(renderToStaticMarkup(await call({ niva: "off" }))).not.toContain("Niva read this as");
  });
});
