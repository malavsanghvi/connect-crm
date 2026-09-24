import { describe, expect, it } from "vitest";

import { normalizeStepUpCode, splitConfirmMessage } from "@/lib/confirm";
import {
  mapGlobalSearch,
  normalizeSearchQuery,
  personResult,
  type HouseholdSearchRow,
  type PersonSearchRow,
} from "@/lib/global-search";
import { initials, navFooter, roleSummary, tenantBranding } from "@/lib/shell";

describe("shell helpers", () => {
  it("makes initials", () => {
    expect(initials("Priya Shah")).toBe("PS");
    expect(initials("priya")).toBe("P");
    expect(initials("Anil Kumar Mehta", 1)).toBe("A");
    expect(initials("  ")).toBe("?");
    expect(initials("anil.mehta@example.org")).toBe("AO");
  });

  it("uses the tenant's branding, never a hard-coded logo", () => {
    const base = { name: "Jain Society of Houston", short_name: "JSH", slug: "jsh" };
    expect(tenantBranding({ ...base, branding: { logo_url: "https://cdn.example.org/logo.png" } }).logoUrl).toBe(
      "https://cdn.example.org/logo.png",
    );
    expect(
      tenantBranding({ ...base, branding: { logo_url: "https://x.org/full.png", mark_url: "https://x.org/mark.png" } }).logoUrl,
    ).toBe("https://x.org/mark.png");
    // Only https URLs are used.
    expect(tenantBranding({ ...base, branding: { logo_url: "http://x.org/logo.png" } }).logoUrl).toBeNull();
    expect(tenantBranding({ ...base, branding: null }).logoUrl).toBeNull();
    expect(tenantBranding({ ...base, branding: [] }).monogram).toBe("JSH");
    expect(tenantBranding({ name: "Jain Center of Northern California", short_name: null, slug: "jcnc", branding: {} })).toEqual({
      logoUrl: null,
      monogram: "JCNC",
      shortName: "JCNC",
    });
    expect(tenantBranding({ name: "Jain Center of America", short_name: "Jain Center NY", slug: "jca", branding: {} }).monogram).toBe(
      "JA",
    );
  });

  it("summarises roles for the top bar and the sidebar footer", () => {
    const roles = [
      { name: "Event lead", scopeKind: "event" },
      { name: "Treasurer", scopeKind: "center" },
    ];
    expect(roleSummary({ roles, isPlatformAdmin: false })).toBe("Treasurer +1 more");
    expect(roleSummary({ roles: [roles[0]], isPlatformAdmin: false })).toBe("Event lead (event)");
    expect(roleSummary({ roles: [], isPlatformAdmin: false })).toBe("No staff role");
    expect(roleSummary({ roles: [], isPlatformAdmin: true })).toBe("Platform admin");
    expect(navFooter({ roles: [roles[1]], isPlatformAdmin: false, permissions: ["giving.view", "giving.manage"] })).toBe(
      "Treasurer · 2 permissions. Menus, data and buttons follow your role, and the server enforces the same rules.",
    );
    expect(navFooter({ roles: [roles[1]], isPlatformAdmin: false, permissions: ["giving.view"] })).toContain("1 permission.");
  });
});

describe("global search mapping", () => {
  const hh = (n: number): HouseholdSearchRow => ({
    household_id: `h${n}`,
    household_name: `Shah ${n}`,
    household_number: `JSH-H-${n}`,
    org_household_id: n % 2 ? `0${n}` : null,
    members: "Priya, Rahul",
    city: "Sugar Land",
  });
  const person = (n: number): PersonSearchRow => ({
    id: `p${n}`,
    first_name: "Priyanka",
    last_name: `Shah${n}`,
    preferred_name: n === 1 ? "Priya" : null,
    member_number: n === 2 ? null : `JSH-${n}`,
  });

  it("normalises the query and ignores very short ones", () => {
    expect(normalizeSearchQuery("  s ")).toBeNull();
    expect(normalizeSearchQuery("  Priya   Shah ")).toBe("Priya Shah");
    expect(normalizeSearchQuery("x".repeat(200))).toHaveLength(80);
  });

  it("describes households by number, org ID, members and city — never the name alone", () => {
    const [r] = mapGlobalSearch([hh(1)], [], [], "JSH household ID");
    expect(r).toEqual({
      kind: "household",
      id: "h1",
      title: "Shah 1",
      detail: "Household no. JSH-H-1 · JSH household ID 01 · Members: Priya, Rahul · Sugar Land",
      href: "/households/h1",
    });
  });

  it("describes people by member number and household, using the preferred name", () => {
    expect(personResult(person(1), "Shah, Priya & Rahul")).toEqual({
      kind: "person",
      id: "p1",
      title: "Priya Shah1",
      detail: "Member no. JSH-1 · Household: Shah, Priya & Rahul",
      href: "/people/p1",
    });
    expect(personResult(person(2), null).detail).toBe("No member number · Not in a household");
  });

  it("mixes households and people up to the limit and drops duplicates", () => {
    const res = mapGlobalSearch([hh(1), hh(1), hh(2), hh(3), hh(4), hh(5), hh(6)], [person(1), person(2)], [], "ID", 8);
    expect(res).toHaveLength(8);
    expect(res.filter((r) => r.kind === "person")).toHaveLength(2);
    expect(new Set(res.map((r) => `${r.kind}${r.id}`)).size).toBe(8);
    expect(res[0].kind).toBe("household");

    const manyPeople = mapGlobalSearch([hh(1)], [1, 2, 3, 4, 5, 6, 7, 8, 9].map(person), [{ person_id: "p3", household_name: "Shah 3" }], "ID", 8);
    expect(manyPeople).toHaveLength(8);
    expect(manyPeople.filter((r) => r.kind === "household")).toHaveLength(1);
    expect(manyPeople.find((r) => r.id === "p3")?.detail).toContain("Household: Shah 3");
  });
});

describe("confirmation modal helpers", () => {
  it("turns a question into the modal title and the rest into the body", () => {
    expect(splitConfirmMessage("Write off the open balance of this pledge? This closes it.")).toEqual({
      title: "Write off the open balance of this pledge?",
      body: "This closes it.",
    });
    expect(splitConfirmMessage("Record the Executive Committee approval?")).toEqual({
      title: "Record the Executive Committee approval?",
      body: null,
    });
    expect(splitConfirmMessage("This cannot be undone.")).toEqual({ title: "Are you sure?", body: "This cannot be undone." });
  });

  it("accepts exactly six digits for a step-up code", () => {
    expect(normalizeStepUpCode("482 917")).toBe("482917");
    expect(normalizeStepUpCode("482-917")).toBe("482917");
    expect(normalizeStepUpCode("48291")).toBeNull();
    expect(normalizeStepUpCode("4829171")).toBeNull();
    expect(normalizeStepUpCode("48a917")).toBeNull();
  });
});
