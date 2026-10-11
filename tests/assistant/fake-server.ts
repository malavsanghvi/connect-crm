// A tiny stand-in for /api/assistant/** used only by these tests: it answers like the real routes would (protocol.ts), including
// a chat answer that arrives in pieces of any size. Nothing here ships.

import type { FetchLike } from "@/lib/assistant/client";
import type { ChatEvent, CommandInfo, CommandsResponse, ProposalCard } from "@/lib/assistant/protocol";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** One JSON object per line, as the chat route writes them. */
export const ndjsonText = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** A streamed body that delivers `text` in the given piece sizes (so a line can be cut anywhere, even inside a character). */
export function streamed(text: string, sizes: number[]): Response {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      const size = sizes[i % sizes.length];
      i += 1;
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

export type Call = { url: string; method: string; body: unknown };

export type Handler = (call: Call, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that routes by URL and remembers every call. An unknown URL is a 404, like a route that is not deployed. */
export function fakeFetch(handlers: Record<string, Handler>): FetchLike & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string, init?: RequestInit) => {
    const call: Call = { url: input, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const handler = handlers[input];
    if (!handler) return json({ ok: false, error: "Not found" }, 404);
    return handler(call, init);
  }) as FetchLike & { calls: Call[] };
  f.calls = calls;
  return f;
}

export const sampleCommands: CommandInfo[] = [
  { key: "people.search", title: "Search people and households", description: "Find a household by name, phone or number.", level: "read", area: "people", fields: [{ name: "query", label: "Name, phone or number", type: "text", required: true }] },
  { key: "tasks.mine", title: "Show my tasks", description: "What is waiting for you.", level: "read", area: "tasks", fields: [] },
  { key: "giving.pledges_behind", title: "Show who is behind on pledges", description: "Households with pledges past their due date.", level: "read", area: "giving", fields: [{ name: "min_days_overdue", label: "Days overdue", type: "number", required: false }] },
  { key: "accounting.month_close_blockers", title: "Show what is blocking month-end close", description: "Checks that are not done yet.", level: "read", area: "accounting", fields: [] },
  { key: "events.upcoming", title: "Show upcoming events", description: "The next events by date.", level: "read", area: "events", fields: [] },
  { key: "messages.draft_reminder", title: "Draft an event reminder", description: "A reminder in English, Gujarati and Hindi. Nothing is sent.", level: "draft", area: "messages", fields: [{ name: "event", label: "Event", type: "text", required: true }] },
  { key: "events.set_field", title: "Change a detail of an event", description: "Change the venue, time or capacity.", level: "confirm", area: "events", fields: [{ name: "field", label: "What to change", type: "choice", required: true, choices: ["venue", "capacity"] }, { name: "value", label: "New value", type: "text", required: true }] },
];

export const commandsOn = (over: Partial<CommandsResponse> = {}): CommandsResponse => ({
  ok: true,
  enabled: true,
  aiReady: true,
  commands: sampleCommands,
  usage: { used: 3, limit: 200, month: "2026-10" },
  ...over,
});

export const sampleProposal = (over: Partial<ProposalCard> = {}): ProposalCard => ({
  id: "p1",
  command: "events.set_field",
  title: "Change the event's venue",
  lines: ["The venue of Diwali Dinner changes from Hall A to Main Hall.", "Nobody is emailed."],
  cards: [
    {
      household_id: "h1",
      household_name: "Shah household",
      household_number: "H-1042",
      org_household_id: "JSH-77",
      adults: ["Rahul Shah", "Mira Shah"],
      primary_adult: "Rahul Shah",
      zone: "East",
      city: "Edison",
      last_gift_on: "2026-09-14",
      open_pledge: "$250.00",
      // A child must never be shown even if one were sent by mistake.
      children: ["Kid Shah"],
      members: "Rahul Shah, Mira Shah, Kid Shah",
    },
  ],
  confirmText: "Change the venue",
  inputHash: "hash-1",
  expiresAt: "2026-10-10T12:15:00.000Z",
  ...over,
});

export const textEvent = (text: string): ChatEvent => ({ type: "text", text });
