#!/usr/bin/env node
// Which Server Actions have no command yet? (MASTER_PLAN priority 4, B90: "one typed command per action".)
//
// Reads every file under src/ that starts with "use server", lists its exported async functions, and checks each one against the
// `covers: ["src/app/(app)/events/actions.ts#saveEvent"]` lines in src/lib/commands/catalog/. Prints the actions that still have no
// command, grouped by area (the first folder under src/app/(app)/), with counts.
//
//   node scripts/commands-coverage.mjs             totals by area, then every action that has no command
//   node scripts/commands-coverage.mjs --summary   totals by area only
//   node scripts/commands-coverage.mjs --json      the same, as JSON (for a later check in CI)
//   node scripts/commands-coverage.mjs --area giving   only that area

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const catalogDir = join(srcDir, "lib", "commands", "catalog");

const args = process.argv.slice(2);
const summaryOnly = args.includes("--summary");
const asJson = args.includes("--json");
const areaFilter = args.includes("--area") ? args[args.indexOf("--area") + 1] : null;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const posix = (p) => p.split(sep).join("/");

/** True when the first statement of the file is the "use server" directive (comments may come first). */
function isUseServer(text) {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(text);
}

/** Names of the exported async functions: `export async function x`, `export const x = async …`, `export { x }`. */
function exportedActions(text) {
  const names = new Set();
  for (const m of text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=\n]+)?=\s*(?:async\b|[A-Za-z0-9_$.]+\(\s*async\b)/g)) names.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}(?!\s*from)/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && !part.trim().startsWith("type ")) names.add(name);
    }
  }
  return [...names];
}

/** The area of a file: the first folder under src/app/(app)/, else the first folder under src/app/, else "app". */
function areaOf(relPath) {
  const parts = relPath.split("/");
  const appIdx = parts.indexOf("(app)");
  if (appIdx >= 0 && parts[appIdx + 1] && !parts[appIdx + 1].includes(".")) return parts[appIdx + 1];
  if (parts[0] === "src" && parts[1] === "app" && parts[2] && !parts[2].includes(".")) return parts[2].replace(/^\[|\]$/g, "");
  if (parts[0] === "src" && parts[1] === "lib") return "lib";
  return "app";
}

// Actions the catalog says it covers.
const covered = new Set();
let commandCount = 0;
try {
  for (const file of walk(catalogDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`]((?:src\/)[^"'`\s#]+\.tsx?)#([A-Za-z0-9_$]+)["'`]/g)) covered.add(`${m[1]}#${m[2]}`);
    commandCount += (text.match(/\bdefineCommand\s*[<(]/g) ?? []).length;
  }
} catch (error) {
  console.error("Could not read the command catalog:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const actions = [];
for (const file of walk(srcDir)) {
  const text = readFileSync(file, "utf8");
  if (!isUseServer(text)) continue;
  const rel = posix(relative(root, file));
  for (const name of exportedActions(text)) {
    actions.push({ file: rel, name, area: areaOf(rel), covered: covered.has(`${rel}#${name}`) });
  }
}

const missing = actions.filter((a) => !a.covered);
const byArea = new Map();
for (const a of actions) {
  const row = byArea.get(a.area) ?? { area: a.area, total: 0, missing: 0, files: new Map() };
  row.total += 1;
  if (!a.covered) {
    row.missing += 1;
    row.files.set(a.file, [...(row.files.get(a.file) ?? []), a.name]);
  }
  byArea.set(a.area, row);
}
const rows = [...byArea.values()].filter((r) => !areaFilter || r.area === areaFilter).sort((a, b) => b.missing - a.missing || a.area.localeCompare(b.area));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        commands: commandCount,
        actions: actions.length,
        covered: actions.length - missing.length,
        without_command: missing.length,
        areas: rows.map((r) => ({ area: r.area, actions: r.total, without_command: r.missing, files: Object.fromEntries(r.files) })),
      },
      null,
      2,
    ),
  );
} else {
  console.log(`Server Actions: ${actions.length} in ${new Set(actions.map((a) => a.file)).size} files. Commands in the catalog: ${commandCount}.`);
  console.log(`Without a command yet: ${missing.length}. Covered: ${actions.length - missing.length}.\n`);
  const width = Math.max(4, ...rows.map((r) => r.area.length));
  console.log(`${"Area".padEnd(width)}  Without  Total`);
  for (const r of rows) console.log(`${r.area.padEnd(width)}  ${String(r.missing).padStart(7)}  ${String(r.total).padStart(5)}`);
  if (!summaryOnly) {
    for (const r of rows.filter((x) => x.missing > 0)) {
      console.log(`\n${r.area} (${r.missing})`);
      for (const [file, names] of [...r.files].sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${file}`);
        console.log(`    ${names.join(", ")}`);
      }
    }
  }
}
