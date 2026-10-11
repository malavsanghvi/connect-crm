import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Built for every organization. The modules below write sentences for Niva, the routines, the learning and content commands, the rail
// and the reports. None of them may write down a Jain word, a community's address or a dollar: those come from the organization's kind
// and settings, and the only place a tradition's own example may be written is the term table (src/lib/kind-samples.ts, src/lib/wording.ts).
//
// The check reads the text of the strings in each module (comments and identifiers are not text a person reads) and fails on:
//   Pathshala, Diwali, Paryushan, Satvik, Gyan Path, Jainism    (capitalised wording; routes and keys such as /pathshala are lower case)
//   stavan, jsh                                                 (any case; jsh as a word)
//   a dollar sign before a number, a lone "$", "dollar(s)", "USD"

const root = process.cwd();

/** The text of every string and template in a TypeScript file, without comments. Single-quoted strings are not read (the codebase uses double quotes). */
export function stringTexts(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i += 1;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
    } else if (c === '"') {
      let s = "";
      i += 1;
      while (i < n && source[i] !== '"' && source[i] !== "\n") {
        if (source[i] === "\\") {
          s += source[i + 1] ?? "";
          i += 2;
        } else {
          s += source[i];
          i += 1;
        }
      }
      out.push(s);
      i += 1;
    } else if (c === "`") {
      let s = "";
      let depth = 0;
      i += 1;
      while (i < n && !(source[i] === "`" && depth === 0)) {
        if (source[i] === "\\") {
          s += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") depth += 1;
        else if (source[i] === "}" && depth > 0) depth -= 1;
        s += source[i];
        i += 1;
      }
      out.push(s);
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

const BANNED: [string, RegExp][] = [
  ["Pathshala", /Pathshala/],
  ["Diwali", /Diwali/],
  ["Paryushan", /Paryushan/],
  ["Satvik", /Satvik/],
  ["Gyan Path", /Gyan Path/],
  ["Jainism", /Jainism/],
  ["stavan", /stavan/i],
  ["jsh", /\bjsh\b/i],
  ["a dollar sign before a number", /\$\s?\d/],
  ["a lone dollar sign", /^\$$/],
  ["dollars", /\bdollars?\b/i],
  ["USD", /\bUSD\b/],
];

export function problemsIn(source: string): string[] {
  const found: string[] = [];
  for (const text of stringTexts(source)) for (const [name, re] of BANNED) if (re.test(text)) found.push(`${name}: ${text.slice(0, 90)}`);
  return found;
}

function filesUnder(rel: string): string[] {
  const full = join(root, rel);
  if (statSync(full).isFile()) return [rel];
  return readdirSync(full).flatMap((name) => {
    const p = `${rel}/${name}`;
    return statSync(join(root, p)).isDirectory() ? filesUnder(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const CHANGED = [
  "src/lib/assistant/context.ts",
  "src/lib/assistant/prompt.ts",
  "src/lib/assistant/community.ts",
  "src/lib/assistant/present.ts",
  "src/lib/assistant/choices.ts",
  "src/lib/routines/recipes.ts",
  "src/lib/routines/resolve.ts",
  "src/lib/routines/briefing.ts",
  "src/lib/routines/clock.ts",
  "src/lib/routines/needs.ts",
  "src/components/today/routine-card.tsx",
  "src/app/(app)/today-home.tsx",
  "src/lib/data/today.ts",
  "src/lib/commands/catalog/learning",
  "src/lib/commands/catalog/content",
  "src/lib/commands/catalog/platform",
  "src/lib/commands/catalog/events/clone.ts",
  "src/lib/commands/catalog/messages/audience.ts",
  "src/lib/commands/catalog/settings/only-you.ts",
  "src/lib/commands/catalog/reports",
  "src/lib/commands/text.ts",
  "src/lib/commands/registry.ts",
  "src/lib/workspaces.ts",
  "src/lib/reports/periods.ts",
  "src/lib/reports/fiscal.ts",
  "src/lib/payments/plugins/enabled.ts",
  "src/app/(app)/reports/page.tsx",
];

describe("the scanner", () => {
  it("reads strings and templates, and not comments or identifiers", () => {
    expect(stringTexts('const a = "Diwali"; // Pathshala\n/* stavan */ const b = `x ${y} Satvik`; const isPathshalaFund = 1;')).toEqual(["Diwali", "x ${y} Satvik"]);
    expect(problemsIn('const a = "Diwali"; // Pathshala')).toEqual(["Diwali: Diwali"]);
    expect(problemsIn('const a = "/pathshala/terms"; const b = "pathshala_fee_totals";')).toEqual([]);
    expect(problemsIn("const a = `Fee of $135 for ${school}`; const b = `${x}`;")).toHaveLength(1);
    expect(problemsIn('const a = "$"; const b = "in dollars"; const c = "USD";')).toHaveLength(3);
    expect(problemsIn('const a = "jsh"; const b = "Stavans"; const c = "Jain";')).toHaveLength(2);
  });
});

describe("modules that serve every organization", () => {
  const files = CHANGED.flatMap(filesUnder);

  it("covers the modules this change touched", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain("src/lib/commands/catalog/learning/fee-report.ts");
    expect(files).toContain("src/lib/assistant/context.ts");
  });

  it.each(files)("%s writes no Jain word, no community address and no dollar", (file) => {
    expect(problemsIn(readFileSync(join(root, file), "utf8"))).toEqual([]);
  });

  it("leaves the term tables as the only place a tradition's own example is written", () => {
    const table = readFileSync(join(root, "src/lib/kind-samples.ts"), "utf8");
    expect(problemsIn(table).join(" ")).toMatch(/Diwali/);
    expect(problemsIn(table).join(" ")).toMatch(/stavan/i);
  });
});

describe("no command speaks of dollars", () => {
  it.each(filesUnder("src/lib/commands/catalog"))("%s", (file) => {
    const text = stringTexts(readFileSync(join(root, file), "utf8")).filter((t) => /\bdollars?\b/i.test(t));
    expect(text).toEqual([]);
  });
});
