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

export interface CommandsResponse {
  ok: true;
  enabled: boolean; // is Niva for admins switched on for this community
  aiReady: boolean; // is a model key available (the palette works without it)
  commands: CommandInfo[];
  usage?: { used: number; limit: number | null; month: string };
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

/** What the person sees before pressing the button. Money is dollars on screen (cents underneath), households are cards. */
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
  | { type: "done"; usage?: { used: number; limit: number | null } };

export interface ConfirmRequest {
  proposalId: string;
  inputHash: string;
}

export type ConfirmResponse =
  | { ok: true; message: string; data?: unknown }
  | { ok: false; error: string; needsStepUp?: boolean; retryProposal?: ProposalCard };
