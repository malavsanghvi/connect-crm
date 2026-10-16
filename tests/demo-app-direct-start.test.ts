import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// "Demo > Community member opens the member app straight at the family" (owner decision 2026-10-15, docs/MEMBER_APP_DEMO.md "The one-step
// path"): on /demo the people of the community area get a plain link to <member app>/demo?persona=<id> instead of a Start form, and
// nothing is started or signed out in the portal for them. Everyone else keeps the Start form. The page is rendered with the database,
// Supabase Auth and the Server Actions replaced; what is checked is the markup and that none of the portal's start/sign-out paths is touched.
const server = vi.hoisted(() => ({
  loadDemoChoices: vi.fn(),
  loadDemoBanner: vi.fn(),
  startDemoFromRequest: vi.fn(),
  startDemoForApp: vi.fn(),
  leaveDemoFromRequest: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  claims: null as null | { email?: string },
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
}));
const actions = vi.hoisted(() => ({ startDemoAction: vi.fn(), leaveDemoAction: vi.fn() }));
vi.mock("@/app/demo/actions", () => actions);
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/demo-signin/server", () => server);
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: auth.claims }, error: null }), signOut: auth.signOut, signInWithPassword: auth.signInWithPassword, setSession: auth.setSession },
  }),
}));

import DemoPage from "@/app/demo/page";
import { MEMBER_APP_AREA, parseChoices, worksInMemberApp } from "@/lib/demo-signin/rules";
import { holdsNoStaffWork } from "@/lib/home/member-work";
import { sessionPermissions, type RoleLike } from "@/lib/permissions";

const ID = (n: number) => `5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a${String(n).padStart(2, "0")}`;
const ADMIN = ID(1);
const TREASURER = ID(2);
const TARUN = ID(3);
const ZARA = ID(4);
const ELI = ID(5);

const choices = parseChoices({
  enabled: true,
  communities: [
    {
      kind: "faith",
      name: "Sunrise Worship Center (Demo)",
      id: "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c01",
      slug: "sunrise-demo",
      people: [
        { id: ADMIN, role: "Administrator", name: "Asha Test", story: "Runs the office and sees everything.", area: "operations" },
        { id: TREASURER, role: "Treasurer", name: "Tara Test", story: "Records payments and closes the month.", area: "operations" },
        { id: TARUN, role: "Community member · Adult", name: "Tarun Test", story: "Is the main adult of a family.", area: "community" },
        { id: ZARA, role: "Child", name: "Zara Test", story: "Sees events and notices, never money.", area: "community" },
      ],
    },
    {
      kind: "neutral",
      name: "Lakeside Neighbors Club (Demo)",
      id: "9a1b2c3d-0e1f-4a2b-8c3d-4e5f6a7b8c02",
      slug: "lakeside-demo",
      people: [{ id: ELI, role: "Event lead", name: "Eli Test", story: "Plans the summer picnic.", area: "operations" }],
    },
  ],
});

async function page(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await DemoPage({ searchParams: Promise.resolve(searchParams) }));
}

/** The <li> of each person, in page order. */
function cards(html: string): string[] {
  return html.split('<li class="flex flex-col').slice(1).map((s) => `<li class="flex flex-col${s.split("</li>")[0]}`);
}
const cardOf = (html: string, name: string) => {
  const found = cards(html).find((c) => c.includes(name));
  if (!found) throw new Error(`no card for ${name}`);
  return found;
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  delete process.env.NEXT_PUBLIC_MEMBER_APP_URL;
  delete process.env.PUBLIC_SITE_DOMAIN;
  auth.claims = null;
  for (const f of [server.loadDemoChoices, server.loadDemoBanner, server.startDemoFromRequest, server.startDemoForApp, server.leaveDemoFromRequest, auth.signOut, auth.signInWithPassword, auth.setSession, actions.startDemoAction, actions.leaveDemoAction]) {
    f.mockReset();
  }
  server.loadDemoChoices.mockResolvedValue({ ok: true, choices });
  server.loadDemoBanner.mockResolvedValue(null);
});

describe("/demo: the community members open the member app, every admin role keeps Start", () => {
  it("gives each person of the community area a link to the member app's demo for exactly that person, and a Start form to every other", async () => {
    const html = await page();
    const links = [...html.matchAll(/<a href="([^"]+)"[^>]*data-testid="demo-open-member-app"/g)].map((m) => m[1]);
    expect(links).toEqual([`https://app.weaverams.org/demo?persona=${TARUN}`, `https://app.weaverams.org/demo?persona=${ZARA}`]);

    // The forms (POST, a Server Action) carry exactly the others.
    const forms = [...html.matchAll(/<input type="hidden" name="persona" value="([^"]+)"/g)].map((m) => m[1]);
    expect(forms).toEqual([ADMIN, TREASURER]);
    expect(html.match(/<form /g)).toHaveLength(2);
    expect(html.match(/>Start</g)).toHaveLength(2);
    expect(html.match(/>Open the member app</g)).toHaveLength(2);
  });

  it("a community role's card has no form and no Start button, and its link opens in the same tab", async () => {
    const html = await page();
    for (const name of ["Tarun Test", "Zara Test"]) {
      const card = cardOf(html, name);
      expect(card).not.toContain("<form");
      expect(card).not.toContain("<button");
      expect(card).not.toContain('name="persona"');
      expect(card).not.toContain(">Start<");
      expect(card).not.toContain("target=");
      expect(card).toContain('data-opens="member-app"');
    }
    // An operational role's card is the Start form it always was.
    for (const name of ["Asha Test", "Tara Test"]) {
      const card = cardOf(html, name);
      expect(card).toContain("<form");
      expect(card).toContain(">Start<");
      expect(card).not.toContain("demo-open-member-app");
      expect(card).not.toContain("data-opens");
    }
  });

  it("names the quick path on the community cards: the role, who it opens as, and that it is the quickest way in", async () => {
    const html = await page();
    const tarun = cardOf(html, "Tarun Test");
    expect(tarun).toContain("Community member · Adult");
    expect(tarun).toContain("Quickest way in: opens the member app");
    expect(tarun).toContain('aria-label="Open the member app as Tarun Test, Community member · Adult"');
    expect(tarun).toContain("already signed in");
    expect(html).toContain('aria-label="Start the demo as Asha Test, Administrator"');
    // A visitor who scrolls the list finds it from the top of the section.
    expect(html).toContain('href="#demo-area-community"');
    expect(html).toContain('id="demo-area-community"');
  });

  it("starts nothing in the portal and signs nobody out for a community role: rendering the page touches no start, sign-in or sign-out", async () => {
    auth.claims = { email: "ada@example.org" };
    await page();
    expect(server.startDemoFromRequest).not.toHaveBeenCalled();
    expect(server.startDemoForApp).not.toHaveBeenCalled();
    expect(actions.startDemoAction).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it("the member app card is a plain link: its source has no Server Action, no form, no hook and no new tab", () => {
    const src = readFileSync(join(process.cwd(), "src/app/demo/persona-card.tsx"), "utf8").replace(/\r\n/g, "\n");
    const card = src.slice(src.indexOf("export function MemberAppPersonaCard"));
    expect(card).toContain("<a href={href}");
    for (const forbidden of ["startDemoAction", "useActionState", "<form", "<button", 'target="_blank"', "signOut"]) expect(card).not.toContain(forbidden);
    // The portal's start paths take a person's id too; the page must call them only from the Start form.
    const pageSrc = readFileSync(join(process.cwd(), "src/app/demo/page.tsx"), "utf8");
    expect(pageSrc).not.toContain("startDemoFromRequest");
    expect(pageSrc).not.toContain("signOut");
  });

  it("follows the member app's configured address", async () => {
    process.env.NEXT_PUBLIC_MEMBER_APP_URL = "https://members.example.org/";
    const html = await page();
    expect(html).toContain(`href="https://members.example.org/demo?persona=${TARUN}"`);
    expect(html).not.toContain("app.weaverams.org");
  });

  it("only warns about being signed out for the roles that do sign the visitor out of the portal", async () => {
    auth.claims = { email: "ada@example.org" };
    const html = await page();
    expect(html).toContain("You are signed in as ada@example.org");
    expect(html).toContain("Starting the demo as a community admin signs you out in this browser first.");
    expect(html).toContain("The community members open the member app instead and leave your sign-in here alone.");
  });

  it("keeps the plain sentence, and no jump link, for a community with nobody in the community area", async () => {
    auth.claims = { email: "ada@example.org" };
    const html = await page({ kind: "neutral" });
    expect(html).toContain("Starting the demo signs you out in this browser first.");
    expect(html).not.toContain("leave your sign-in here alone");
    expect(html).not.toContain("demo-open-member-app");
    expect(html).not.toContain('href="#demo-area-community"');
    expect(html.match(/<form /g)).toHaveLength(1);
    expect(html).toContain(`name="persona" value="${ELI}"`);
  });

  it("keeps the layout: both areas under their headings, the community area after the operational one", async () => {
    const html = await page();
    expect(html.indexOf('data-testid="demo-area-operations"')).toBeLessThan(html.indexOf('data-testid="demo-area-community"'));
    expect(html).toContain("Community Admin Roles");
    expect(html).toContain("Community Members");
    expect(html.match(/data-testid="demo-person"/g)).toHaveLength(4);
  });
});

describe("which people open the member app", () => {
  it("is exactly the people of the community area", () => {
    expect(MEMBER_APP_AREA).toBe("community");
    const people = choices.communities.flatMap((c) => c.people);
    expect(people.filter(worksInMemberApp).map((p) => p.role)).toEqual(["Community member · Adult", "Child"]);
    expect(people.filter((p) => !worksInMemberApp(p)).map((p) => p.area)).toEqual(["operations", "operations", "operations"]);
  });
});

// The community area is not a second list of roles: it is what the database's featured list says is the community's own, and those roles
// are the family roles of the role catalog, the ones that hold no permission, so the portal gives them only Home and the card "Your work is
// in the member app" (holdsNoStaffWork, src/lib/home/member-work.ts). This reads both from the repository so a change to either shows here.
describe("the community area is the family roles, the ones whose work lives in the member app", () => {
  type SeedRole = RoleLike & { key: string; tier: string };
  const root = join(__dirname, "..");

  function seedRoles(): SeedRole[] {
    const text = readFileSync(join(root, "supabase/seed.sql"), "utf8");
    const re = /^\('([a-z_]+)',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'(\[[^\]]*\])'\)[,;]?\s*$/gm;
    return [...text.matchAll(re)].map((m) => ({ key: m[1], tier: m[2], permissions: JSON.parse(m[4]) as string[] }));
  }

  /** app.demo_featured_roles() as the newest migration that defines it says. */
  function featuredRoles(): { file: string; rows: { role: string; area: string; label: string | null }[] } {
    const dir = join(root, "supabase/migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort().reverse()) {
      const text = readFileSync(join(dir, f), "utf8");
      const at = text.indexOf("create or replace function app.demo_featured_roles()");
      if (at < 0) continue;
      const body = text.slice(at, text.indexOf("$$;", text.indexOf("$$", at) + 2));
      const rows = [...body.matchAll(/\('([a-z_]+)',\s*'(operations|community)',\s*(\d+),\s*(?:null(?:::text)?|'((?:[^']|'')*)')\)/g)].map((m) => ({ role: m[1], area: m[2], label: m[4] ?? null }));
      return { file: f, rows };
    }
    throw new Error("no migration defines app.demo_featured_roles()");
  }

  const roles = seedRoles();
  const { rows } = featuredRoles();
  const holdsOnlyHome = (key: string) => {
    const grants = [{ role_key: key, scope_kind: "center", scope_id: null, starts_at: "2020-01-01T00:00:00Z", ends_at: null }];
    const permissions = sessionPermissions(grants, roles, false);
    return holdsNoStaffWork({ permissions, isPlatformAdmin: false, isOwner: false, modulesOff: [], grants: grants.map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: g.scope_id })) });
  };

  it("reads the role catalog and the featured list", () => {
    expect(roles.length).toBeGreaterThanOrEqual(30);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("every featured role of the community area is a family role that holds nothing the portal opens, so Home carries the member app card", () => {
    const community = rows.filter((r) => r.area === MEMBER_APP_AREA);
    expect(community.length).toBeGreaterThan(0);
    for (const r of community) {
      const role = roles.find((x) => x.key === r.role);
      expect(role?.tier, r.role).toBe("family");
      expect(holdsOnlyHome(r.role), r.role).toBe(true);
    }
  });

  it("no featured role of the operational area is a family role (their work is in the portal, so they keep Start)", () => {
    for (const r of rows.filter((x) => x.area === "operations")) expect(roles.find((x) => x.key === r.role)?.tier, r.role).not.toBe("family");
  });

  it("the family roles are the five the owner named, and the family's main adult is the featured one, shown as Community member · Adult", () => {
    expect(roles.filter((r) => r.tier === "family").map((r) => r.key).sort()).toEqual(["adult_member", "child", "community_member", "membership_reference", "primary_adult"]);
    expect(rows.filter((r) => r.area === MEMBER_APP_AREA)).toEqual([{ role: "primary_adult", area: "community", label: "Community member · Adult" }]);
  });
});
