import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The panel's cards import the security-code window, which verifies a code through a server action; nothing is called here.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { KindProvider } from "@/components/kind-context";
import { AskNiva } from "@/components/niva/ask-niva";
import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { NivaDock } from "@/components/niva/niva-dock";
import { NivaTopButton } from "@/components/niva/niva-top-button";
import { chatReducer, initialChatState, type ChatAction } from "@/lib/assistant/chat-state";
import { LEGACY_KIND, NEUTRAL_KIND, type KindProfile } from "@/lib/kind";

import { sampleCommands, sampleProposal } from "./fake-server";

const noop = () => {};

function api(over: Partial<NivaApi> = {}): NivaApi {
  return {
    enabled: true,
    aiReady: true,
    commands: sampleCommands,
    nav: [],
    usage: { used: 3, limit: 200, month: "2026-10" },
    context: { path: "/giving/payments" },
    dockOpen: true,
    paletteOpen: false,
    paletteQuery: "",
    openDock: noop,
    closeDock: noop,
    toggleDock: noop,
    openPalette: noop,
    closePalette: noop,
    chat: initialChatState,
    send: noop,
    stop: noop,
    retry: noop,
    newChat: noop,
    ask: noop,
    showResult: noop,
    showProposal: noop,
    ...over,
  };
}

// A Jain Center unless a test says otherwise; `null` renders with no kind provided (the neutral kind is then assumed).
const withNiva = (value: NivaApi | null, child: ReturnType<typeof createElement>, kind: KindProfile | null = LEGACY_KIND) => {
  const inner = createElement(NivaContext.Provider, { value }, child);
  return renderToStaticMarkup(kind ? KindProvider({ kind, children: inner }) : inner);
};
const chatAfter = (actions: ChatAction[]) => actions.reduce(chatReducer, initialChatState);

describe("Niva is invisible unless the community switched it on", () => {
  it("renders nothing without the shell, or when disabled", () => {
    for (const value of [null, api({ enabled: false })]) {
      expect(withNiva(value, createElement(NivaDock))).toBe("");
      expect(withNiva(value, createElement(NivaTopButton))).toBe("");
      expect(withNiva(value, createElement(AskNiva, { prompt: "Who is behind on pledges?" }))).toBe("");
    }
  });

  it("the top bar button and an Ask Niva button appear when it is on", () => {
    expect(withNiva(api(), createElement(NivaTopButton))).toContain('aria-controls="niva-panel"');
    const ask = withNiva(api(), createElement(AskNiva, { prompt: "Who is behind on pledges?" }));
    expect(ask).toContain("Ask Niva");
    expect(ask).toContain("Who is behind on pledges?");
  });

  it("Ask Niva waits for chat: with no model key there is nothing to ask", () => {
    expect(withNiva(api({ aiReady: false }), createElement(AskNiva, { prompt: "x" }))).toBe("");
  });
});

describe("the panel", () => {
  it("speaks neutrally when no kind is given: no faith's words", () => {
    const html = withNiva(api(), createElement(NivaDock), null);
    expect(html).toContain("Who is behind on");
    expect(html).not.toMatch(/Pathshala|Jain|darshan|boli|derasar/i);
    expect(withNiva(api(), createElement(NivaDock), NEUTRAL_KIND)).toBe(html);
  });

  it("opens on three examples for the screen, and what Niva is looking at", () => {
    const html = withNiva(api(), createElement(NivaDock));
    expect(html).toContain('id="niva-panel"');
    expect(html).toContain('aria-label="Close Niva"');
    expect(html).toContain("Looking at Giving");
    expect(html).toContain("Who is behind on pledges?");
    expect(html).toContain("What is blocking month-end close?");
    expect(html).toContain("3 of 200 questions used this month.");
    expect(html).toContain("Nothing changes until you press a button.");
  });

  it("is hidden (not removed) while closed, so the conversation is kept", () => {
    const html = withNiva(api({ dockOpen: false }), createElement(NivaDock));
    expect(html).toContain('class="hidden ');
  });

  it("says 'this event' on an event page", () => {
    const html = withNiva(api({ context: { path: "/events/[id]", entityKind: "event", entityId: "e1" } }), createElement(NivaDock));
    expect(html).toContain("Looking at this event");
    expect(html).toContain("Draft a reminder for this event in every language we use");
  });

  it("without a model key it says so plainly and still offers the commands", () => {
    const html = withNiva(api({ aiReady: false }), createElement(NivaDock));
    expect(html).toContain("Chat is not switched on yet.");
    expect(html).toContain("Show who is behind on pledges");
    expect(html).toContain("See all commands");
    expect(html).toMatch(/<textarea[^>]*disabled/);
  });

  it("shows the conversation: the question, a tool chip, a result card and the answer", () => {
    const chat = chatAfter([
      { type: "send", text: "Who is behind on pledges?" },
      { type: "event", event: { type: "tool", command: "giving.pledges_behind", title: "Show who is behind on pledges", status: "done" } },
      { type: "event", event: { type: "result", command: "giving.pledges_behind", title: "Behind on pledges", data: { households_behind: 2 } } },
      { type: "event", event: { type: "text", text: "Two households are behind." } },
      { type: "event", event: { type: "done" } },
    ]);
    const html = withNiva(api({ chat }), createElement(NivaDock));
    expect(html).toContain("Who is behind on pledges?");
    expect(html).toContain("Show who is behind on pledges");
    expect(html).toContain("done");
    expect(html).toContain("Households behind");
    expect(html).toContain("Two households are behind.");
    expect(html).toContain('role="log"');
  });

  it("shows the working state while the first part is awaited, with a Stop button", () => {
    const chat = chatAfter([{ type: "send", text: "hi" }]);
    const html = withNiva(api({ chat }), createElement(NivaDock));
    expect(html).toContain("Niva is working…");
    expect(html).toContain(">Stop<");
    expect(html).toContain('aria-busy="true"');
  });

  it("shows an error in plain English with Try again only when it can be retried", () => {
    const retryable = chatAfter([{ type: "send", text: "hi" }, { type: "event", event: { type: "error", message: "Niva could not finish this one.", retryable: true } }]);
    const html = withNiva(api({ chat: retryable }), createElement(NivaDock));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Niva could not finish this one.");
    expect(html).toContain(">Try again<");
    const fixed = chatAfter([{ type: "send", text: "hi" }, { type: "event", event: { type: "error", message: "You don't have access to this area.", retryable: false } }]);
    expect(withNiva(api({ chat: fixed }), createElement(NivaDock))).not.toContain(">Try again<");
  });

  it("puts a confirmation card in the conversation, with no security-code field anywhere", () => {
    const chat = chatAfter([
      { type: "send", text: "Change the venue" },
      { type: "event", event: { type: "proposal", proposal: sampleProposal({ expiresAt: "2999-01-01T00:00:00.000Z" }) } },
      { type: "event", event: { type: "done" } },
    ]);
    const html = withNiva(api({ chat }), createElement(NivaDock));
    expect(html).toContain("Needs your OK");
    expect(html).toContain("Change the venue");
    expect(html).toContain("Rahul Shah, Mira Shah");
    expect(html).not.toContain("Kid Shah");
    expect(html).not.toMatch(/autocomplete="one-time-code"/);
    expect(html).not.toMatch(/6-digit/i);
  });

  it("a palette result kept in the panel appears like an answer", () => {
    const chat = chatAfter([{ type: "local_result", asked: "Show my tasks", command: "tasks.mine", title: "My tasks", data: { count: 2 } }]);
    const html = withNiva(api({ chat, aiReady: false }), createElement(NivaDock));
    expect(html).toContain("Show my tasks");
    expect(html).toContain("Count");
  });
});
