import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// /people/[id] in the New look: a person lives on the Family page, so it goes there with the slide-over open; in two families it asks
// which (with each family's card, never a name alone); in none it draws the slide-over's content on the page itself.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/people/x",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { PersonPageV2 } from "@/app/(app)/people/[id]/person-v2";

import { ID, peopleDb, staffSession } from "./commands/people-fixture";

const NEW_PERSON = "b0000000-0000-4000-8000-0000000000bb";

function session(extra: (t: ReturnType<typeof peopleDb>["tables"]) => void = () => {}) {
  const { db, tables } = peopleDb();
  extra(tables);
  return staffSession(db);
}

describe("a person in one family", () => {
  it("goes to that family's page with their slide-over open, keeping the rest of the address", async () => {
    await expect(PersonPageV2({ session: session(), id: ID.priya, sp: { year: "2025", hh: "x", mode: "edit" } })).rejects.toThrow(
      `REDIRECT /households/${ID.hhShah}?year=2025&person=${ID.priya}`,
    );
  });

  it("ignores a family they have left", async () => {
    const s = session((t) => {
      t.household_members.push({ household_id: ID.hhPatel, person_id: ID.priya, center_id: "center-1", role: "other", is_primary: false, left_at: "2026-01-01" });
    });
    await expect(PersonPageV2({ session: s, id: ID.priya, sp: {} })).rejects.toThrow(`REDIRECT /households/${ID.hhShah}?person=${ID.priya}`);
  });
});

describe("a person in two families", () => {
  const s = () =>
    session((t) => {
      t.household_members.push({ household_id: ID.hhPatel, person_id: ID.rahul, center_id: "center-1", role: "sibling", is_primary: false, left_at: null });
    });

  it("asks which family, showing each family's card and the person's part in it", async () => {
    const el = (await PersonPageV2({ session: s(), id: ID.rahul, sp: { year: "2025" } })) as ReactElement<Record<string, unknown>>;
    const inner = await (el.type as (p: unknown) => Promise<ReactElement>)(el.props);
    const html = renderToStaticMarkup(inner);
    expect(html).toContain("Rahul Shah is in more than one family");
    expect(html).toContain("H-1001");
    expect(html).toContain("H-1002");
    expect(html).toContain("Patel family");
    expect(html).toContain("Spouse");
    expect(html).toContain("Sibling");
    expect(html).toContain(`/households/${ID.hhShah}?year=2025&amp;person=${ID.rahul}`);
    expect(html).toContain(`/households/${ID.hhPatel}?year=2025&amp;person=${ID.rahul}`);
    // each family is told apart by its card, not its name alone
    expect(html).toContain("Austin");
  });

  it("says not found for a person who does not exist", async () => {
    const none = session((t) => {
      t.household_members.push({ household_id: ID.hhPatel, person_id: "b0000000-0000-4000-8000-0000000000cc", center_id: "center-1", role: "other", is_primary: false, left_at: null });
      t.household_members.push({ household_id: ID.hhShah, person_id: "b0000000-0000-4000-8000-0000000000cc", center_id: "center-1", role: "other", is_primary: false, left_at: null });
    });
    const el = (await PersonPageV2({ session: none, id: "b0000000-0000-4000-8000-0000000000cc", sp: {} })) as ReactElement<Record<string, unknown>>;
    await expect((el.type as (p: unknown) => Promise<ReactElement>)(el.props)).rejects.toThrow("NOT_FOUND");
  });
});

describe("a person in no family", () => {
  it("shows the slide-over's content on the page, with a way back to People", async () => {
    const s = session((t) => {
      t.people.push({
        id: NEW_PERSON,
        center_id: "center-1",
        first_name: "Inés",
        last_name: "Valdés",
        preferred_name: null,
        date_of_birth: "1990-03-03",
        member_number: "M-9",
        email: null,
        phone_e164: null,
        gender: "female",
        profession: null,
        employer: null,
        language: "en",
        merged_into_id: null,
        is_deceased: false,
        deceased_on: null,
        interests: [],
      });
    });
    const el = (await PersonPageV2({ session: s, id: NEW_PERSON, sp: {} })) as ReactElement<Record<string, unknown>>;
    expect(el.props).toMatchObject({ mode: "page", closeHref: "/people", closeLabel: "People" });
    const detail = el.props.detail as { person: { name: string; isChild: boolean }; household: unknown };
    expect(detail.person.name).toBe("Inés Valdés");
    expect(detail.household).toBeNull();
  });

  it("says not found for someone who is not there", async () => {
    await expect(PersonPageV2({ session: session(), id: "b0000000-0000-4000-8000-0000000000dd", sp: {} })).rejects.toThrow("NOT_FOUND");
  });
});
