import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NAV } from "@/lib/permissions";

// Guards the keys the portal records against the allowlist the database seeds (migration 0620, the activity
// catalog, and the migrations after it that add keys with app.activity_register, such as 0625). The database drops
// an event whose key is not in the catalog, silently, so a typo or a renamed key would lose its events without any
// error. Every key given to withActivity(...) or to runAction's `activity` option in src/ must be one the catalog
// lists, and so must the screen of every tab in the portal's navigation.
//
// Written as: withActivity("area.verb", ...) and { key: "area.verb", entityFrom: ... } (the two forms the code uses).

const ROOT = process.cwd();
const migrations = join(ROOT, "supabase", "migrations");
// 0620 and every later migration that registers keys.
const catalogSql = existsSync(migrations)
  ? readdirSync(migrations)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 620)
      .map((f) => readFileSync(join(migrations, f), "utf8"))
      .filter((text) => text.includes("activity_register"))
      .join("\n")
  : "";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const KEY = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*){1,2}";
const FORMS = [new RegExp(`withActivity\\(\\s*"(${KEY})"`, "g"), new RegExp(`\\{\\s*key:\\s*"(${KEY})"\\s*,\\s*entityFrom`, "g")];

// Read once: scanning every source file takes seconds, and two tests ask.
let recorded: Map<string, string> | null = null;

function recordedKeys(): Map<string, string> {
  if (recorded) return recorded;
  const found = new Map<string, string>();
  for (const file of sourceFiles(join(ROOT, "src"))) {
    // The wrapper's own documentation and the test helpers are not recording sites.
    if (file.replace(/\\/g, "/").includes("/src/lib/activity/")) continue;
    const text = readFileSync(file, "utf8");
    for (const form of FORMS) for (const m of text.matchAll(form)) found.set(m[1], file);
  }
  recorded = found;
  return found;
}

describe("the keys the portal records", () => {
  it("finds the wrapped actions (so the guard below cannot pass by finding nothing)", () => {
    const keys = [...recordedKeys().keys()];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys).toContain("giving.record_payment");
    expect(keys).toContain("events.save");
    // The two actions 0625 added keys for.
    expect(keys).toContain("comms.approve_campaign");
    expect(keys).toContain("bolis.record_pledge");
  });

  it.skipIf(!catalogSql)("are all in the database's activity catalog (migrations 0620 and 0625)", () => {
    const missing = [...recordedKeys()].filter(([key]) => !catalogSql.includes(`'${key}'`)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});

// The organization's own data (WeCare, docs/WECARE.md section 3, W2) is never recorded in the activity stream: its screens are
// left out of the catalog on purpose, so the database drops their events and none can reach the share-with-Weaver set.
const PRIVATE_SCREENS = ["/care"];

describe("the screens of the navigation", () => {
  it.skipIf(!catalogSql)("each tab's address is a screen key the database lists", () => {
    const hrefs = NAV.flatMap((m) => m.tabs.map((t) => t.href)).filter((href) => !PRIVATE_SCREENS.some((p) => href === p || href.startsWith(`${p}/`)));
    const missing = hrefs.filter((href) => !catalogSql.includes(`'screen:${href}'`));
    expect(missing).toEqual([]);
  });

  it.skipIf(!catalogSql)("never lists WeCare's screens or actions, so nothing of them is recorded (W2)", () => {
    expect(NAV.some((m) => m.tabs.some((t) => t.href === "/care"))).toBe(true);
    expect(catalogSql).not.toMatch(/'screen:\/care/);
    expect([...recordedKeys().keys()].filter((k) => k.startsWith("care."))).toEqual([]);
  });
});
