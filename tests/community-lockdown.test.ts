import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Migration 0615 closes app.centers to guests (only plain columns of active communities) and to signed-in outsiders
// (only linked communities). What the portal shows a guest, or a signed-in person of another community, must come
// through app.community_public (0614). The database rules themselves are proven by supabase/tests/96.
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

describe("migration 0615", () => {
  const sql = read("supabase/migrations/0615_community_lockdown.sql");

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
