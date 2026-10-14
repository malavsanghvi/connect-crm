import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sessionPermissions, visibleNav, type RoleLike } from "@/lib/permissions";
import { visibleTaskSources } from "@/lib/tasks";

// What each demo person of the faith demo community finds in the portal right after signing in (docs/DEMO_ROLE_WORK.md). The role catalog is
// read from supabase/seed.sql and the demo people from the newest migration that loads the faith pack, so this follows the data the demo
// really has. supabase/tests/184_demo_role_work_test.sql checks the other half: that the work is in the database for each of these people.

const ROOT = join(__dirname, "..");

type SeedRole = RoleLike & { defaultScope: string };

function seedRoles(): SeedRole[] {
  const text = readFileSync(join(ROOT, "supabase/seed.sql"), "utf8");
  const re = /^\('([a-z_]+)',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'([a-z]+)',\s*'(?:[^']|'')*',\s*'(\[[^\]]*\])'\)[,;]?\s*$/gm;
  return [...text.matchAll(re)].map((m) => ({ key: m[1], tier: m[2], defaultScope: m[3], permissions: JSON.parse(m[4]) as string[] }));
}

type Persona = { role: string; person: string; scope?: string };

/** The people of the faith pack as the newest migration that loads it defines them. */
function faithPersonas(): { file: string; personas: Persona[] } {
  const dir = join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().reverse();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!text.includes("'demo_faith_jain_v1'") || !text.includes("$demo$")) continue;
    const body = text.split("$demo$")[1];
    return { file: f, personas: (JSON.parse(body) as { personas: Persona[] }).personas };
  }
  throw new Error("no migration loads the faith demo pack");
}

/** The scope the portal's Roles screen would give the role (0796): the event, class or zone it is about, else the whole community. */
const scopeOf = (r: SeedRole) => (["event", "class", "zone"].includes(r.defaultScope) ? r.defaultScope : "center");

const PAST = "2020-01-01T00:00:00Z";

function portalOf(role: SeedRole, roles: SeedRole[]) {
  const scope = scopeOf(role);
  const grants = [{ role_key: role.key, scope_kind: scope, scope_id: scope === "center" ? null : "scope-1", starts_at: PAST, ends_at: null }];
  // The community's first administrator is its owner, and the owner holds every permission (0400).
  const isOwner = role.key === "center_admin";
  const permissions = sessionPermissions(grants, roles, isOwner);
  const ctx = {
    permissions,
    isPlatformAdmin: false,
    isOwner,
    modulesOff: [] as string[],
    grants: grants.map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: g.scope_id })),
  };
  return { permissions, tasks: visibleTaskSources(ctx).map((s) => s.key as string), nav: visibleNav(ctx).map((m) => m.key) };
}

/** Roles whose work is in the member app or the event-day app: the portal shows them Home and nothing else. */
const NO_PORTAL_SCREEN = [
  "event_lead",
  "checkin_volunteer",
  "kitchen_lead",
  "boli_recorder",
  "zone_lead",
  "community_member",
  "membership_reference",
  "primary_adult",
  "adult_member",
  "child",
];

/** Roles with a queue on Home "My tasks": the task sources that hold the demo's work for them. */
const HOME_TASKS: Record<string, string[]> = {
  executive_committee: ["membership"],
  treasurer: ["writeoff", "deposits"],
  finance_volunteer: ["deposits"],
  membership_coordinator: ["membership"],
  religious_coordinator: ["content", "bolis"],
  communications_officer: ["newsletter", "inbox", "whatsapp"],
  privacy_officer: ["privacy"],
  store_lead: ["inventory"],
  pathshala_principal: ["pathshala"],
  // The owner holds every permission, so every queue is hers.
  center_admin: ["writeoff", "deposits", "membership", "newsletter", "inbox", "whatsapp", "content", "inventory", "waivers", "bolis", "pathshala", "privacy"],
};

/** Roles with no queue on Home but a portal screen that holds their work, and the module that screen belongs to. */
const SCREEN_ONLY: Record<string, string> = {
  executive_viewer: "reports",
  content_editor: "content",
  volunteer_coordinator: "events",
  store_pickup: "store",
  pathshala_committee: "pathshala",
  teacher: "pathshala",
};

describe("the faith demo's people in the portal", () => {
  const roles = seedRoles();
  const { file, personas } = faithPersonas();
  const matrix = Object.fromEntries(
    personas.map((p) => {
      const role = roles.find((r) => r.key === p.role);
      if (!role) throw new Error(`the pack names a role the catalog does not have: ${p.role}`);
      return [p.role, portalOf(role, roles)];
    }),
  );

  it("reads the role catalog and the newest faith pack", () => {
    expect(roles.length).toBeGreaterThanOrEqual(30);
    expect(Number(file.slice(0, 4))).toBeGreaterThanOrEqual(797);
    expect(personas).toHaveLength(26);
  });

  it("sorts all 26 roles: a queue on Home, a screen with their work, or the member / event-day app", () => {
    const sorted = [...NO_PORTAL_SCREEN, ...Object.keys(HOME_TASKS), ...Object.keys(SCREEN_ONLY)].sort();
    expect(sorted).toEqual(personas.map((p) => p.role).sort());
  });

  it.each(NO_PORTAL_SCREEN)("%s: the portal shows Home and nothing else (their work is in the member app or the event-day app)", (role) => {
    expect(matrix[role].tasks).toEqual([]);
    expect(matrix[role].nav).toEqual(["home"]);
  });

  it.each(Object.entries(HOME_TASKS))("%s: Home 'My tasks' can list %j", (role, sources) => {
    for (const s of sources) expect(matrix[role].tasks).toContain(s);
  });

  it.each(Object.entries(SCREEN_ONLY))("%s: no Home queue, but %s has a screen for their work", (role, moduleKey) => {
    expect(matrix[role].tasks).toEqual([]);
    expect(matrix[role].nav).toContain(moduleKey);
  });

  it("the Pathshala principal, the Pathshala committee and the store lead are granted whole-community roles, which the portal honours", () => {
    for (const key of ["pathshala_principal", "pathshala_committee", "store_lead"]) {
      const role = roles.find((r) => r.key === key)!;
      expect(scopeOf(role)).toBe("center");
      expect(matrix[key].permissions.length).toBeGreaterThan(0);
    }
    expect(matrix.pathshala_principal.permissions).toContain("pathshala.manage");
    expect(matrix.store_lead.permissions).toContain("store.manage");
  });

  it("the event, class and zone roles keep the scope they are about", () => {
    expect(["event_lead", "checkin_volunteer", "boli_recorder"].map((k) => scopeOf(roles.find((r) => r.key === k)!))).toEqual(["event", "event", "event"]);
    expect(scopeOf(roles.find((r) => r.key === "teacher")!)).toBe("class");
    expect(scopeOf(roles.find((r) => r.key === "zone_lead")!)).toBe("zone");
  });
});
