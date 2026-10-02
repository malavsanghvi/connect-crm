// What the background service last saw from Anthropic, in plain words (Settings › Integrations).
//
// The worker reports it in its heartbeat as info.handlers[kind].ai for each kind that calls
// Anthropic (worker/src/ai-status.ts): app.background_service_status returns every worker's
// handlers, and app.niva_health returns niva.answer's entry, so Content › Niva can use
// aiServiceFromHandler on it too. A worker from before this report has no `ai`: nothing is shown.
// Pure (tested in tests/ai-service.test.ts).

import { isPlainObject } from "@/lib/center-rules";
import { formatDateTime } from "@/lib/dates";

export type AiServiceView = {
  /** null: nothing to flag either way (no call since the service started). */
  tone: "ok" | "warn" | "bad" | null;
  label: string;
  detail: string;
  /** Where ANTHROPIC_API_KEY comes from (names only), or null when the worker did not say. */
  key: string | null;
  /** The newest failed call, for staff who need the detail: "400 invalid_request_error: …". */
  lastError: { at: string; text: string } | null;
};

/** The kinds whose handler entry carries the AI status (worker/src/ai-status.ts ANTHROPIC_KINDS). */
export const AI_KINDS = ["niva.answer", "import.suggest_mapping", "qbo.match_suggest_ai"] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

function keyLine(source: string | null, envUnused: boolean): string | null {
  switch (source) {
    case "saved":
      return envUnused
        ? "Key: the one saved in Platform › Setup. The background service's environment also has one (ANTHROPIC_API_KEY), which is not used."
        : "Key: the one saved in Platform › Setup.";
    case "environment":
      return "Key: from the background service's environment (ANTHROPIC_API_KEY); none is saved in Platform › Setup.";
    case "none":
      return "Key: none is set, in Platform › Setup or in the background service's environment.";
    default:
      return null;
  }
}

/** One handler entry ({configured, reason?, ai?}) → the view, or null when it has no AI status. */
export function aiServiceFromHandler(handler: unknown, timeZone: string, now: Date = new Date()): AiServiceView | null {
  if (!isPlainObject(handler) || !isPlainObject(handler.ai)) return null;
  const ai = handler.ai;
  const at = (v: unknown) => formatDateTime(str(v), timeZone);
  const since = str(ai.since);
  const pausedUntil = str(ai.paused_until);
  const lastErrorText = str(ai.last_error);
  const lastErrorAt = str(ai.last_error_at);
  const view = (tone: AiServiceView["tone"], label: string, detail: string): AiServiceView => ({
    tone,
    label,
    detail,
    key: keyLine(str(ai.key_source), ai.env_key_unused === true),
    lastError: lastErrorText && lastErrorAt ? { at: at(lastErrorAt), text: lastErrorText } : null,
  });
  const lastOk = str(ai.last_ok_at) ? ` The last call that worked was at ${at(ai.last_ok_at)}.` : "";

  switch (ai.state) {
    case "ok":
      return view("ok", "Working", `Niva and the suggestions reach Anthropic${since ? ` (working since ${at(since)})` : ""}.`);
    case "paused": {
      const until = pausedUntil ? new Date(pausedUntil) : null;
      const label = until ? `Niva paused: AI spending limit until ${at(pausedUntil)}` : "Niva paused: AI spending limit";
      const when = !until
        ? " Anthropic did not say when access comes back."
        : until.getTime() <= now.getTime()
          ? " That time has passed; Niva confirms access is back on its next try."
          : "";
      return view(
        "bad",
        label,
        `Anthropic stopped accepting calls${since ? ` at ${at(since)}` : ""} because the account's spending limit or credit ran out.${when} Questions are kept and tried again automatically; raising the limit in the Anthropic console ends the pause sooner (then use Test in Platform › Setup › AI).${lastOk}`,
      );
    }
    case "key_refused":
      return view(
        "bad",
        "AI key refused",
        `Anthropic refused the key${since ? ` at ${at(since)}` : ""}, so Niva and the suggestions cannot run. A platform administrator needs to replace ANTHROPIC_API_KEY in Platform › Setup › AI, then use Test there.${lastOk}`,
      );
    case "unavailable":
      return view(
        "bad",
        "AI account not set up for these requests",
        `${since ? `Since ${at(since)}, ` : ""}Anthropic says this account cannot use the model or a feature Niva uses. A platform administrator needs to check the Anthropic account (or the CLAUDE_MODEL setting).${lastOk}`,
      );
    case "unreachable":
      return view(
        "warn",
        "AI service unreachable",
        `${since ? `Since ${at(since)}, ` : ""}Anthropic has been busy, rate limiting or out of reach. Calls are tried again automatically.${lastOk}`,
      );
    case "untested":
      return view(null, "Not used yet", "No AI call since the background service last started. The next question or suggestion shows whether the key works, or use Test in Platform › Setup › AI.");
    default:
      return null;
  }
}

/** From app.background_service_status: the first worker (live ones come first) whose handlers carry an AI status. */
export function aiServiceFromStatus(status: unknown, timeZone: string, now: Date = new Date()): AiServiceView | null {
  const s = isPlainObject(status) ? status : {};
  const workers = Array.isArray(s.workers) ? s.workers.filter(isPlainObject) : [];
  for (const w of workers) {
    const handlers = isPlainObject(w.handlers) ? w.handlers : {};
    for (const kind of AI_KINDS) {
      const v = aiServiceFromHandler(handlers[kind], timeZone, now);
      if (v) return v;
    }
  }
  return null;
}
