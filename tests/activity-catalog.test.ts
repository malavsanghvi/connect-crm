import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guards the keys the portal records against the allowlist the database seeds (migration 0620, the activity
// catalog). The database drops an event whose key is not in the catalog, silently, so a typo or a renamed key
// would lose its events without any error. Every key given to withActivity(...) or to runAction's `activity`
// option in src/ must be one the catalog lists.
//
// Written as: withActivity("area.verb", ...) and { key: "area.verb", entityFrom: ... } (the two forms the code uses).

const ROOT = process.cwd();
const migrations = join(ROOT, "supabase", "migrations");
const catalogFile = existsSync(migrations) ? readdirSync(migrations).find((f) => /^0620_.*\.sql$/.test(f)) : undefined;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const KEY = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*){1,2}";
const FORMS = [new RegExp(`withActivity\\(\\s*"(${KEY})"`, "g"), new RegExp(`\\{\\s*key:\\s*"(${KEY})"\\s*,\\s*entityFrom`, "g")];

function recordedKeys(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(join(ROOT, "src"))) {
    // The wrapper's own documentation and the test helpers are not recording sites.
    if (file.replace(/\\/g, "/").includes("/src/lib/activity/")) continue;
    const text = readFileSync(file, "utf8");
    for (const form of FORMS) for (const m of text.matchAll(form)) found.set(m[1], file);
  }
  return found;
}

describe("the keys the portal records", () => {
  it("finds the wrapped actions (so the guard below cannot pass by finding nothing)", () => {
    const keys = [...recordedKeys().keys()];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys).toContain("giving.record_payment");
    expect(keys).toContain("events.save");
  });

  it.skipIf(!catalogFile)("are all in the database's activity catalog (migration 0620)", () => {
    const sql = readFileSync(join(migrations, catalogFile as string), "utf8");
    const missing = [...recordedKeys()].filter(([key]) => !sql.includes(`'${key}'`)).map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});
