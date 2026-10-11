// The conversation as the panel keeps it: a list of messages, each answer made of parts (text, tool chips, result cards, proposals).
// A pure reducer: the chat stream's events go in, the message list comes out. Ids are counted, not random, so tests are exact.

import type { ChatEvent, ProposalCard } from "./protocol";

export type ToolStatus = "running" | "done" | "failed";

export type AssistantPart =
  | { kind: "text"; text: string }
  | { kind: "tool"; command: string; title: string; status: ToolStatus }
  | { kind: "result"; command: string; title: string; data: unknown }
  | { kind: "proposal"; proposal: ProposalCard };

export type AssistantStatus = "streaming" | "done" | "error" | "stopped";

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      parts: AssistantPart[];
      status: AssistantStatus;
      error?: { message: string; retryable: boolean };
      /** Made by a palette command, not by a question: "Try again" does not apply to it. */
      local?: boolean;
    };

export type ChatState = {
  messages: ChatMessage[];
  threadId?: string;
  /** An answer is arriving. */
  busy: boolean;
  nextId: number;
  usage?: { used: number; limit: number | null };
  /** What was asked last, so "Try again" can ask it again. */
  lastAsked?: string;
};

export const initialChatState: ChatState = { messages: [], busy: false, nextId: 1 };

export type ChatAction =
  | { type: "send"; text: string }
  | { type: "event"; event: ChatEvent }
  /** The stream closed. If the answer never said it was done, it was cut short. */
  | { type: "finished" }
  /** The request itself failed (no connection, the server refused). */
  | { type: "failed"; message: string; retryable: boolean }
  | { type: "stopped" }
  /** Drop the failed answer and start a fresh one for the same question. */
  | { type: "retry" }
  /** Something the person ran from the palette: shown in the panel like an answer, with no model involved. */
  | { type: "local_result"; asked: string; command: string; title: string; data: unknown; text?: string }
  | { type: "local_proposal"; asked: string; proposal: ProposalCard }
  | { type: "reset" };

export const CUT_SHORT_MESSAGE = "The answer stopped before it was finished. Try again.";

/** The newest answer to a question (palette results are not answers to a question). */
function lastAnswerIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "assistant" && !m.local) return i;
  }
  return -1;
}

/** Applies a change to the newest assistant message when it is still arriving. */
function withStreaming(state: ChatState, change: (m: Extract<ChatMessage, { role: "assistant" }>) => Extract<ChatMessage, { role: "assistant" }>): ChatState {
  const i = lastAnswerIndex(state.messages);
  if (i < 0) return state;
  const m = state.messages[i];
  if (m.role !== "assistant" || m.status !== "streaming") return state;
  const messages = state.messages.slice();
  messages[i] = change(m);
  return { ...state, messages };
}

function applyEvent(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "thread":
      return { ...state, threadId: event.threadId };
    case "text":
      return withStreaming(state, (m) => {
        const last = m.parts[m.parts.length - 1];
        if (last && last.kind === "text") {
          const parts = m.parts.slice(0, -1);
          parts.push({ kind: "text", text: last.text + event.text });
          return { ...m, parts };
        }
        return { ...m, parts: [...m.parts, { kind: "text", text: event.text }] };
      });
    case "tool":
      return withStreaming(state, (m) => {
        // A chip that is already running for this command is updated; otherwise a new chip appears.
        for (let i = m.parts.length - 1; i >= 0; i -= 1) {
          const p = m.parts[i];
          if (p.kind === "tool" && p.command === event.command && p.status === "running") {
            const parts = m.parts.slice();
            parts[i] = { kind: "tool", command: event.command, title: event.title || p.title, status: event.status };
            return { ...m, parts };
          }
        }
        return { ...m, parts: [...m.parts, { kind: "tool", command: event.command, title: event.title, status: event.status }] };
      });
    case "result":
      return withStreaming(state, (m) => ({ ...m, parts: [...m.parts, { kind: "result", command: event.command, title: event.title, data: event.data }] }));
    case "proposal":
      return withStreaming(state, (m) => ({ ...m, parts: [...m.parts, { kind: "proposal", proposal: event.proposal }] }));
    case "error": {
      const next = withStreaming(state, (m) => ({ ...m, status: "error", error: { message: event.message, retryable: event.retryable } }));
      return { ...next, busy: false };
    }
    case "done": {
      const next = withStreaming(state, (m) => ({ ...m, status: "done" }));
      return { ...next, busy: false, usage: event.usage ?? state.usage };
    }
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const text = action.text.trim();
      if (!text || state.busy) return state;
      const userId = `m${state.nextId}`;
      const botId = `m${state.nextId + 1}`;
      return {
        ...state,
        busy: true,
        nextId: state.nextId + 2,
        lastAsked: text,
        messages: [...state.messages, { id: userId, role: "user", text }, { id: botId, role: "assistant", parts: [], status: "streaming" }],
      };
    }
    case "event":
      return applyEvent(state, action.event);
    case "finished": {
      const i = lastAnswerIndex(state.messages);
      const m = i >= 0 ? state.messages[i] : null;
      if (!m || m.role !== "assistant" || m.status !== "streaming") return { ...state, busy: false };
      // The stream ended without "done" or "error": the answer was cut short.
      const messages = state.messages.slice();
      messages[i] = { ...m, status: "error", error: { message: CUT_SHORT_MESSAGE, retryable: true } };
      return { ...state, busy: false, messages };
    }
    case "failed": {
      const next = withStreaming(state, (m) => ({ ...m, status: "error", error: { message: action.message, retryable: action.retryable } }));
      return { ...next, busy: false };
    }
    case "stopped": {
      const next = withStreaming(state, (m) => ({ ...m, status: "stopped" }));
      return { ...next, busy: false };
    }
    case "retry": {
      if (state.busy || !state.lastAsked) return state;
      const i = lastAnswerIndex(state.messages);
      const m = i >= 0 ? state.messages[i] : null;
      if (!m || m.role !== "assistant" || (m.status !== "error" && m.status !== "stopped")) return state;
      const messages = state.messages.slice();
      messages[i] = { id: `m${state.nextId}`, role: "assistant", parts: [], status: "streaming" };
      return { ...state, busy: true, nextId: state.nextId + 1, messages };
    }
    case "local_result": {
      const parts: AssistantPart[] = [{ kind: "tool", command: action.command, title: action.title, status: "done" }];
      if (action.text) parts.push({ kind: "text", text: action.text });
      parts.push({ kind: "result", command: action.command, title: action.title, data: action.data });
      return {
        ...state,
        nextId: state.nextId + 2,
        messages: [...state.messages, { id: `m${state.nextId}`, role: "user", text: action.asked }, { id: `m${state.nextId + 1}`, role: "assistant", parts, status: "done", local: true }],
      };
    }
    case "local_proposal":
      return {
        ...state,
        nextId: state.nextId + 2,
        messages: [
          ...state.messages,
          { id: `m${state.nextId}`, role: "user", text: action.asked },
          { id: `m${state.nextId + 1}`, role: "assistant", parts: [{ kind: "proposal", proposal: action.proposal }], status: "done", local: true },
        ],
      };
    case "reset":
      return state.busy ? state : { ...initialChatState, nextId: state.nextId };
  }
}

/** True when the newest answer failed or was stopped and nothing else is running, so "Try again" makes sense. */
export function canRetry(state: ChatState): boolean {
  if (state.busy || !state.lastAsked) return false;
  const i = lastAnswerIndex(state.messages);
  const m = i >= 0 ? state.messages[i] : null;
  return Boolean(m && m.role === "assistant" && (m.status === "error" || m.status === "stopped"));
}

/** True when the newest answer has nothing to show yet (the panel then shows "Niva is working"). */
export function isWaitingForFirstPart(state: ChatState): boolean {
  const i = lastAnswerIndex(state.messages);
  const m = i >= 0 ? state.messages[i] : null;
  return Boolean(m && m.role === "assistant" && m.status === "streaming" && m.parts.length === 0);
}
