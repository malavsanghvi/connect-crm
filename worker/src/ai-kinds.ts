// The one list of the job kinds that call an AI provider (docs/MARKETPLACE_PACKS.md section 2, migration 0755).
//
// `needs` is what a community must have on for a job of the kind to run, checked by the runner just before it runs
// (processJob, through app.worker_job_blocked): the kinds that are part of iWeaver need `ai` first, then the module the
// feature belongs to, so a job queued before iWeaver or Niva went off ends with a plain message and is not tried again.
// The kinds used in onboarding need nothing beyond their own permission checks and stay core. The provider Test buttons
// (platform.test_provider) are platform-only and not a community's AI, so they are not listed.
//
// The database has the iWeaver kinds too (app.ai_job_kinds, which app.enqueue_job refuses for a community without `ai`);
// test/ai-kinds.test.ts and test 162 each check that list.

export type AiProvider = "anthropic" | "gemini";

export type AiJobKind = {
  provider: AiProvider;
  /** Modules that must be on for the job's community, `ai` first. Empty: core (used in onboarding). */
  needs: readonly string[];
};

export const AI_JOB_KINDS: Readonly<Record<string, AiJobKind>> = {
  "niva.answer": { provider: "anthropic", needs: ["ai", "niva"] },
  "events.generate_flyer": { provider: "gemini", needs: ["ai", "events"] },
  // Core: used in onboarding (Setup step 10, and QuickBooks history brought in at onboarding).
  "import.suggest_mapping": { provider: "anthropic", needs: [] },
  "qbo.match_suggest_ai": { provider: "anthropic", needs: [] },
};

/** The modules a job of this kind needs on (empty for a kind that is not gated, AI or not). */
export function modulesNeeded(kind: string): readonly string[] {
  return Object.hasOwn(AI_JOB_KINDS, kind) ? AI_JOB_KINDS[kind]!.needs : [];
}

/** The kinds that are part of iWeaver (they need `ai`): the same list as app.ai_job_kinds(). */
export function iweaverKinds(): string[] {
  return Object.entries(AI_JOB_KINDS)
    .filter(([, k]) => k.needs.includes("ai"))
    .map(([kind]) => kind)
    .sort();
}
