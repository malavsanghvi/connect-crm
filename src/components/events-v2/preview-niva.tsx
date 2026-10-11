"use client";

import type { ReactNode } from "react";

import { NivaContext, type NivaApi } from "@/components/niva/niva-context";
import { initialChatState } from "@/lib/assistant/chat-state";

const noop = () => {};

/**
 * DEV PREVIEW ONLY (src/app/dev/admin-events): Niva switched on with chat, so the page's Niva parts draw as the board shows them.
 * Every button here does nothing; there is no server behind the preview.
 */
export function PreviewNiva({ children }: { children: ReactNode }) {
  const value: NivaApi = {
    enabled: true,
    aiReady: true,
    commands: [],
    nav: [],
    context: { path: "/events/[id]", entityKind: "event" },
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
