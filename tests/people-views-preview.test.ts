import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The dev preview of the saved views (/dev/people-views): invented data for a neutral community, no database. It exists only outside
// production, and what it draws follows the same rules as the real screens: a list of contact gaps is adults only, a family is shown with
// its card line, the export holds no child's name, and a write that fails is told in words.
vi.mock("next/navigation", async (orig) => ({
  ...((await orig()) as object),
  usePathname: () => "/dev/people-views",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/(app)/people/saved-actions", () => ({ saveViewAction: vi.fn(), renameViewAction: vi.fn(), deleteViewAction: vi.fn(), setPinAction: vi.fn() }));
vi.mock("@/app/(app)/people/add-family-actions", () => ({ addFamilyAction: vi.fn(), findFamilyMatchesAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/(app)/households/actions", () => ({ dismissDuplicateAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/tenancy-actions", () => ({ switchCenterAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));
vi.mock("@/app/look-actions", () => ({ setLookAction: vi.fn() }));

import PeopleViewsPreview from "@/app/dev/people-views/page";
import { GET as previewExport } from "@/app/dev/people-views/export/route";
import { exportLines, GAP_FILTERS, gapRows } from "@/app/dev/people-views/fixtures";
import { NO_FILTERS, type HouseholdFilters } from "@/lib/people-v2/ask";

afterEach(() => vi.unstubAllEnvs());

const call = (sp: Record<string, string> = {}) => PeopleViewsPreview({ searchParams: Promise.resolve(sp) });
const draw = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await call(sp));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the dev route", () => {
  it("returns notFound() in production, for the page and for the export", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    const res = await previewExport({ nextUrl: new URL("https://x.example/dev/people-views/export") } as never);
    expect(res.status).toBe(404);
  });

  it("draws the People home with pinned families above the recent ones and the saved views, inside the new shell", async () => {
    const html = await draw();
    const words = text(html);
    expect(html).toContain('data-look="v2"');
    expect(words).toContain("Lakeside Residents' Club");
    expect(words.indexOf("Pinned families")).toBeLessThan(words.indexOf("Recent families"));
    expect(words).toContain("No. 0301 · LRC-H-1102 · Samira Hassan & Karim Hassan");
    expect(words).toContain("1 pinned family is not shown");
    for (const name of ["Adults with no email address", "Seniors with no mobile", "名簿の更新 (30 days)", "Не в приложении"]) expect(words).toContain(name);
    expect(words).not.toContain("Coming next");
  });

  it("draws the empty and the error states in words", async () => {
    const empty = text(await draw({ state: "empty" }));
    expect(empty).toContain("Pin a family with the star");
    expect(empty).toContain("Your own saved views show up here.");
    const error = text(await draw({ state: "error" }));
    expect(error).toContain("Could not load your pinned families — the database could not be reached");
    expect(error).toContain("Could not load your saved views — the database could not be reached");
    expect(error).not.toContain("Your own saved views show up here.");
  });

  it("draws a list of adults with no email, with Save this view and Export, and no 'Coming next'", async () => {
    const html = await draw({ state: "gaplist" });
    const words = text(html);
    expect(html).toMatch(/<h1[^>]*>Adults with no email<\/h1>/);
    expect(words).toContain("8 adults");
    expect(words).toContain("Save this view");
    expect(html).toMatch(/<button type="button" class="[^"]*">Export</);
    expect(words).toContain("Adults only");
    expect(words).toContain("No email on file");
    expect(words).toContain("Not in a family");
    expect(words).toContain("No. 0127 · LRC-H-0961 · Priya Patel & Anil Patel");
    expect(words).not.toContain("Coming next");
    expect(text(await draw({ state: "gaplist-empty" }))).toContain("No adult matches");
  });

  it("draws the Family page with the pin star, and the no-access state", async () => {
    expect(await draw({ state: "family" })).toMatch(/aria-pressed="false"[^>]*aria-label="Pin Hassan household"/);
    expect(await draw({ state: "family", pinned: "1" })).toMatch(/aria-pressed="true"[^>]*aria-label="Unpin Hassan household"/);
    expect(text(await draw({ state: "family", pinerror: "1" }))).toContain("Could not check whether this family is pinned");
    expect(text(await draw({ state: "noaccess" }))).toContain("You don't have access to this area");
  });
});

describe("a child is never on a gap list or in an export", () => {
  it("leaves out the children of the invented families from every list and every line of the export", () => {
    const lists: HouseholdFilters[] = [GAP_FILTERS, { ...NO_FILTERS, noMobile: true }, { ...NO_FILTERS, noEmail: true, band: "minors" }];
    for (const filters of lists) {
      const rows = gapRows(filters).rows.map((r) => r.name);
      expect(rows).not.toContain("Layla Hassan");
      expect(rows).not.toContain("Omar Hassan");
    }
    const csv = exportLines(GAP_FILTERS).flat().join("|");
    expect(csv).not.toContain("Layla");
    expect(csv).not.toContain("Omar");
    expect(csv).toContain("田中");
  });

  it("serves the preview's export as a CSV with a byte order mark", async () => {
    const res = await previewExport({ nextUrl: new URL("https://x.example/dev/people-views/export?noemail=1&band=adults") } as never);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain("Name,Relationship,Member number");
  });
});
