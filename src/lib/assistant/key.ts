import "server-only";

import { loadPlatformConfig, platformValue } from "@/lib/platform-setup/server-config";

import { createAnthropicClient } from "./anthropic-http";
import type { ModelClient } from "./model";

/**
 * The Anthropic key the portal server may use, or "" when there is none. It is read the way every other platform key is
 * (src/lib/platform-setup/server-config.ts): the one saved in Platform › Setup comes first (read from the vault by the
 * connect_worker connection, cached for a minute), then the server's environment. It never leaves the server.
 */
export async function assistantApiKey(): Promise<string> {
  await loadPlatformConfig();
  return platformValue("ANTHROPIC_API_KEY");
}

/** The real model client, or null when there is no key (the chat then says so in plain English). */
export async function assistantModelClient(): Promise<ModelClient | null> {
  const apiKey = await assistantApiKey();
  if (!apiKey) return null;
  return createAnthropicClient({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL });
}
