// Prompt caching for every product call to the Anthropic Messages API, and the numbers that show whether it works.
// Pure (no imports, no I/O, no SDK), so the portal's assistant (a plain fetch, src/lib/assistant/anthropic-http.ts) and the
// background service (the SDK, worker/src/anthropic.ts) share one set of rules, and the tests need no network.
//
// What caching is: Anthropic keeps the processed form of the START of a request (tools, then system, then messages) for a few
// minutes, and a later request that begins with exactly the same bytes pays about a tenth of the normal price for that part
// (a first request pays a quarter more to write it). So only text that is the same on every request may come first; anything
// that differs per request (today's date, who is asking, which page they are on, the question) must come after the last
// marker, never before it. Markers (`cache_control`) never change what the model reads: the answer is the same, only cheaper.
//
// docs/ARCHITECTURE.md ("AI calls: prompt caching") says what is cached, what must stay out of the prefix and how to read the
// numbers.

export type CacheControl = { type: "ephemeral"; ttl?: "1h" };

/**
 * How long a cached prefix lives after its last use: "5m" (the default, no field sent; every use renews it, writes cost 1.25x) or
 * "1h" (writes cost 2x; only worth it when the same prefix is used again 5 to 60 minutes later and not sooner). The assistant's
 * steps follow each other within seconds, so the short life is the cheaper one. Change this one constant after reading the real
 * cache_read numbers in the logs, not before.
 */
export const PROMPT_CACHE_TTL: "5m" | "1h" = "5m";

export function cacheControl(): CacheControl {
  return PROMPT_CACHE_TTL === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
}

/** AI_PROMPT_CACHE=off (or 0, false, no) switches every marker off without a code change; anything else leaves caching on. */
export function promptCacheEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  const v = env.AI_PROMPT_CACHE?.trim().toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

// The shortest prefix (in tokens) the model will cache; a shorter one is processed normally and no error comes back. The table
// is the one in Anthropic's prompt caching documentation. A model not listed here is treated as the strictest (4096), so a
// prefix is never marked on a guess.
const MINIMUMS: [RegExp, number][] = [
  [/^claude-(fable|mythos)-5(-1)?(-|$)/, 512],
  [/^claude-opus-5(-5)?(-|$)/, 512],
  [/^claude-sonnet-5-5(-|$)/, 512],
  [/^claude-haiku-5-5(-|$)/, 512],
  [/^claude-mythos-preview/, 2048],
  [/^claude-opus-4-7(-|$)/, 2048],
  [/^claude-haiku-3-5/, 2048],
  [/^claude-opus-4-[56](-|$)/, 4096],
  [/^claude-haiku-4-5/, 4096],
  [/^claude-opus-4-8(-|$)/, 1024],
  [/^claude-sonnet-(5|4-6|4-5|4)(-|$)/, 1024],
  [/^claude-opus-4(-1)?(-|$)/, 1024],
];
const UNKNOWN_MODEL_MINIMUM = 4096;

export function cacheMinimumTokens(model: string): number {
  for (const [pattern, min] of MINIMUMS) if (pattern.test(model)) return min;
  return UNKNOWN_MODEL_MINIMUM;
}

/**
 * A rough count of the tokens in some text or JSON, deliberately on the low side (about 4.5 characters a token; real text runs
 * 3 to 4.3), so a prefix is only marked when it is surely long enough. The real count comes back in the response's usage.
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return Math.floor(text.length / 4.5);
}

// ── Putting the markers on a request ──────────────────────────────────────────────────────────────────────────────────

type Block = Record<string, unknown>;

/** The parts of a Messages API request that caching looks at. Anything else on the request is left alone. */
export type CacheableRequest = {
  model: string;
  system?: string | readonly object[];
  tools?: readonly object[];
  messages: readonly { role: string; content: string | readonly object[] }[];
};

export type CacheOptions = {
  /**
   * When `system` is a string: the leading part that is the same on every request (a prefix of `system`). The rest, which
   * differs per request, follows the marker. Absent: all of `system` is stable.
   */
  systemStable?: string;
  /**
   * Also mark the last block of the last message (a user turn), for a loop that sends the growing conversation again and again:
   * each step then reads what the step before wrote. Off for a single call and for a call that cannot be followed by another.
   */
  marksMessages?: boolean;
};

/** Which parts got a marker. */
export type CacheMarks = { tools: boolean; system: boolean; messages: boolean };

export const NO_MARKS: CacheMarks = { tools: false, system: false, messages: false };

export function markCount(marks: CacheMarks): number {
  return Number(marks.tools) + Number(marks.system) + Number(marks.messages);
}

const MARKABLE = new Set(["text", "tool_result", "tool_use", "image", "document"]);

/**
 * The same request with `cache_control` markers added where the prefix is stable and long enough to be worth caching:
 *   - on the last tool (so the whole tool list is cached, and shared by every request with the same tools),
 *   - on the last stable system block (tools and system together),
 *   - on the last block of the last user message, when `marksMessages` is set.
 * A marker is only added when the text up to it is at least the model's minimum. Nothing else changes: a string `system` or
 * message becomes a one-block list (a marker needs a block), and the text is exactly the same. Returns the request itself, not
 * a copy, when nothing was marked. The input is never changed.
 */
export function withPromptCaching<T extends CacheableRequest>(request: T, options: CacheOptions = {}): { request: T; marks: CacheMarks } {
  const min = cacheMinimumTokens(request.model);
  const marks: CacheMarks = { tools: false, system: false, messages: false };
  const out: Record<string, unknown> = { ...request };

  const tools = request.tools && request.tools.length > 0 ? request.tools : null;
  const toolTokens = tools ? estimateTokens(tools) : 0;
  if (tools && toolTokens >= min) {
    out.tools = [...tools.slice(0, -1), { ...(tools[tools.length - 1] as Block), cache_control: cacheControl() }];
    marks.tools = true;
  }

  // The system prompt. Only a string is split and marked; a list of blocks the caller built is left as it is.
  const system = request.system;
  if (typeof system === "string" && system.length > 0) {
    // A stable part that is not the start of the system prompt is a mistake in the caller: nothing is marked rather than risk
    // caching text that varies.
    const claimed = options.systemStable;
    const stable = claimed === undefined || claimed.length === 0 ? system : system.startsWith(claimed) ? claimed : null;
    if (stable !== null && toolTokens + estimateTokens(stable) >= min) {
      const rest = system.slice(stable.length);
      out.system = [{ type: "text", text: stable, cache_control: cacheControl() }, ...(rest ? [{ type: "text", text: rest }] : [])];
      marks.system = true;
    }
  }

  // The last block of the conversation so far.
  const messages = request.messages;
  const last = messages[messages.length - 1];
  if (options.marksMessages && last && last.role === "user") {
    const before = toolTokens + estimateTokens(system ?? "") + estimateTokens(messages);
    if (before >= min) {
      const marked = markLastBlock(last.content);
      if (marked) {
        out.messages = [...messages.slice(0, -1), { ...last, content: marked }];
        marks.messages = true;
      }
    }
  }

  return markCount(marks) === 0 ? { request, marks } : { request: out as unknown as T, marks };
}

function markLastBlock(content: string | readonly object[]): Block[] | null {
  if (typeof content === "string") return content.length > 0 ? [{ type: "text", text: content, cache_control: cacheControl() }] : null;
  const lastBlock = content[content.length - 1] as Block | undefined;
  if (!lastBlock || typeof lastBlock.type !== "string" || !MARKABLE.has(lastBlock.type)) return null;
  if (lastBlock.type === "text" && !(typeof lastBlock.text === "string" && lastBlock.text.length > 0)) return null;
  return [...(content.slice(0, -1) as Block[]), { ...lastBlock, cache_control: cacheControl() }];
}

// ── What a call cost, from the response ───────────────────────────────────────────────────────────────────────────────

/**
 * The four numbers every response carries: input_tokens (the part after the last marker, full price), cache_creation_input_tokens
 * (written to the cache, 1.25x), cache_read_input_tokens (read from the cache, about 0.1x) and output_tokens. A response from a
 * request that had no markers, or an older API, leaves the cache fields out: they read as 0.
 */
export type AiUsage = { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number };

/** AiUsage summed over the calls of one chat message or one job. */
export type AiTokens = AiUsage & { calls: number };

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The usage object of a response (snake_case, as the API sends it, null or missing fields read as 0); undefined when there is none. */
export function parseUsage(raw: unknown): AiUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const u = raw as Record<string, unknown>;
  return {
    inputTokens: count(u.input_tokens),
    outputTokens: count(u.output_tokens),
    cacheCreationInputTokens: count(u.cache_creation_input_tokens),
    cacheReadInputTokens: count(u.cache_read_input_tokens),
  };
}

export function addUsage(total: AiTokens | undefined, usage: AiUsage | undefined): AiTokens | undefined {
  if (!usage) return total;
  const t = total ?? { calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  return {
    calls: t.calls + 1,
    inputTokens: t.inputTokens + usage.inputTokens,
    outputTokens: t.outputTokens + usage.outputTokens,
    cacheCreationInputTokens: t.cacheCreationInputTokens + usage.cacheCreationInputTokens,
    cacheReadInputTokens: t.cacheReadInputTokens + usage.cacheReadInputTokens,
  };
}

/** A tokens object read back from JSON (the chat's closing event); null unless every field is a count. */
export function parseTokens(raw: unknown): AiTokens | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  const fields = ["calls", "inputTokens", "outputTokens", "cacheCreationInputTokens", "cacheReadInputTokens"] as const;
  if (!fields.every((f) => typeof t[f] === "number" && Number.isFinite(t[f]) && (t[f] as number) >= 0)) return null;
  return {
    calls: t.calls as number,
    inputTokens: t.inputTokens as number,
    outputTokens: t.outputTokens as number,
    cacheCreationInputTokens: t.cacheCreationInputTokens as number,
    cacheReadInputTokens: t.cacheReadInputTokens as number,
  };
}

/** Of all the input a call (or a set of calls) read, the share that came from the cache, 0 to 1; 0 when there was no input. */
export function cacheReadShare(u: Pick<AiUsage, "inputTokens" | "cacheCreationInputTokens" | "cacheReadInputTokens">): number {
  const all = u.inputTokens + u.cacheCreationInputTokens + u.cacheReadInputTokens;
  return all > 0 ? u.cacheReadInputTokens / all : 0;
}

/**
 * The fields of the one log line written per call: no prompt, no answer, no names; only where the call came from, the model, the
 * four counts and how many markers the request carried. The portal and the background service write the same names. They avoid
 * the word "token" on purpose: the service's logger blanks any field whose name looks like a secret (worker/src/log.ts).
 *   input        = usage.input_tokens                 (read at full price: the part after the last marker)
 *   cache_write  = usage.cache_creation_input_tokens  (written to the cache, 1.25x)
 *   cache_read   = usage.cache_read_input_tokens      (read from the cache, about 0.1x)
 *   output       = usage.output_tokens
 */
export function aiCallFields(kind: string, model: string, usage: AiUsage | undefined, marks: CacheMarks): Record<string, unknown> {
  return {
    kind,
    model,
    input: usage?.inputTokens ?? null,
    cache_write: usage?.cacheCreationInputTokens ?? null,
    cache_read: usage?.cacheReadInputTokens ?? null,
    output: usage?.outputTokens ?? null,
    cache_marks: markCount(marks),
  };
}

/** The same counts for a job's stored result, under ai_usage (names as in the log line, plus the number of calls). Nothing when no call returned usage. */
export function usageForResult(tokens: AiTokens | undefined): { ai_usage?: Record<string, number> } {
  if (!tokens) return {};
  return {
    ai_usage: {
      calls: tokens.calls,
      input: tokens.inputTokens,
      cache_write: tokens.cacheCreationInputTokens,
      cache_read: tokens.cacheReadInputTokens,
      output: tokens.outputTokens,
    },
  };
}
