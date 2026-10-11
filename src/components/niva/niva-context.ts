"use client";

import { createContext, useContext } from "react";

import type { ChatState } from "@/lib/assistant/chat-state";
import type { NavEntry } from "@/lib/assistant/palette";
import type { RouteContext } from "@/lib/assistant/context";
import type { CommandInfo, ProposalCard } from "@/lib/assistant/protocol";

/** What every part of Niva's interface shares. Everything here is inert (and `enabled` is false) until the server says Niva is on. */
export type NivaApi = {
  /** The community has switched Niva for admins on and the person may use it. Nothing renders when this is false. */
  enabled: boolean;
  /** A model key is available. The palette works without one. */
  aiReady: boolean;
  commands: CommandInfo[];
  nav: NavEntry[];
  usage?: { used: number; limit: number | null; month: string };
  /** Where the person is, as it is sent with a question. */
  context: RouteContext;

  dockOpen: boolean;
  paletteOpen: boolean;
  /** What the palette starts with in its search box (a command's title, when it was opened from the panel). */
  paletteQuery: string;
  openDock: () => void;
  closeDock: () => void;
  toggleDock: () => void;
  openPalette: (query?: string) => void;
  closePalette: () => void;

  chat: ChatState;
  /** Ask a question. Does nothing while an answer is arriving. */
  send: (text: string) => void;
  stop: () => void;
  retry: () => void;
  newChat: () => void;
  /** Open the panel and ask (used by "Ask Niva" buttons on other screens). */
  ask: (prompt: string) => void;
  /** A palette command's result, kept in the panel. */
  showResult: (args: { asked: string; command: string; title: string; data: unknown; text?: string }) => void;
  /** A palette command's proposal, shown in the panel as a confirmation card. */
  showProposal: (args: { asked: string; proposal: ProposalCard }) => void;
};

export const NivaContext = createContext<NivaApi | null>(null);

/** The shared state, or null outside the portal shell (then nothing of Niva shows). */
export function useNiva(): NivaApi | null {
  return useContext(NivaContext);
}
