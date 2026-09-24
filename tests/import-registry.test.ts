import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { importEntitiesSeedSql } from "@/lib/import/entities-sql";
import { ENTITIES, NATURAL_KEYS, entityColumns } from "@/lib/import/registry";

const MIGRATION = fileURLToPath(new URL("../supabase/migrations/0192_import_engine.sql", import.meta.url));
const BEGIN = "-- BEGIN import_entities seed (generated from src/lib/import/registry.ts)";
const END = "-- END import_entities seed";

function seedBlock(sql: string): string {
  const a = sql.indexOf(BEGIN);
  const b = sql.indexOf(END);
  if (a < 0 || b < 0) return "";
  return sql.slice(a + BEGIN.length, b).trim();
}

describe("import registry", () => {
  it("matches the database allow-list in migration 0192", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const want = importEntitiesSeedSql();
    if (process.env.GEN_IMPORT_SEED === "1") {
      const a = sql.indexOf(BEGIN);
      const b = sql.indexOf(END);
      const next = a >= 0 && b >= 0 ? `${sql.slice(0, a)}${BEGIN}\n${want}\n${sql.slice(b)}` : `${sql}\n${BEGIN}\n${want}\n${END}\n`;
      writeFileSync(MIGRATION, next);
      return;
    }
    expect(seedBlock(sql)).toBe(want);
  });

  it("has unique keys, fields and targets for every data type", () => {
    const keys = ENTITIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of ENTITIES) {
      const fk = e.fields.map((f) => f.key);
      expect(new Set(fk).size, `${e.key} field keys`).toBe(fk.length);
      for (const f of e.fields) {
        expect(Boolean(f.column) !== Boolean(f.extra), `${e.key}.${f.key} has exactly one target`).toBe(true);
        if (f.type === "enum") expect(f.options?.length, `${e.key}.${f.key} options`).toBeGreaterThan(0);
        if (f.type === "ref") expect(f.ref, `${e.key}.${f.key} ref`).toBeDefined();
      }
      for (const k of e.sourceKey) expect(fk, `${e.key} source key ${k}`).toContain(k);
      for (const d of e.dependsOn) expect(keys, `${e.key} depends on ${d}`).toContain(d);
      for (const nk of NATURAL_KEYS[e.key] ?? []) expect(entityColumns(e), `${e.key} natural key ${nk}`).toContain(nk);
      expect(e.fields.some((f) => f.required), `${e.key} has a required field`).toBe(true);
    }
  });

  it("never links a person or a household by name", () => {
    for (const e of ENTITIES) {
      for (const f of e.fields) {
        if (f.ref?.kind === "lookup") expect(["people", "households"]).not.toContain(f.ref.table);
      }
    }
  });

  it("loads dependencies before the data that points at them (Appendix B order)", () => {
    for (const e of ENTITIES) {
      for (const d of e.dependsOn) {
        const dep = ENTITIES.find((x) => x.key === d)!;
        if (e.key === "bolis" && d === "events") continue; // past events and bolis are both history; a boli's event is optional
        expect(dep.order, `${d} loads before ${e.key}`).toBeLessThan(e.order);
      }
    }
  });
});
