import "server-only";

import { ensureCatalog } from "@/lib/commands/catalog";
import { isCommandEnabled } from "@/lib/commands/enabled";
import { defaultRegistry } from "@/lib/commands/registry";
import { describe } from "@/lib/commands/text";
import type { Json } from "@/lib/database.types";

import { firstSentence } from "./present";

/** The write actions Niva could be allowed to prepare in a community (the confirm-level commands), for the Platform › Centers switches. */
export type ToolChoice = { key: string; title: string; description: string; on: boolean };

export function confirmToolChoices(rules: Json | undefined): ToolChoice[] {
  ensureCatalog();
  return defaultRegistry
    .all()
    .filter((c) => c.level === "confirm" && !c.screenOnly)
    .map((c) => ({ key: c.key, title: c.title, description: firstSentence(describe(c.description)), on: isCommandEnabled(c, rules) }));
}
