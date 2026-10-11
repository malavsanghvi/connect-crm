"use client";

import type { ReactNode } from "react";

import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { initialChatState } from "@/lib/assistant/chat-state";

const noop = () => {};

/**
 * DEV ONLY. Niva's shared state with nothing behind it, so the preview shows the page as it looks when Niva is switched on (or off)
 * without a session or a model. Every button that would ask Niva does nothing here.
 */
export function PreviewNiva({ enabled, mergeTicked, children }: { enabled: boolean; mergeTicked: boolean; children: ReactNode }) {
  const value: NivaApi = {
    enabled,
    aiReady: enabled,
    commands: mergeTicked
      ? [
          { key: "people.merge_households", title: "Merge two households", description: "", level: "confirm", area: "people", fields: [] },
          { key: "people.merge_people", title: "Merge two people", description: "", level: "confirm", area: "people", fields: [] },
        ]
      : [],
    nav: [],
    context: { path: "/people" },
    dockOpen: false,
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
  };
  return <NivaContext.Provider value={value}>{children}</NivaContext.Provider>;
}
