"use client";

import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";

import { canRetry, chatReducer, initialChatState } from "@/lib/assistant/chat-state";
import { browserFetch, ChatStreamError, getCommandsOnce, streamChat } from "@/lib/assistant/client";
import { routeContext } from "@/lib/assistant/context";
import type { NavEntry } from "@/lib/assistant/palette";
import type { CommandsResponse } from "@/lib/assistant/protocol";
import { shortcutFor } from "@/lib/assistant/shortcuts";

import { CommandPalette } from "./command-palette";
import { otherDialogOpen } from "./focus";
import { NivaContext, type NivaApi } from "./niva-context";

type CommandsState = { status: "loading" } | { status: "off" } | { status: "on"; data: CommandsResponse };

const NO_REACH = "Could not reach Niva — the server did not respond. Try again.";

/**
 * Niva for admins, once, for the whole portal. It asks the server once per page load whether Niva is switched on for this
 * community; if the answer is no, or anything goes wrong, nothing of Niva appears and the page works as before.
 */
export function NivaProvider({ nav, children }: { nav: NavEntry[]; children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const context = useMemo(() => routeContext(pathname ?? "/", params), [pathname, params]);

  const [commands, setCommands] = useState<CommandsState>({ status: "loading" });
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
    void getCommandsOnce(browserFetch).then((data) => {
      if (alive) setCommands(data && data.enabled ? { status: "on", data } : { status: "off" });
    });
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
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      const which = shortcutFor(e);
      if (!which || otherDialogOpen()) return;
      e.preventDefault();
      if (which === "palette") {
        setPaletteQuery("");
        setPaletteOpen((o) => !o);
      } else {
        setPaletteOpen(false);
        setDockOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);

  const value = useMemo<NivaApi>(
    () => ({
      enabled,
      aiReady,
      commands: commands.status === "on" ? commands.data.commands : [],
      nav,
      usage: commands.status === "on" ? commands.data.usage : undefined,
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

  return (
    <NivaContext.Provider value={value}>
      {children}
      {enabled ? <CommandPalette /> : null}
    </NivaContext.Provider>
  );
}
