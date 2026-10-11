import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /people picks its page by the person's look: the new People workspace for "v2", the classic page (unchanged) otherwise.
let look: string | undefined;
const asked: string[] = [];
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      asked.push(name);
      return look ? { name, value: look } : undefined;
    },
  }),
}));
vi.mock("server-only", () => ({}));
const session = { permissions: [], isPlatformAdmin: false, isOwner: false, grants: [], center: { id: "c1", rules: {}, time_zone: "UTC", currency: "USD" } };
vi.mock("@/lib/session", () => ({ getSession: async () => session }));
const peopleV2 = vi.fn((props: unknown) => {
  void props;
  return "NEW PEOPLE WORKSPACE";
});
vi.mock("@/app/(app)/people/people-v2", () => ({ PeopleV2: (props: unknown) => peopleV2(props) }));
vi.mock("@/app/(app)/people/actions", () => ({ makePrimaryAction: vi.fn() }));
vi.mock("@/lib/data/people-list", () => ({ listPeople: vi.fn(), peopleTotals: vi.fn() }));
vi.mock("@/lib/data/custom-fields", () => ({ loadCustomColumn: vi.fn(), loadCustomFieldDefs: vi.fn() }));

import PeopleListPage from "@/app/(app)/people/page";
import { LOOK_COOKIE } from "@/lib/look";

const render = async () => renderToStaticMarkup(await PeopleListPage({ searchParams: Promise.resolve({ q: "Okafor" }) }));

beforeEach(() => {
  peopleV2.mockClear();
  look = undefined;
});

describe("the People page and the look", () => {
  it("renders the new workspace for the new look, with the session and the search", async () => {
    look = "v2";
    const html = await render();
    expect(html).toBe("NEW PEOPLE WORKSPACE");
    expect(peopleV2).toHaveBeenCalledWith({ session, sp: { q: "Okafor" } });
    expect(asked).toContain(LOOK_COOKIE);
  });

  it("renders the classic page otherwise, and never the new one", async () => {
    for (const value of [undefined, "classic", "something-else"]) {
      look = value;
      const html = await render();
      expect(peopleV2).not.toHaveBeenCalled();
      // A person without the households access sees the classic refusal, exactly as before.
      expect(html).toContain("You don&#x27;t have access to this area");
      expect(html).not.toContain("NEW PEOPLE WORKSPACE");
    }
  });
});
