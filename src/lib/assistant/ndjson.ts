// Reading the chat stream: one JSON object per line (NDJSON), arriving in pieces of any size. Pure, so the panel and the tests share it.
// A line that is not JSON, or not a ChatEvent we know, is counted and skipped; it never breaks the answer that is still arriving.

import { parseTokens } from "@/lib/anthropic-cache";

import type { ChatEvent, ProposalCard } from "./protocol";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

/** A proposal as the card needs it. Anything missing that the card cannot do without makes the whole proposal unusable (null). */
export function parseProposal(value: unknown): ProposalCard | null {
  if (!isObject(value)) return null;
  const { id, command, title, lines, cards, confirmText, inputHash, expiresAt } = value;
  if (!isString(id) || !isString(command) || !isString(title) || !isString(confirmText) || !isString(inputHash) || !isString(expiresAt)) return null;
  if (!id || !inputHash) return null;
  return {
    id,
    command,
    title,
    lines: Array.isArray(lines) ? lines.filter(isString) : [],
    cards: Array.isArray(cards) ? cards : undefined,
    confirmText: confirmText || "Confirm",
    inputHash,
    expiresAt,
  };
}

/** Checks one decoded line against the protocol. Returns null for anything that is not a ChatEvent we can show. */
export function parseChatEvent(value: unknown): ChatEvent | null {
  if (!isObject(value)) return null;
  switch (value.type) {
    case "thread":
      return isString(value.threadId) && value.threadId ? { type: "thread", threadId: value.threadId } : null;
    case "text":
      return isString(value.text) ? { type: "text", text: value.text } : null;
    case "tool": {
      const status = value.status;
      if (!isString(value.command) || !isString(value.title)) return null;
      if (status !== "running" && status !== "done" && status !== "failed") return null;
      return { type: "tool", command: value.command, title: value.title, status };
    }
    case "result":
      return isString(value.command) && isString(value.title) && "data" in value ? { type: "result", command: value.command, title: value.title, data: value.data } : null;
    case "proposal": {
      const proposal = parseProposal(value.proposal);
      return proposal ? { type: "proposal", proposal } : null;
    }
    case "error":
      return isString(value.message) ? { type: "error", message: value.message, retryable: value.retryable === true } : null;
    case "done": {
      const u = value.usage;
      const tokens = parseTokens(value.tokens);
      return {
        type: "done",
        ...(isObject(u) && typeof u.used === "number" && (typeof u.limit === "number" || u.limit === null) ? { usage: { used: u.used, limit: u.limit } } : {}),
        ...(tokens ? { tokens } : {}),
      };
    }
    default:
      return null;
  }
}

/** Parses ONE line. Returns the event, or null when the line is blank (`blank`) or unusable (`bad`). */
export function parseNdjsonLine(line: string): { event: ChatEvent } | { blank: true } | { bad: true } {
  const text = line.trim();
  if (!text) return { blank: true };
  try {
    const event = parseChatEvent(JSON.parse(text));
    return event ? { event } : { bad: true };
  } catch {
    return { bad: true };
  }
}

export type NdjsonParser = {
  /** Feed the next piece of the stream; returns the events completed by it. A half line waits for the next piece. */
  push(chunk: string): ChatEvent[];
  /** The stream ended: parse whatever is left (a last line with no newline). */
  end(): ChatEvent[];
  /** Lines that were skipped because they were not usable. */
  readonly badLines: number;
};

export function createNdjsonParser(): NdjsonParser {
  let buffer = "";
  let bad = 0;
  const take = (lines: string[]): ChatEvent[] => {
    const out: ChatEvent[] = [];
    for (const line of lines) {
      const parsed = parseNdjsonLine(line);
      if ("event" in parsed) out.push(parsed.event);
      else if ("bad" in parsed) bad += 1;
    }
    return out;
  };
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      return take(lines);
    },
    end() {
      const rest = buffer;
      buffer = "";
      return take(rest ? [rest] : []);
    },
    get badLines() {
      return bad;
    },
  };
}
