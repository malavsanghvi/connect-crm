// The real model client: one Messages API call over fetch, the way src/lib/platform-setup/checks.ts makes its test call. It needs
// no SDK (so no new dependency); it reads a failure with the same helpers the setup wizard and the background service use
// (src/lib/anthropic-errors.ts), and it tries a busy moment once more before giving up.

import { aiCallFields, parseUsage, withPromptCaching, type CacheMarks } from "@/lib/anthropic-cache";
import { anthropicErrorBody, anthropicErrorKind } from "@/lib/anthropic-errors";

import { ModelError, type ModelBlock, type ModelClient, type ModelRequest, type ModelResponse } from "./model";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export type AnthropicClientOptions = {
  apiKey: string;
  /** ANTHROPIC_BASE_URL: only to point tests at a local mock server. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** One call's limit (default 60 seconds); the whole chat message has its own. */
  timeoutMs?: number;
  /** Extra tries after a busy moment (rate limit, overload, no connection). Default 1. */
  retries?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Mark the stable start of each request for prompt caching (default true; AI_PROMPT_CACHE=off turns it off, see
   * src/lib/assistant/key.ts). The answers are the same either way; only what the call costs differs.
   */
  promptCache?: boolean;
  /** Where the one line per call goes (the model, the four token counts, how many cache markers; never any content). Default: the server log. */
  log?: (line: string) => void;
};

const API_VERSION = "2023-06-01";

/**
 * Models that take an effort level (output_config.effort). Others (older Sonnet, Haiku 4.5) refuse the field, so it is only sent
 * to these. "medium" is the setting recommended for tool use that is not coding.
 */
export function effortFor(model: string): "medium" | undefined {
  return /^claude-(sonnet-5|sonnet-4-6|opus-5|opus-4-[678]|fable-|mythos-|haiku-5)/.test(model) ? "medium" : undefined;
}

function parseResponse(text: string): ModelResponse {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ModelError("bad_request", `the AI service answered something that is not JSON: ${text.slice(0, 200)}`);
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!Array.isArray(o.content)) throw new ModelError("bad_request", `the AI service answered without content: ${text.slice(0, 200)}`);
  return {
    content: o.content.filter((b): b is ModelBlock => !!b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string"),
    stopReason: typeof o.stop_reason === "string" ? o.stop_reason : null,
    usage: parseUsage(o.usage),
  };
}

/**
 * The JSON sent to the Messages API. With caching on, the stable start of the request carries `cache_control` markers (the last
 * tool, the end of the stable system text, and the last block of the conversation so far, so each step of the tool loop reads
 * what the step before wrote); the text itself is unchanged. The closing call (tool_choice "none") marks no message block: it
 * cannot be followed by another step, and a changed tool_choice does not reuse the message cache anyway.
 */
export function requestBody(req: ModelRequest, withEffort: boolean, caching = true): { json: string; marks: CacheMarks } {
  const effort = withEffort ? effortFor(req.model) : undefined;
  const plain = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    ...(req.tools.length > 0 ? { tools: req.tools } : {}),
  };
  const { request, marks } = caching
    ? withPromptCaching(plain, { systemStable: req.systemStable, marksMessages: req.toolChoice !== "none" })
    : { request: plain, marks: { tools: false, system: false, messages: false } };
  return {
    json: JSON.stringify({
      ...request,
      ...(req.tools.length > 0 ? { tool_choice: { type: req.toolChoice ?? "auto" } } : {}),
      ...(effort ? { output_config: { effort } } : {}),
    }),
    marks,
  };
}

export function createAnthropicClient(options: AnthropicClientOptions): ModelClient {
  const send: FetchLike = options.fetch ?? (async (url, init) => {
    const res = await fetch(url, init);
    return { status: res.status, text: () => res.text() };
  });
  const base = (options.baseUrl?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 60_000;
  const retries = options.retries ?? 1;
  const delay = options.retryDelayMs ?? 700;
  /** The key is never part of anything logged. */
  const scrub = (text: string): string => (options.apiKey ? text.split(options.apiKey).join("[key]") : text);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const caching = options.promptCache !== false;
  const log = options.log ?? ((line: string) => console.info(line));

  async function attempt(req: ModelRequest, withEffort: boolean, outer?: AbortSignal): Promise<ModelResponse> {
    if (outer?.aborted) throw new ModelError("cancelled", "the request was cancelled");
    const timer = new AbortController();
    const onAbort = () => timer.abort();
    outer?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => timer.abort(), timeoutMs);
    try {
      const { json, marks } = requestBody(req, withEffort, caching);
      const res = await send(`${base}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": options.apiKey, "anthropic-version": API_VERSION, "content-type": "application/json" },
        body: json,
        signal: timer.signal,
      });
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        const answer = parseResponse(text);
        log(JSON.stringify({ msg: "ai call", ...aiCallFields("assistant", req.model, answer.usage, marks), stop_reason: answer.stopReason }));
        return answer;
      }
      const { type, message } = anthropicErrorBody(text);
      const kind = anthropicErrorKind(res.status, type, message);
      throw new ModelError(kind, scrub(`HTTP ${res.status}${type ? ` ${type}` : ""}: ${message}`.slice(0, 500)), res.status);
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (outer?.aborted) throw new ModelError("cancelled", "the request was cancelled");
      const why = timer.signal.aborted ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : error instanceof Error ? error.message : String(error);
      throw new ModelError("transient", scrub(`could not reach the AI service: ${why}`));
    } finally {
      clearTimeout(timeout);
      outer?.removeEventListener("abort", onAbort);
    }
  }

  return {
    async create(req, opts) {
      let last: ModelError | null = null;
      let withEffort = true;
      for (let tries = 0; tries <= retries; tries++) {
        try {
          return await attempt(req, withEffort, opts?.signal);
        } catch (error) {
          if (!(error instanceof ModelError)) throw error;
          last = error;
          // A model that does not know the effort setting answers 400 about it: ask again without it (once).
          if (error.kind === "bad_request" && withEffort && effortFor(req.model) && /effort|output_config/i.test(error.detail)) {
            withEffort = false;
            tries -= 1;
            continue;
          }
          // Only a busy moment is worth another try; a refused key, an empty account or a bad request would fail the same way.
          if (error.kind !== "transient" || tries === retries) throw error;
          await sleep(delay);
        }
      }
      throw last ?? new ModelError("transient", "the AI service did not answer");
    },
  };
}
