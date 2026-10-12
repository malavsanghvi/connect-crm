"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { FindBackendContext } from "@/components/people-v2/find/find-backend";
import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { initialChatState } from "@/lib/assistant/chat-state";

import { fixtureSearch, type PreviewMode } from "./fixtures";

const noop = () => {};

/**
 * DEV ONLY. Gives the find box a lookup over invented data instead of the server, and Niva's shared state with nothing behind it
 * (on, off, or on without a model key), so every state can be seen and screenshotted without a session. Anything handed to Niva is
 * shown in a line at the bottom of the page, so the hand-off can be checked. `type` is typed into the box (the page's big one, or the
 * top bar's) a moment after the page loads, the way a person would.
 */
export function PreviewFind({ mode, niva, type, into, children }: { mode: PreviewMode; niva: "on" | "off" | "nokey"; type: string | null; into: "page" | "bar"; children: ReactNode }) {
  const [asked, setAsked] = useState<string | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  const search = useMemo(() => async (q: string) => fixtureSearch(q, mode), [mode]);

  useEffect(() => {
    if (!type) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>(into === "bar" ? "[data-find-bar] input" : 'section[aria-label="Find a family or a person"] input');
      if (!el) return;
      el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(el, type);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, 400);
    return () => clearTimeout(t);
  }, [type, into]);

  const api: NivaApi = {
    enabled: niva !== "off",
    aiReady: niva === "on",
    commands: [],
    nav: [],
    context: { path: "/people" },
    dockOpen: false,
    paletteOpen: false,
    paletteQuery: "",
    openDock: noop,
    closeDock: noop,
    toggleDock: noop,
    openPalette: (q) => setPalette(q ?? ""),
    closePalette: noop,
    chat: initialChatState,
    send: noop,
    stop: noop,
    retry: noop,
    newChat: noop,
    ask: (text) => setAsked(text),
    showResult: noop,
    showProposal: noop,
  };
  return (
    <FindBackendContext.Provider value={search}>
      <NivaContext.Provider value={api}>
        {children}
        {asked !== null ? (
          <p role="status" className="fixed bottom-20 left-1/2 z-[60] m-0 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-[13px] text-white">
            Preview: Niva was asked “{asked}” (nothing else was sent).
          </p>
        ) : null}
        {palette !== null ? (
          <p role="status" className="fixed bottom-20 left-1/2 z-[60] m-0 -translate-x-1/2 rounded-xl bg-ink px-4 py-2 text-[13px] text-white">
            Preview: the command palette would open with “{palette}”.
          </p>
        ) : null}
      </NivaContext.Provider>
    </FindBackendContext.Provider>
  );
}
