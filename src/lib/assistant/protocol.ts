/**
 * The wire contract between Niva for admins' server (src/app/api/assistant/**) and its interface (src/components/niva/**).
 * Both sides copy this file verbatim to src/lib/assistant/protocol.ts. Changing it needs both builders.
 *
 *   GET  /api/assistant/commands          -> CommandsResponse           (the commands THIS person may use, for the palette and the panel)
 *   POST /api/assistant/run               -> RunResponse                (run ONE command by key, no model: palette and buttons)
 *   POST /api/assistant/chat              -> NDJSON stream of ChatEvent (one JSON object per line), body ChatRequest
 *   POST /api/assistant/confirm           -> ConfirmResponse            (execute a proposal after the person pressed the button)
 *   POST /api/assistant/reject            -> { ok: boolean }
 *
 * Every route works as the signed-in person (their session, their rights); every route answers 401/403 with
 * { ok:false, error } in plain English; "Niva for admins is not switched on" is a normal answer, not a crash.
 */

export type CommandLevel = "read" | "draft" | "confirm" | "only_you";

export interface CommandInfo {
  key: string; // e.g. "people.search"
  title: string; // "Find a person or household"
  description: string; // one plain sentence
  level: CommandLevel;
  area: string; // "people" | "giving" | "events" | "messages" | "accounting" | "tasks"
  /** What the person may type for it; used by the palette to show a tiny form. */
  fields: { name: string; label: string; type: "text" | "number" | "date" | "choice"; required: boolean; choices?: string[] }[];
}

/** The community's own conventions, so the panel words its examples for THIS community (never a guess about where it is). */
export interface CommunityHints {
  currency: string; // ISO 4217: "USD", "INR", "GBP"
  locale: string; // how it writes digits and days: "en-US", "en-IN"
  paymentPlugins: string[] | null; // payment ways switched on ("zelle", "check"); null when they could not be read
  modulesOff: string[]; // modules the community has switched off
  slug?: string; // the community's address, sent only to the Weaver team
}

export interface CommandsResponse {
  ok: true;
  enabled: boolean; // is Niva for admins switched on for this community
  aiReady: boolean; // is a model key available (the palette works without it)
  /**
   * Whether the chat may answer (0755): "on" everywhere (iWeaver and Niva on), "onboarding" only on the onboarding pages
   * (iWeaver is off, the community is onboarding, Niva is on), "off" not at all (the commands still work). Absent from an
   * older server: "on".
   */
  chat?: "on" | "onboarding" | "off";
  /** Why the chat is off: iWeaver ("ai"), Niva paused or never enabled ("niva"), or it could not be checked ("unknown"). */
  chatOff?: "ai" | "niva" | "unknown";
  commands: CommandInfo[];
  usage?: { used: number; limit: number | null; month: string };
  community?: CommunityHints;
}

export interface RunRequest {
  key: string;
  input: Record<string, unknown>;
}

/** A result already cleaned by the child filter and the secret stripper (src/lib/commands). */
export type RunResponse =
  | { ok: true; kind: "result"; title: string; data: unknown; text?: string }
  | { ok: true; kind: "proposal"; proposal: ProposalCard }
  | { ok: false; error: string; needsStepUp?: boolean };

/** What the person sees before pressing the button. Money is shown in the community's currency on screen (minor units underneath), households are cards. */
export interface ProposalCard {
  id: string;
  command: string;
  title: string; // "Change the event's venue"
  lines: string[]; // plain sentences: what will happen
  cards?: unknown[]; // household_card objects, adults only
  confirmText: string; // the button label, e.g. "Change the venue"
  inputHash: string;
  expiresAt: string; // ISO
}

export interface ChatRequest {
  message: string;
  threadId?: string;
  /** Where the person is: a route PATTERN and ids found in the address, so "this event" works. Never form contents. */
  context?: { path: string; entityKind?: string; entityId?: string };
}

export type ChatEvent =
  | { type: "thread"; threadId: string }
  | { type: "text"; text: string } // a piece of the answer
  | { type: "tool"; command: string; title: string; status: "running" | "done" | "failed" }
  | { type: "result"; command: string; title: string; data: unknown } // a read/draft result to show as a card
  | { type: "proposal"; proposal: ProposalCard }
  | { type: "error"; message: string; retryable: boolean }
  /** `tokens` (optional): what the model calls of this message used, with the prompt-cache counts; absent when the AI service sent none. */
  | { type: "done"; usage?: { used: number; limit: number | null }; tokens?: ChatTokens };

/** What the model calls of one chat message used (optional on "done"). The cache counts show how much came cheaper from the prompt cache. */
export interface ChatTokens {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface ConfirmRequest {
  proposalId: string;
  inputHash: string;
}

export type ConfirmResponse =
  | { ok: true; message: string; data?: unknown }
  | { ok: false; error: string; needsStepUp?: boolean; retryProposal?: ProposalCard };
