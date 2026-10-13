import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { AI_OFF, aiKnownOn, aiOn, chatAllowedAt, chatMode, communityOnboarding, isOnboardingPath, MARKETPLACE_HREF, moduleNeedsAi } from "@/lib/ai-gate";
import { ONBOARDING_COMMAND_KEYS, onboardingRegistry } from "@/lib/assistant/onboarding";
import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import { ART_AI_OFF, readFlyerArtStatus } from "@/lib/events/flyer-art";
import { buildUiRows, enterAction, NIVA_AI_OFF_TEXT } from "@/lib/find/rows";
import type { FindResponse } from "@/lib/find/types";

const session = (modulesOff: string[], status = "active", modulesStatus = "ok") => ({ modulesOff, modulesStatus, center: { status } });

describe("iWeaver's one sentence (0755)", () => {
  it("is the database's sentence, word for word", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0755_ai_gate.sql"), "utf8");
    const said = /function app\.ai_off_message\(\)[\s\S]*?select '([^']+)'::text/.exec(sql)?.[1];
    expect(said).toBe(AI_OFF);
    expect(AI_OFF).toBe("AI features are part of iWeaver, which is not on for your community.");
    expect(MARKETPLACE_HREF).toBe("/settings/marketplace");
  });
});

describe("is iWeaver on", () => {
  it("reads the community's modules, missing data meaning on as everywhere", () => {
    expect(aiOn({ modulesOff: ["ai"] })).toBe(false);
    expect(aiOn({ modulesOff: ["niva"] })).toBe(true);
    expect(aiOn({})).toBe(true);
  });
  it("before an AI call, is on only when the modules were read", () => {
    expect(aiKnownOn({ modulesOff: [], modulesStatus: "ok" })).toBe(true);
    expect(aiKnownOn({ modulesOff: ["ai"], modulesStatus: "ok" })).toBe(false);
    expect(aiKnownOn({ modulesOff: [], modulesStatus: "error" })).toBe(false);
    expect(aiKnownOn({ modulesOff: [] })).toBe(false);
  });
  it("knows which modules are AI: iWeaver and Niva", () => {
    expect(moduleNeedsAi("ai")).toBe(true);
    expect(moduleNeedsAi("niva")).toBe(true);
    expect(moduleNeedsAi("events")).toBe(false);
    expect(moduleNeedsAi("content")).toBe(false);
    expect(moduleNeedsAi("nothing")).toBe(false);
  });
});

describe("what the chat may do", () => {
  it("answers everywhere with iWeaver, only on the onboarding pages while onboarding without it, else nowhere", () => {
    expect(chatMode(session([]))).toBe("on");
    // Niva is needed too: pausing or never having it (or what it needs) keeps the chat off, with iWeaver or not.
    expect(chatMode(session(["niva"]))).toBe("off");
    expect(chatMode(session(["content"]))).toBe("off");
    expect(chatMode(session(["ai", "niva"], "onboarding"))).toBe("onboarding");
    expect(chatMode(session(["ai", "niva"], "active"))).toBe("off");
    expect(chatMode(session([], "active", "error"))).toBe("off");
    expect(chatMode(session([], "onboarding", "error"))).toBe("off");
    expect(communityOnboarding({ status: "onboarding" })).toBe(true);
    expect(communityOnboarding({ status: "active" })).toBe(false);
  });
  it("keeps the onboarding exemption to the onboarding pages", () => {
    expect(isOnboardingPath("/setup/onboarding")).toBe(true);
    expect(isOnboardingPath("/setup/onboarding/start")).toBe(true);
    expect(isOnboardingPath("/setup/onboarding/questions?x=1")).toBe(true);
    expect(isOnboardingPath("/setup/onboardingx")).toBe(false);
    expect(isOnboardingPath("/setup")).toBe(false);
    expect(isOnboardingPath("/people")).toBe(false);
    expect(isOnboardingPath(undefined)).toBe(false);
    expect(chatAllowedAt("onboarding", "/setup/onboarding/start")).toBe(true);
    expect(chatAllowedAt("onboarding", "/giving")).toBe(false);
    expect(chatAllowedAt("onboarding", null)).toBe(false);
    expect(chatAllowedAt("on", "/giving")).toBe(true);
    expect(chatAllowedAt("off", "/setup/onboarding/start")).toBe(false);
  });
});

describe("the onboarding commands", () => {
  const real = new CommandRegistry();
  for (const c of CATALOG) real.register(c);

  it("are all in the catalog, and none of them changes a record", () => {
    const onb = onboardingRegistry(real).all();
    expect(onb.map((c) => c.key).sort()).toEqual([...ONBOARDING_COMMAND_KEYS].sort());
    for (const c of onb) expect(["read", "only_you"]).toContain(c.level);
  });
  it("leave out everything else", () => {
    const keys = onboardingRegistry(real).all().map((c) => c.key);
    expect(keys).not.toContain("people.search");
    expect(keys).not.toContain("settings.grant_role");
    expect(keys.every((k) => k.startsWith("settings."))).toBe(true);
  });
});

describe("AI flyer art without iWeaver", () => {
  it("says so, and that the drawn art works", () => {
    expect(readFlyerArtStatus({ state: "ai_off", reason: AI_OFF })).toEqual({ state: "ai_off", message: ART_AI_OFF });
    expect(ART_AI_OFF).toBe(`${AI_OFF} The drawn art always works.`);
  });
});

describe("the find box without iWeaver", () => {
  const question: FindResponse = { query: "who gave the most last year?", kind: "question", rows: [], more: 0, filter: null, problem: null };
  it("says why a question cannot go to Niva, and keeps the command palette", () => {
    const { rows } = buildUiRows(question, { niva: "ai_off", withPalette: true });
    expect(rows).toEqual([
      { type: "message", key: "no-niva", text: NIVA_AI_OFF_TEXT, tone: "plain" },
      { type: "palette", key: "palette", text: question.query },
    ]);
    expect(NIVA_AI_OFF_TEXT.startsWith(AI_OFF)).toBe(true);
    expect(rows.some((r) => r.type === "niva")).toBe(false);
  });
  it("never sends Shift+Enter to Niva", () => {
    const { rows } = buildUiRows(question, { niva: "ai_off", withPalette: true });
    expect(enterAction(rows, -1, { shift: true, niva: "ai_off", typed: question.query })).toEqual({ type: "none" });
  });
});
