// iWeaver (docs/MARKETPLACE_PACKS.md section 2, migration 0755): every AI feature needs the `ai` module, except AI used in
// onboarding. Pure (no server imports), so the routes, the screens and the tests read the same rules and the same words.
//
// The database is the enforcement (app.assert_module_enabled, app.enqueue_job, app.flyer_art_over_limit,
// app.assistant_usage_check, app.worker_job_blocked). The one place the portal calls an AI provider itself, Niva for admins'
// chat, is checked here AND by app.assistant_usage_check before every model call.
//
// Commands that use no model (the command palette, the find box's command rows, the confirmation cards) are not AI: they
// work whether `ai` is on or not. Only the chat needs it.

import { AI_OFF } from "@/lib/ai-off";
import { isModuleEnabled, isModuleKey, moduleDef, type ModuleContext } from "@/lib/modules";
import { pathUnder } from "@/lib/permissions";

/** The one sentence said wherever AI is refused because iWeaver is off (the database's app.ai_off_message says the same). */
export { AI_OFF };

/** Where an administrator asks for iWeaver. */
export const MARKETPLACE_HREF = "/settings/marketplace";

/** The module key of iWeaver. Never renamed (installed member apps read keys, not labels). */
export const AI_MODULE = "ai";

/**
 * Is iWeaver on for this community? From `modulesOff` (app.my_modules), like every module: missing data means on, as
 * everywhere in the portal, because the database refuses anyway. The chat, which calls the provider from the portal, uses
 * `aiKnownOn` instead.
 */
export function aiOn(ctx: ModuleContext): boolean {
  return isModuleEnabled(ctx, AI_MODULE);
}

/** Modules that are AI: iWeaver itself, and Niva (it depends on iWeaver since the catalog, 0750-0754). */
const AI_DEPENDENTS: readonly string[] = [AI_MODULE, "niva"];

/** Does the module need iWeaver: it is iWeaver, Niva, or depends on one of them (the portal's catalog, src/lib/modules.ts)? */
export function moduleNeedsAi(key: string): boolean {
  const seen = new Set<string>();
  const walk = (k: string): boolean => {
    if (AI_DEPENDENTS.includes(k)) return true;
    if (seen.has(k) || !isModuleKey(k)) return false;
    seen.add(k);
    return moduleDef(k).dependsOn.some(walk);
  };
  return walk(key);
}

/** On only when the modules were read and iWeaver is not among the ones that are off: no guessing before an AI call. */
export function aiKnownOn(ctx: ModuleContext & { modulesStatus?: string }): boolean {
  return ctx.modulesStatus === "ok" && aiOn(ctx);
}

/** The pages that are onboarding: Setup › Bring your data in, Guided onboarding and its questions. */
export const ONBOARDING_PATH = "/setup/onboarding";

export function isOnboardingPath(path: string | null | undefined): boolean {
  return typeof path === "string" && pathUnder(path.split("?")[0]!.split("#")[0]!, ONBOARDING_PATH);
}

/** The community's own state says it is onboarding (app.centers.status: only Weaver changes it, 0756). */
export function communityOnboarding(center: { status?: string | null }): boolean {
  return center.status === "onboarding";
}

/**
 * What Niva for admins' chat may do for this community (the database's app.assistant_chat_mode decides the same):
 *   on          iWeaver AND Niva are on: the chat as before
 *   onboarding  iWeaver is off, the community is onboarding and Niva itself is on apart from iWeaver: the chat only on the
 *               onboarding pages, with the onboarding commands only (src/lib/assistant/onboarding.ts), counted against the
 *               same monthly limit
 *   off         anything else (iWeaver off, Niva paused or never had, the modules not read): no chat; the commands still work
 */
export type ChatMode = "on" | "onboarding" | "off";

export function isChatMode(v: unknown): v is ChatMode {
  return v === "on" || v === "onboarding" || v === "off";
}

/**
 * The chat mode as far as the session can tell. "onboarding" is only a candidate: whether Niva itself is on apart from
 * iWeaver is not in `modulesOff` (Niva reads off whenever iWeaver is), so the server confirms it with app.assistant_chat_mode.
 */
export function chatMode(session: ModuleContext & { modulesStatus?: string; center: { status?: string | null } }): ChatMode {
  if (aiKnownOn(session)) return isModuleEnabled(session, "niva") ? "on" : "off";
  if (session.modulesStatus === "ok" && communityOnboarding(session.center)) return "onboarding";
  return "off";
}

/** Whether the chat may answer a question asked from `path` (the route pattern the interface sends). */
export function chatAllowedAt(mode: ChatMode, path: string | null | undefined): boolean {
  return mode === "on" || (mode === "onboarding" && isOnboardingPath(path));
}
