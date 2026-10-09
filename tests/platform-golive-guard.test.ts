import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Owner decision 2026-10-09 (backlog B70): no screen or action may take a center live in one step. Going live is the
// owner's request after every readiness check passes, then two different Weaver admins approve it with a fresh security
// code. The older wizard's "Go live" button (goLiveAction) set status = 'active' with no check, no second approver and no
// code, and no database rule stopped it. This test keeps it from coming back.

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && e.name !== "database.types.ts" ? [p] : [];
  });
}

/** `.from("centers")` followed (within a few lines) by `.update({ ... status: "active" ... })`. */
const SETS_CENTER_ACTIVE = /from\(\s*["']centers["']\s*\)[\s\S]{0,300}?\.update\(\s*\{[^}]*\bstatus\s*:\s*["']active["']/;

describe("nothing takes a center live in one step", () => {
  const files = sourceFiles(SRC);

  it("reads the app's source", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("recognises the pattern it forbids", () => {
    expect(SETS_CENTER_ACTIVE.test(`await db.from("centers").update({ status: "active" }).eq("id", centerId)`)).toBe(true);
    expect(SETS_CENTER_ACTIVE.test(`const { data } = await auth.session.db\n  .from('centers')\n  .update({ name, status: 'active' })`)).toBe(true);
    expect(SETS_CENTER_ACTIVE.test(`await db.from("centers").update({ rules })`)).toBe(false);
    expect(SETS_CENTER_ACTIVE.test(`await db.from("centers").insert({ status: "onboarding" })`)).toBe(false);
  });

  it("no app code updates a center's status to active", () => {
    const offenders = files.filter((f) => SETS_CENTER_ACTIVE.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the wizard's one-step goLiveAction is gone", () => {
    const offenders = files.filter((f) => /\bgoLiveAction\b/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
