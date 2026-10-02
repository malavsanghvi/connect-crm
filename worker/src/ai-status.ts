// What this background service last saw from Anthropic, in memory, for the heartbeat.
//
// Every Anthropic call goes through anthropicClient() (worker/src/anthropic.ts), whose fetch
// records here what each call finally got (a try the SDK makes again by itself is not recorded,
// only the next one), and the setup wizard's AI test (platform.test_provider) records its call
// too. The heartbeat reports it inside info.handlers[kind].ai for each kind that calls
// Anthropic (ANTHROPIC_KINDS), because that is the part of the heartbeat that
// app.background_service_status (Settings › Integrations) and app.niva_health (Content › Niva)
// already return. A key that is present but blocked (spending limit, refused) is then visible
// there, where "configured" alone only says the key is set.
//
// The heartbeat's info is audited every time it changes, so the report changes only when
// something happens that staff would want to know: the state changes, or a call fails. While
// calls keep working, nothing in it moves ("since" says how long it has been working).

import { anthropicErrorBody, anthropicErrorKind, regainAccessAt, type AnthropicErrorKind } from "../../src/lib/anthropic-errors";
import { scrubText } from "./log";

/** The job kinds that call Anthropic: the heartbeat adds the status to each of their handler entries. */
export const ANTHROPIC_KINDS: ReadonlySet<string> = new Set(["niva.answer", "import.suggest_mapping", "qbo.match_suggest_ai"]);

/**
 * untested     no call since this service started
 * ok           the last call worked
 * paused       the account's spending limit or credit ran out (it comes back by itself, or when raised)
 * key_refused  Anthropic refused the key
 * unavailable  the account cannot use the model or a feature the requests use
 * unreachable  Anthropic was busy, rate limited, timed out or could not be reached
 * A request Anthropic did not accept for its own content (bad_request) says nothing about the
 * service, so it is kept as the last error without changing the state.
 */
export type AiState = "untested" | "ok" | "paused" | "key_refused" | "unavailable" | "unreachable";

const STATE_OF: Record<Exclude<AnthropicErrorKind, "bad_request">, AiState> = {
  quota: "paused",
  auth: "key_refused",
  config: "unavailable",
  transient: "unreachable",
};

/** One failed call, as worker/src/anthropic.ts classifies it. */
export type AiFailure = {
  kind: AnthropicErrorKind;
  status: number | null;
  type: string | null;
  message: string;
  regainAt: Date | null;
  timedOut?: boolean;
};

/** info.handlers[kind].ai in the heartbeat (snake_case, ISO times). */
export type AiStatusReport = {
  state: AiState;
  /** When the current state began (null while untested). */
  since: string | null;
  /** The newest call that worked, reported only while the state is not ok (while ok it would move with every call). */
  last_ok_at: string | null;
  /** The newest failed call, kept after the service recovers. */
  last_error_at: string | null;
  last_error_kind: AnthropicErrorKind | null;
  /** "400 invalid_request_error: You have reached your specified API usage limits…", at most 300 characters, never a key. */
  last_error: string | null;
  /** While paused: when Anthropic said access comes back, when it said (else null). */
  paused_until: string | null;
};

export type AiStatus = {
  ok(): void;
  failed(f: AiFailure): void;
  report(): AiStatusReport;
};

/** No key in a message, ever: an Anthropic key and anything the log scrubber would blank. */
function safe(text: string): string {
  return scrubText(text).replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[redacted]").replace(/\s+/g, " ").trim().slice(0, 300);
}

function label(f: AiFailure): string {
  const head = f.status === null ? (f.timedOut ? "timed out" : "no connection") : f.type ? `${f.status} ${f.type}` : String(f.status);
  return f.message ? `${head}: ${f.message}` : head;
}

export function createAiStatus(now: () => Date = () => new Date()): AiStatus {
  let state: AiState = "untested";
  let since: Date | null = null;
  let lastOk: Date | null = null;
  let lastError: { at: Date; kind: AnthropicErrorKind; text: string } | null = null;
  let pausedUntil: Date | null = null;

  const enter = (next: AiState, at: Date) => {
    if (next !== state) {
      state = next;
      since = at;
    }
    if (next !== "paused") pausedUntil = null;
  };

  return {
    ok() {
      const at = now();
      lastOk = at;
      enter("ok", at);
    },
    failed(f) {
      const at = now();
      lastError = { at, kind: f.kind, text: safe(label(f)) };
      if (f.kind === "bad_request") return;
      const wasPaused = state === "paused";
      enter(STATE_OF[f.kind], at);
      if (f.kind === "quota") {
        const regain = f.regainAt && f.regainAt.getTime() > at.getTime() ? f.regainAt : null;
        // A later answer that names no time keeps the time an earlier one gave.
        pausedUntil = regain ?? (wasPaused ? pausedUntil : null);
      }
    },
    report() {
      return {
        state,
        since: since?.toISOString() ?? null,
        last_ok_at: state === "ok" ? null : (lastOk?.toISOString() ?? null),
        last_error_at: lastError?.at.toISOString() ?? null,
        last_error_kind: lastError?.kind ?? null,
        last_error: lastError?.text ?? null,
        paused_until: pausedUntil?.toISOString() ?? null,
      };
    },
  };
}

/** This process's one status: every Anthropic call site records into it. */
export const aiStatus: AiStatus = createAiStatus();

/** One HTTP answer from Anthropic (a status and its body text), recorded. */
export function recordAnthropicResponse(status: AiStatus, httpStatus: number, text: string): void {
  if (httpStatus >= 200 && httpStatus < 300) {
    status.ok();
    return;
  }
  const { type, message } = anthropicErrorBody(text);
  const kind = anthropicErrorKind(httpStatus, type, message);
  status.failed({ kind, status: httpStatus, type, message, regainAt: kind === "quota" ? regainAccessAt(message) : null });
}

/** A call that got no answer at all (refused connection, DNS, the client's timeout). */
export function recordAnthropicNoAnswer(status: AiStatus, err: unknown): void {
  const name = (err as { name?: unknown } | null)?.name;
  const timedOut = name === "AbortError" || name === "TimeoutError";
  const message = err instanceof Error ? err.message : String(err);
  status.failed({ kind: "transient", status: null, type: null, message, regainAt: null, timedOut });
}

/**
 * Where ANTHROPIC_API_KEY comes from, by name only (platform-config.ts: a key saved in the setup
 * wizard is used before the environment's). `env_key_unused`: the environment also has one, which
 * the saved key overrides.
 */
export function anthropicKeySource(platform: { saved: string[]; env: string[] }): { key_source: "saved" | "environment" | "none"; env_key_unused: boolean } {
  const saved = platform.saved.includes("ANTHROPIC_API_KEY");
  const env = platform.env.includes("ANTHROPIC_API_KEY");
  return { key_source: saved ? "saved" : env ? "environment" : "none", env_key_unused: saved && env };
}
