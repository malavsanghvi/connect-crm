import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Migration 0817 closes app.centers to guests (only plain columns of active communities) and to signed-in outsiders
// (only linked communities). What the portal shows a guest, or a signed-in person of another community, must come
// through app.community_public (0614). The database rules themselves are proven by supabase/tests/817.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("the portal reads a community's public part through app.community_public", () => {
  it("the sign-in page (a guest) no longer reads the table", () => {
    const src = read("src/app/login/page.tsx");
    expect(src).not.toContain('.from("centers")');
    expect(src).toContain('rpc("community_public", { p_slug: slug })');
  });

  it("the public dashboard (a guest) no longer reads the table", () => {
    const src = read("src/app/c/[slug]/page.tsx");
    expect(src).not.toContain('from("centers")');
    expect(src.match(/rpc\("community_public", \{ p_slug: slug \}\)/g)).toHaveLength(2);
  });

  it("the session falls back to the public part for someone not linked, so they get 'no access', not 'not found'", () => {
    const src = read("src/lib/session.ts");
    const fallback = src.indexOf('rpc("community_public", { p_slug: slug })');
    expect(fallback).toBeGreaterThan(src.indexOf('.from("centers")'));
    expect(src.indexOf('status: "center_missing"', fallback)).toBeGreaterThan(fallback);
  });
});

describe("migration 0817", () => {
  const sql = read("supabase/migrations/0817_community_lockdown.sql");

  it("grants a guest the plain columns only", () => {
    expect(sql).toContain("revoke select on app.centers from anon;");
    const grant = sql.match(/grant select \(([^)]*)\)\s+on app\.centers to anon;/);
    expect(grant).not.toBeNull();
    const cols = (grant?.[1] ?? "").split(",").map((c) => c.trim());
    expect(cols).not.toContain("rules");
    expect(cols).not.toContain("branding");
    expect(cols).not.toContain("feature_flags");
    expect(cols).toEqual(expect.arrayContaining(["id", "slug", "name", "short_name", "state_region", "environment", "status"]));
  });

  it("replaces the read-everything policy and keeps the pinned search path on its functions", () => {
    expect(sql).toContain("drop policy if exists centers_public_read on app.centers;");
    expect(sql).not.toMatch(/create policy centers_public_read/);
    for (const fn of sql.match(/create or replace function[\s\S]*?\$\$/g) ?? []) {
      expect(fn).toContain("security definer set search_path = app, public, extensions");
    }
  });

  it("runs after 0816 and keeps its demo rules: a demo community is open exactly while the demo is on", () => {
    const files = readdirSync(join(process.cwd(), "supabase/migrations")).sort();
    expect(files.indexOf("0817_community_lockdown.sql")).toBeGreaterThan(files.findIndex((f) => f.startsWith("0816_")));
    const code = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    // the open question for a community, the guest row policy and the linked row policy all carry the 0816 terms
    expect(code).toMatch(/create or replace function app\.community_open[\s\S]*?app\.demo_public_open\(c\.id\)[\s\S]*?not app\.demo_closed_to_guests\(c\.id\)/);
    expect(code).toMatch(/create policy centers_guest_read[\s\S]*?app\.demo_public_open\(id\)[\s\S]*?not app\.demo_closed_to_guests\(id\)/);
    expect(code).toMatch(/create policy centers_linked_read[\s\S]*?not app\.demo_closed_to_guests\(id\)/);
    // the leaders and the access areas ask community_open, so the demo rules reach them; 0816's gates are left alone
    expect(code).toMatch(/create policy org_leaders_public_read[\s\S]*?app\.community_open\(center_id\)/);
    expect(code).toMatch(/create or replace function app\.access_center_open[\s\S]*?app\.community_open\(c\.id\)/);
    expect(code).not.toContain("demo_guest_gate");
  });
});

// The inventory of who reads the community table over the API (docs/COMMUNITY_PUBLIC_DATA.md › Inventory). After 0817 a guest
// reads the plain columns of active communities and a signed-in person only the communities they are linked to, so a NEW file
// that reads the table must be one of those people's (staff of their own community, a platform admin), or use
// app.community_public. Adding a file to this list is the moment to check which of them it is.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith("database.types.ts") ? [full] : [];
  });
}

describe("who reads the community table", () => {
  const readers = sourceFiles(join(process.cwd(), "src"))
    .filter((f) => /\.from\(\s*["'`]centers["'`]\s*\)/.test(readFileSync(f, "utf8")))
    .map((f) => relative(process.cwd(), f).split("\\").join("/"))
    .sort();

  it("is the staff, platform and session code that docs/COMMUNITY_PUBLIC_DATA.md lists, and nothing a guest reaches", () => {
    expect(readers).toEqual(
      [
        // the signed-in person's own community (a linked person; the session falls back to community_public otherwise)
        "src/lib/session.ts",
        // settings managers writing or reading their own community's rules (linked: they hold the role)
        "src/app/(app)/calendar/page.tsx",
        "src/app/(app)/content/actions.ts",
        "src/app/(app)/settings/rules/actions.ts",
        "src/app/(app)/setup/actions.ts",
        "src/app/(app)/store/actions.ts",
        "src/lib/data/center-rules-write.ts",
        // right after accept_invitation, which links the person first
        "src/app/invite/[token]/actions.ts",
        // platform admins only (every one of these pages and actions refuses anyone else first; a platform admin reads every row)
        "src/app/(app)/platform/actions.ts",
        "src/app/(app)/platform/automation/page.tsx",
        "src/app/(app)/platform/centers/[id]/page.tsx",
        "src/app/(app)/platform/centers/[id]/products/page.tsx",
        "src/app/(app)/platform/codes/page.tsx",
        "src/app/(app)/platform/go-live/page.tsx",
        "src/app/(app)/platform/new/page.tsx",
        "src/app/(app)/platform/page.tsx",
        "src/app/(app)/platform/support-access/page.tsx",
        "src/lib/commands/catalog/platform/shared.ts",
      ].sort(),
    );
  });
});
