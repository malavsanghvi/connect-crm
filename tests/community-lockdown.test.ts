import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Migration 0813 closes app.centers to guests (only plain columns of active communities) and to signed-in outsiders
// (only linked communities). What the portal shows a guest, or a signed-in person of another community, must come
// through app.community_public (0614). The database rules themselves are proven by supabase/tests/813.
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

describe("migration 0813", () => {
  const sql = read("supabase/migrations/0813_community_lockdown.sql");

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
});

// The inventory of who reads the community table over the API (docs/COMMUNITY_PUBLIC_DATA.md › Inventory). After 0813 a guest
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
