// The database's allow-list of import data types (app.import_entities, migration
// 0192) is generated from the registry, and tests/import-registry.test.ts fails
// when the two drift apart. Pure.

import { ENTITIES, NATURAL_KEYS, NO_CENTER_TABLES, entityColumns, entityExtras } from "@/lib/import/registry";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (xs: readonly string[]) => (xs.length ? `array[${xs.map(q).join(",")}]` : "'{}'::text[]");

export function importEntitiesSeedSql(): string {
  const rows = [...ENTITIES]
    .sort((a, b) => a.order - b.order)
    .map(
      (e) =>
        `  (${q(e.key)}, ${q(e.label)}, ${q(e.tier)}, ${e.order}, ${q(e.table)}, ${arr(e.writePerms)}, ${e.module ? q(e.module) : "null"},\n` +
        `   ${arr(entityColumns(e))},\n   ${arr(entityExtras(e))}, ${arr(NATURAL_KEYS[e.key] ?? [])}, ${arr(e.moneyFields ?? [])}, ${
          NO_CENTER_TABLES.includes(e.table) ? "false" : "true"
        })`,
    );
  return [
    "insert into app.import_entities (key, label, tier, sort, target_table, write_perms, module_key, columns, extras, natural_key, money_columns, has_center) values",
    rows.join(",\n"),
    "on conflict (key) do update set label = excluded.label, tier = excluded.tier, sort = excluded.sort, target_table = excluded.target_table,",
    "  write_perms = excluded.write_perms, module_key = excluded.module_key, columns = excluded.columns, extras = excluded.extras,",
    "  natural_key = excluded.natural_key, money_columns = excluded.money_columns, has_center = excluded.has_center;",
  ].join("\n");
}
