// Talking to /api/assistant/** from the browser. Every function takes `fetch` as a parameter so tests can hand it a fake server.
// None of them throws for a problem the person can see: a failure comes back as a plain-English sentence.

import { createNdjsonParser, parseProposal } from "./ndjson";
import type { ChatEvent, ChatRequest, CommandInfo, CommandLevel, CommandsResponse, ConfirmRequest, ConfirmResponse, RunRequest, RunResponse } from "./protocol";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const COMMANDS_URL = "/api/assistant/commands";
export const RUN_URL = "/api/assistant/run";
export const CHAT_URL = "/api/assistant/chat";
export const CONFIRM_URL = "/api/assistant/confirm";
export const REJECT_URL = "/api/assistant/reject";

const NO_RESPONSE = "the server did not respond. Try again.";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A sentence for a refused or failed request, using the server's own words when it gave any. */
export function httpErrorMessage(status: number, body: unknown, doing: string): string {
  if (isObject(body) && typeof body.error === "string" && body.error.trim()) return body.error;
  if (status === 401) return `Could not ${doing} — you have been signed out. Sign in again.`;
  if (status === 403) return `Could not ${doing} — you don't have access to this.`;
  if (status === 404) return `Could not ${doing} — Niva is not available here.`;
  if (status === 429) return `Could not ${doing} — too many requests just now. Wait a moment and try again.`;
  return `Could not ${doing} — ${NO_RESPONSE}`;
}

// ---------------------------------------------------------------------------
// The command list, asked for once per page load
// ---------------------------------------------------------------------------
let commandsOnce: Promise<CommandsResponse | null> | null = null;

const LEVELS: readonly CommandLevel[] = ["read", "draft", "confirm", "only_you"];
const FIELD_TYPES = ["text", "number", "date", "choice"] as const;

/** One command from the server, checked so the palette never trips over a missing field. */
export function normaliseCommand(c: unknown): CommandInfo | null {
  if (!isObject(c)) return null;
  if (typeof c.key !== "string" || typeof c.title !== "string" || typeof c.area !== "string") return null;
  const level = LEVELS.find((l) => l === c.level);
  if (!level) return null;
  const fields: CommandInfo["fields"] = [];
  for (const f of Array.isArray(c.fields) ? c.fields : []) {
    if (!isObject(f) || typeof f.name !== "string" || typeof f.label !== "string") continue;
    const type = FIELD_TYPES.find((t) => t === f.type) ?? "text";
    fields.push({
      name: f.name,
      label: f.label,
      type,
      required: f.required === true,
      choices: Array.isArray(f.choices) ? f.choices.filter((x): x is string => typeof x === "string") : undefined,
    });
  }
  return { key: c.key, title: c.title, description: typeof c.description === "string" ? c.description : "", level, area: c.area, fields };
}

/** GET /commands. Null when anything is wrong (not signed in, not switched on, server down): the interface then shows nothing. */
export async function fetchCommands(f: FetchLike): Promise<CommandsResponse | null> {
  try {
    const res = await f(COMMANDS_URL, { method: "GET", headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    const body = await readJson(res);
    if (!isObject(body) || body.ok !== true || !Array.isArray(body.commands)) return null;
    const commands = body.commands.map(normaliseCommand).filter((c): c is CommandInfo => c !== null);
    const out: CommandsResponse = { ok: true, enabled: body.enabled === true, aiReady: body.aiReady === true, commands };
    if (isObject(body.usage) && typeof body.usage.used === "number") {
      out.usage = {
        used: body.usage.used,
        limit: typeof body.usage.limit === "number" ? body.usage.limit : null,
        month: typeof body.usage.month === "string" ? body.usage.month : "",
      };
    }
    return out;
  } catch {
    return null;
  }
}

/** The page asks once; every later caller gets the same answer. */
export function getCommandsOnce(f: FetchLike): Promise<CommandsResponse | null> {
  commandsOnce ??= fetchCommands(f);
  return commandsOnce;
}

/** Forget the cached answer (tests). */
export function resetCommandsCache(): void {
  commandsOnce = null;
}

// ---------------------------------------------------------------------------
// Run, confirm, reject
// ---------------------------------------------------------------------------
export async function runCommand(f: FetchLike, req: RunRequest): Promise<RunResponse> {
  try {
    const res = await f(RUN_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const body = await readJson(res);
    if (isObject(body) && body.ok === true) {
      if (body.kind === "proposal") {
        const proposal = parseProposal(body.proposal);
        return proposal ? { ok: true, kind: "proposal", proposal } : { ok: false, error: "Could not prepare that — the answer was not understood. Try again." };
      }
      if (body.kind === "result") {
        return { ok: true, kind: "result", title: typeof body.title === "string" ? body.title : "Result", data: body.data, text: typeof body.text === "string" ? body.text : undefined };
      }
    }
    if (isObject(body) && body.ok === false) {
      return { ok: false, error: httpErrorMessage(res.status, body, "run that"), needsStepUp: body.needsStepUp === true ? true : undefined };
    }
    return { ok: false, error: httpErrorMessage(res.status, body, "run that") };
  } catch {
    return { ok: false, error: `Could not run that — ${NO_RESPONSE}` };
  }
}

export async function confirmProposal(f: FetchLike, req: ConfirmRequest): Promise<ConfirmResponse> {
  try {
    const res = await f(CONFIRM_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const body = await readJson(res);
    if (isObject(body) && body.ok === true && typeof body.message === "string") {
      return { ok: true, message: body.message, data: body.data };
    }
    if (isObject(body) && body.ok === false) {
      const retryProposal = body.retryProposal === undefined ? undefined : (parseProposal(body.retryProposal) ?? undefined);
      return {
        ok: false,
        error: httpErrorMessage(res.status, body, "confirm that"),
        needsStepUp: body.needsStepUp === true ? true : undefined,
        retryProposal,
      };
    }
    return { ok: false, error: httpErrorMessage(res.status, body, "confirm that") };
  } catch {
    // We cannot tell whether the server got it: say so (the proposal is one-time, so trying again is safe).
    return { ok: false, error: "Could not confirm — the server did not respond. It may or may not have gone through, so check the record before you try again." };
  }
}

/** Throw away a proposal the person decided against. The body names the proposal and the exact input it was for. */
export async function rejectProposal(f: FetchLike, req: ConfirmRequest): Promise<boolean> {
  try {
    const res = await f(REJECT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const body = await readJson(res);
    return Boolean(res.ok && isObject(body) && body.ok === true);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The chat stream
// ---------------------------------------------------------------------------
export class ChatStreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChatStreamError";
  }
}

/**
 * POST /chat and hand every event to `onEvent` as it arrives. Resolves when the stream closes. Throws ChatStreamError (with a
 * plain sentence) when the request is refused or the connection fails; an abort resolves quietly.
 */
export async function streamChat(f: FetchLike, req: ChatRequest, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await f(CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
    throw new ChatStreamError(`Could not reach Niva — ${NO_RESPONSE}`, true);
  }

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("application/json")) {
    // A plain refusal ({ ok:false, error }) rather than a stream.
    const body = await readJson(res);
    throw new ChatStreamError(httpErrorMessage(res.status, body, "ask Niva"), res.status >= 500 || res.status === 429);
  }

  const parser = createNdjsonParser();
  const emit = (events: ChatEvent[]) => {
    for (const e of events) onEvent(e);
  };
  try {
    if (!res.body) {
      emit(parser.push(await res.text()));
      emit(parser.end());
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      emit(parser.push(decoder.decode(value, { stream: true })));
    }
    emit(parser.push(decoder.decode()));
    emit(parser.end());
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
    throw new ChatStreamError("The connection to Niva was lost while it was answering. Try again.", true);
  }
}

/** The browser's fetch, looked up at call time (so a test can replace it). */
export const browserFetch: FetchLike = (input, init) => fetch(input, init);
