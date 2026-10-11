// What the chat needs from "the model": one call that takes the conversation and the tool list and answers with blocks. The real
// one talks to Anthropic (anthropic-http.ts); the tests use a scripted fake (tests/assistant/fake-model.ts), so nothing here
// needs the network. Shapes follow the Messages API: a message is text or blocks; a tool call is a `tool_use` block; its answer
// goes back as a `tool_result` block in the next user message.

import type { ModelTool } from "@/lib/commands";

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
/** Anything else the model sends (progress notes, reasoning blocks): kept and sent back unchanged, never shown. */
export type OtherBlock = { type: string; [key: string]: unknown };
export type ModelBlock = TextBlock | ToolUseBlock | OtherBlock;

export type ModelMessage = { role: "user"; content: string | ToolResultBlock[] } | { role: "assistant"; content: string | ModelBlock[] };

export type ModelRequest = {
  model: string;
  system: string;
  messages: ModelMessage[];
  tools: ModelTool[];
  /** "none" for the closing answer after the steps ran out: the tools stay listed (the conversation holds tool calls) but may not be used. */
  toolChoice?: "auto" | "none";
  maxTokens: number;
};

export type ModelResponse = {
  content: ModelBlock[];
  /** end_turn, tool_use, max_tokens, refusal, … as the API says it. */
  stopReason: string | null;
  usage?: { inputTokens: number; outputTokens: number };
};

export interface ModelClient {
  create(request: ModelRequest, options?: { signal?: AbortSignal }): Promise<ModelResponse>;
}

/** Why a model call failed, in the same words as src/lib/anthropic-errors.ts, plus "no_key" and "cancelled". */
export type ModelErrorKind = "no_key" | "auth" | "quota" | "config" | "transient" | "bad_request" | "cancelled";

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    /** The technical detail, for the server log only. */
    readonly detail: string,
    readonly status: number | null = null,
  ) {
    super(detail);
    this.name = "ModelError";
  }
}

export function isToolUse(block: ModelBlock): block is ToolUseBlock {
  return block.type === "tool_use" && typeof (block as ToolUseBlock).id === "string" && typeof (block as ToolUseBlock).name === "string";
}

export function isText(block: ModelBlock): block is TextBlock {
  return block.type === "text" && typeof (block as TextBlock).text === "string";
}
