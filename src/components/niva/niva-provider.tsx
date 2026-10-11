"use client";

import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import { canRetry, chatReducer, initialChatState } from "@/lib/assistant/chat-state";
import { browserFetch, ChatStreamError, getCommandsOnce, streamChat } from "@/lib/assistant/client";
import { safeRouteContext } from "@/lib/assistant/context";
import { COMMANDS_LOADING, commandsGate, type CommandsState } from "@/lib/assistant/gate";
import { nivaSwitchedOffHere } from "@/lib/assistant/kill-switch";
import type { NavEntry } from "@/lib/assistant/palette";
import { attachShortcuts } from "@/lib/assistant/shortcuts";

import { CommandPalette } from "./command-palette";
import { otherDialogOpen } from "./focus";
import { NivaBoundary } from "./niva-boundary";
import { NivaContext, type NivaApi } from "./niva-context";

const NO_REACH = "Could not reach Niva — the server did not respond. Try again.";

/**
 * Niva for admins, once, for the whole portal. It asks the server once per page load whether Niva is switched on for this
 * community; if the answer is no, or anything goes wrong, nothing of Niva appears and the page works as before.
 *
 * Safe by construction, because every staff page renders inside it: nothing here can throw while rendering (the route is read
 * through safeRouteContext), every request and every listener is set up in an effect inside try/catch, and until the server says
 * "enabled" the state is "not enabled": the children are rendered exactly as they were, no shortcut is registered, nothing shows.
 * A browser with localStorage "niva.off" = "1" never even asks.
 */
export function NivaProvider({ nav, children }: { nav: NavEntry[]; children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const context = useMemo(() => safeRouteContext(pathname, params), [pathname, params]);

  const [commands, setCommands] = useState<CommandsState>(COMMANDS_LOADING);
  const [dockOpen, setDockOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [chat, dispatch] = useReducer(chatReducer, initialChatState);

  const chatRef = useRef(chat);
  const contextRef = useRef(context);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    chatRef.current = chat;
    contextRef.current = context;
  });

  useEffect(() => {
    let alive = true;
    try {
      // The kill switch: a browser told to hide Niva does not even ask the server (the state stays "loading", which shows nothing).
      if (!nivaSwitchedOffHere()) {
        getCommandsOnce(browserFetch).then(
          (data) => {
            if (alive) setCommands(commandsGate(data));
          },
          () => {
            if (alive) setCommands(commandsGate(null));
          },
        );
      }
    } catch (error) {
      console.error("[niva] could not ask whether Niva is on; it stays hidden:", error);
    }
    return () => {
      alive = false;
    };
  }, []);

  const enabled = commands.status === "on";
  const aiReady = commands.status === "on" && commands.data.aiReady;

  // The chat stream. One at a time; a new question while one is arriving is ignored.
  const run = useCallback(async (text: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        browserFetch,
        { message: text, threadId: chatRef.current.threadId, context: contextRef.current },
        (event) => dispatch({ type: "event", event }),
        controller.signal,
      );
      if (!controller.signal.aborted) dispatch({ type: "finished" });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch(
        error instanceof ChatStreamError
          ? { type: "failed", message: error.message, retryable: error.retryable }
          : { type: "failed", message: NO_REACH, retryable: true },
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const asked = text.trim();
      if (!asked || abortRef.current || chatRef.current.busy) return;
      dispatch({ type: "send", text: asked });
      void run(asked);
    },
    [run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "stopped" });
  }, []);

  const retry = useCallback(() => {
    const asked = chatRef.current.lastAsked;
    if (!asked || abortRef.current || !canRetry(chatRef.current)) return;
    dispatch({ type: "retry" });
    void run(asked);
  }, [run]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "stopped" });
    dispatch({ type: "reset" });
  }, []);

  const openDock = useCallback(() => setDockOpen(true), []);
  const closeDock = useCallback(() => setDockOpen(false), []);
  const toggleDock = useCallback(() => setDockOpen((o) => !o), []);
  const openPalette = useCallback((query = "") => {
    setPaletteQuery(query);
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const ask = useCallback(
    (prompt: string) => {
      setPaletteOpen(false);
      setDockOpen(true);
      if (aiReady) send(prompt);
    },
    [aiReady, send],
  );

  const showResult = useCallback<NivaApi["showResult"]>((args) => {
    dispatch({ type: "local_result", ...args });
    setPaletteOpen(false);
    setDockOpen(true);
  }, []);
  const showProposal = useCallback<NivaApi["showProposal"]>((args) => {
    dispatch({ type: "local_proposal", ...args });
    setPaletteOpen(false);
    setDockOpen(true);
  }, []);

  // ⌘K and ⌘J, only while Niva is on, and never over the security-code window.
  useEffect(() => {
    try {
      return attachShortcuts(
        document,
        enabled,
        (which) => {
          if (which === "palette") {
            setPaletteQuery("");
            setPaletteOpen((o) => !o);
          } else {
            setPaletteOpen(false);
            setDockOpen((o) => !o);
          }
        },
        otherDialogOpen,
      );
    } catch (error) {
      console.error("[niva] could not register the keyboard shortcuts:", error);
      return undefined;
    }
  }, [enabled]);

  const value = useMemo<NivaApi>(
    () => ({
      enabled,
      aiReady,
      commands: commands.status === "on" ? commands.data.commands : [],
      nav,
      usage: commands.status === "on" ? commands.data.usage : undefined,
      community: commands.status === "on" ? commands.data.community : undefined,
      context,
      dockOpen,
      paletteOpen,
      paletteQuery,
      openDock,
      closeDock,
      toggleDock,
      openPalette,
      closePalette,
      chat,
      send,
      stop,
      retry,
      newChat,
      ask,
      showResult,
      showProposal,
    }),
    [enabled, aiReady, commands, nav, context, dockOpen, paletteOpen, chat, send, stop, retry, newChat, ask, showResult, showProposal, paletteQuery, openDock, closeDock, toggleDock, openPalette, closePalette],
  );

  return <NivaScope value={value}>{children}</NivaScope>;
}

/**
 * What the provider renders: the children, untouched and in the same place whether Niva is on or off (so switching on never
 * remounts the page), plus the command list only when on, in its own boundary.
 */
export function NivaScope({ value, children }: { value: NivaApi; children: ReactNode }) {
  return (
    <NivaContext.Provider value={value}>
      {children}
      {value.enabled ? (
        <NivaBoundary name="command list">
          <CommandPalette />
        </NivaBoundary>
      ) : null}
    </NivaContext.Provider>
  );
}
