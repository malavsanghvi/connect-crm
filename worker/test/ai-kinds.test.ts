import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AI_JOB_KINDS, iweaverKinds, modulesNeeded } from "../src/ai-kinds";
import { ANTHROPIC_KINDS } from "../src/ai-status";
import { HANDLERS } from "../src/handlers";

describe("the AI job kinds (iWeaver, 0755)", () => {
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
