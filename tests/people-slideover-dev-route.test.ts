import { afterEach, describe, expect, it, vi } from "vitest";

// The dev-only preview of the person slide-over (src/app/dev/people-slideover): invented data for a neutral community, fake writes,
// never in production. The page is a Server Component; here it is called as a function to see what it hands to the client part.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import PeopleSlideOverPreview from "@/app/dev/people-slideover/page";
import { detailFixture } from "@/app/dev/people-slideover/fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (sp: Record<string, string> = {}) => PeopleSlideOverPreview({ searchParams: Promise.resolve(sp) });

describe("the dev preview of the person slide-over", () => {
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws outside production, for every family and state the screenshots use", async () => {
    for (const sp of [
      {},
      { family: "tanaka" },
      { family: "empty", open: "all" },
      { person: "p-layla" },
      { access: "view" },
      { access: "limited", open: "all" },
      { mode: "page", person: "p-ines", family: "empty" },
      { view: "choose" },
      { do: "ids-add" },
    ]) {
      expect(await call(sp), JSON.stringify(sp)).toBeTruthy();
    }
  });

  it("has a person with children, names in other scripts and a fixture for each state without a database", () => {
    expect(detailFixture("hassan", "p-layla", { access: "full", standalone: false })?.person.isChild).toBe(true);
    expect(detailFixture("tanaka", "p-misaki", { access: "full", standalone: false })?.person.name).toBe("田中 美咲");
    expect(detailFixture("hassan", "p-nobody", { access: "full", standalone: false })).toBeNull();
    const view = detailFixture("hassan", "p-samira", { access: "view", standalone: false });
    expect(view?.canEdit).toBe(false);
    const limited = detailFixture("hassan", "p-samira", { access: "limited", standalone: false });
    expect(limited?.roles.roles).toEqual({ state: "no-access" });
  });
});
