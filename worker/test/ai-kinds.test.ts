import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AI_JOB_KINDS, iweaverKinds, modulesNeeded, PLATFORM_AI_KINDS } from "../src/ai-kinds";
import { ANTHROPIC_KINDS } from "../src/ai-status";
import { HANDLERS } from "../src/handlers";

const HANDLERS_DIR = fileURLToPath(new URL("../src/handlers/", import.meta.url));

/** Source without comments (block comments and whole-line // comments), so a mention in a comment is not a call. */
function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Signs that a file calls an AI provider itself: the Anthropic client or SDK, a recorded Anthropic answer, Gemini's key or API. */
const CALLS_AI = /from\s+"(?:\.\.?\/)+anthropic"|@anthropic-ai\/sdk|anthropicClient\(|recordAnthropicResponse\(|GEMINI_API_KEY|generativelanguage\.googleapis\.com/;

/** Files that name the providers without calling them (readiness, the heartbeat's report, this list): not followed. */
const NAMES_ONLY = ["config.ts", "platform-config.ts", "ai-status.ts", "ai-kinds.ts", "log.ts", "errors.ts", "types.ts"];

/** A handler calls AI when its own code does, or a file it imports directly does (one level, outside the files that only name them). */
function callsAi(handlerFile: string): boolean {
  const src = code(handlerFile);
  if (CALLS_AI.test(src)) return true;
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    const base = resolve(dirname(handlerFile), m[1]!);
    const file = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((f) => existsSync(f));
    if (!file || NAMES_ONLY.some((n) => file.endsWith(join("worker", "src", n)))) continue;
    if (CALLS_AI.test(code(file))) return true;
  }
  return false;
}

describe("the AI job kinds (iWeaver, 0755)", () => {
  it("are every handler that calls an AI provider: a new AI handler that is not listed fails here", () => {
    const found = readdirSync(HANDLERS_DIR)
      .filter((f) => f.endsWith(".ts") && f !== "index.ts")
      .filter((f) => callsAi(join(HANDLERS_DIR, f)))
      .map((f) => f.replace(/\.ts$/, ""))
      .sort();
    expect(found).toEqual([...Object.keys(AI_JOB_KINDS), ...PLATFORM_AI_KINDS].sort());
    // So the iWeaver ones are exactly what the database refuses to queue (app.ai_job_kinds, checked below).
    expect(found.filter((k) => modulesNeeded(k).includes("ai"))).toEqual(iweaverKinds());
  });

  it("lists every kind that calls an AI provider, each a real handler", () => {
    const kinds = new Set(HANDLERS.map((h) => h.kind));
    for (const kind of Object.keys(AI_JOB_KINDS)) expect(kinds.has(kind)).toBe(true);
    expect(Object.keys(AI_JOB_KINDS).sort()).toEqual(["events.generate_flyer", "import.suggest_mapping", "niva.answer", "qbo.match_suggest_ai"]);
  });

  it("gates Niva and AI flyer art behind iWeaver first, then their own module", () => {
    expect(modulesNeeded("niva.answer")).toEqual(["ai", "niva"]);
    expect(modulesNeeded("events.generate_flyer")).toEqual(["ai", "events"]);
    expect(AI_JOB_KINDS["events.generate_flyer"]!.provider).toBe("gemini");
  });

  it("keeps the AI used in onboarding core, and gates nothing else", () => {
    expect(modulesNeeded("import.suggest_mapping")).toEqual([]);
    expect(modulesNeeded("qbo.match_suggest_ai")).toEqual([]);
    expect(modulesNeeded("platform.test_provider")).toEqual([]);
    expect(modulesNeeded("demo.ping")).toEqual([]);
    expect(modulesNeeded("toString")).toEqual([]);
  });

  it("is the same iWeaver list the database refuses to queue (app.ai_job_kinds, 0755)", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/0755_ai_gate.sql", import.meta.url)), "utf8");
    const body = /function app\.ai_job_kinds\(\)[\s\S]*?array\[([^\]]*)\]/.exec(sql)?.[1] ?? "";
    const listed = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(iweaverKinds());
    expect(iweaverKinds()).toEqual(["events.generate_flyer", "niva.answer"]);
  });

  it("keeps the heartbeat's Anthropic kinds as they were (flyer art is Gemini)", () => {
    expect([...ANTHROPIC_KINDS].sort()).toEqual(["import.suggest_mapping", "niva.answer", "qbo.match_suggest_ai"]);
  });
});
