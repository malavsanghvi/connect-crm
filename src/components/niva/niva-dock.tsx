"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from "react";

import { AiOffNote } from "@/components/ai-off-note";
import { useKind } from "@/components/kind-context";
import { buttonClass } from "@/components/ui";
import { isWaitingForFirstPart, type AssistantPart, type ChatMessage } from "@/lib/assistant/chat-state";
import { contextLine, suggestionsFor } from "@/lib/assistant/context";
import { areaLabel } from "@/lib/assistant/palette";

import { otherDialogOpen, trapTab } from "./focus";
import { type NivaApi, useNiva } from "./niva-context";
import { ProposalCard } from "./proposal-card";
import { ResultCards } from "./result-cards";
import { Sparkle } from "./sparkle";
import { useModKey } from "./use-mod-key";

const PHONE_QUERY = "(max-width: 767px)";
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/**
 * Niva's side panel. It sits beside the work (on a wide screen it takes its own column; on a medium one it slides over the right
 * edge; on a phone it is a full-height sheet). It renders nothing unless Niva is switched on for this community.
 */
export function NivaDock() {
  const niva = useNiva();
  if (!niva || !niva.enabled) return null;
  return <Dock niva={niva} />;
}

function Dock({ niva }: { niva: NivaApi }) {
  const { dockOpen: open, chat, aiReady } = niva;
  const phone = useIsPhone();
  const modKey = useModKey();
  const titleId = useId();
  const inputId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [draft, setDraft] = useState("");

  // Open: move focus in. Close: give it back to whatever had it.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const input = inputRef.current;
    (input && !input.disabled ? input : closeRef.current)?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // A phone sheet covers the page: stop the page behind it from scrolling.
  useEffect(() => {
    if (!open || !phone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, phone]);

  // Follow the answer as it arrives, unless the person scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, open]);

  function onScroll() {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && !otherDialogOpen()) {
      e.stopPropagation();
      niva.closeDock();
      return;
    }
    // Beside the work (wide screens) the panel is not modal; as a phone sheet it is, so Tab stays inside it.
    if (phone) trapTab(e, panelRef.current);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !aiReady || chat.busy) return;
    stick.current = true;
    niva.send(text);
    setDraft("");
  }

  const kind = useKind();
  const suggestions = suggestionsFor(niva.context.path, niva.context.entityKind, new Set(niva.commands.map((c) => c.key)), {
    kind,
    modulesOff: niva.community?.modulesOff,
    currency: niva.community?.currency,
    locale: niva.community?.locale,
    paymentPlugins: niva.community?.paymentPlugins,
    communitySlug: niva.community?.slug,
  });
  const lookCommands = niva.commands.filter((c) => c.level === "read" || c.level === "draft").slice(0, 5);
  const used = chat.usage ?? niva.usage;
  const usage = used && used.limit !== null ? `${used.used} of ${used.limit} questions used this month.` : "";
  const lastAnswerId = [...chat.messages].reverse().find((m) => m.role === "assistant" && !m.local)?.id;

  return (
    <aside
      id="niva-panel"
      ref={panelRef}
      role={phone ? "dialog" : "complementary"}
      aria-modal={phone && open ? true : undefined}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={`${open ? "flex" : "hidden"} fixed inset-0 z-40 flex-col bg-white md:inset-auto md:bottom-0 md:right-0 md:top-[60px] md:w-[400px] md:max-w-full md:border-l md:border-line md:shadow-[var(--shadow-sheet)] xl:sticky xl:bottom-auto xl:right-auto xl:top-[60px] xl:z-10 xl:h-[calc(100vh-60px)] xl:shrink-0 xl:self-start xl:shadow-none`}
    >
      <header className="flex items-start gap-2 border-b border-line-soft px-4 py-3">
        <span className="mt-1 text-saffron">
          <Sparkle className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-[20px] font-semibold leading-tight text-ink">
            Niva
          </h2>
          <p className="truncate text-xs text-muted">{contextLine(niva.context, kind)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {chat.messages.length > 0 ? (
            <button type="button" onClick={niva.newChat} className={buttonClass("ghost", "xs")}>
              New chat
            </button>
          ) : null}
          <button type="button" onClick={() => niva.openPalette()} className={buttonClass("ghost", "xs")} title={`Commands (${modKey}+K)`}>
            Commands
          </button>
          <button type="button" ref={closeRef} onClick={niva.closeDock} aria-label="Close Niva" className="cc-drawer-close">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation with Niva"
        aria-live="polite"
        aria-busy={chat.busy}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
      >
        {chat.messages.length === 0 ? (
          <Welcome niva={niva} modKey={modKey} suggestions={suggestions} lookCommands={lookCommands.map((c) => ({ key: c.key, title: c.title, area: c.area }))} />
        ) : (
          chat.messages.map((m) => (
            <Message key={m.id} message={m} isLastAnswer={m.id === lastAnswerId} niva={niva} phone={phone} waiting={m.id === lastAnswerId && isWaitingForFirstPart(chat)} />
          ))
        )}
      </div>

      <form onSubmit={submit} className="border-t border-line-soft px-4 py-3">
        <label htmlFor={inputId} className="sr-only">
          Ask Niva
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            ref={inputRef}
            rows={2}
            value={draft}
            disabled={!aiReady}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={aiReady ? "Ask Niva…" : niva.aiOff ? "Chat is part of iWeaver" : "Chat is not switched on yet"}
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line-input bg-white px-3 py-2 text-[13px] text-ink disabled:bg-canvas disabled:text-faint"
          />
          {chat.busy ? (
            <button type="button" onClick={niva.stop} className={buttonClass("ghost", "sm")}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!aiReady || !draft.trim()} className={`${buttonClass("primary", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
              Send
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Niva works with your own access. Nothing changes until you press a button. {usage}
        </p>
      </form>
    </aside>
  );
}

function Welcome({
  niva,
  modKey,
  suggestions,
  lookCommands,
}: {
  niva: NivaApi;
  modKey: string;
  suggestions: string[];
  lookCommands: { key: string; title: string; area: string }[];
}) {
  return (
    <div className="flex flex-col gap-3 text-[13px] text-ink">
      <p className="leading-relaxed">
        Ask Niva to look something up, prepare something, or get a change ready for your OK. You always see what will happen first.
      </p>
      {niva.aiReady && suggestions.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-muted">Ask Niva</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => niva.send(s)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-left text-[13px] text-ink hover:border-navy"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {niva.aiOff ? <AiOffNote stillWorks="Niva can't answer questions in words here, but the commands below still work." /> : null}
      {!niva.aiReady && !niva.aiOff ? (
        <div role="status" className="rounded-xl border border-saffron-200 bg-saffron-50 px-3 py-2.5 text-brown-900">
          <p className="font-semibold">Chat is not switched on yet.</p>
          <p className="mt-0.5">Niva cannot answer questions in words here, but the commands below still work and need no setup.</p>
        </div>
      ) : null}
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.04em] text-muted">Commands that always work</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {lookCommands.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => niva.openPalette(c.title)}
                className="flex w-full items-baseline justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left text-[13px] text-ink hover:border-navy"
              >
                <span>{c.title}</span>
                <span className="shrink-0 text-xs text-muted">{areaLabel(c.area)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => niva.openPalette()} className={`${buttonClass("ghost", "sm")} mt-2`}>
          See all commands ({modKey}+K)
        </button>
      </div>
    </div>
  );
}

function Message({ message, isLastAnswer, waiting, phone, niva }: { message: ChatMessage; isLastAnswer: boolean; waiting: boolean; phone: boolean; niva: NivaApi }) {
  if (message.role === "user") {
    return <div className="ml-8 self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-navy px-3 py-2 text-[13px] text-white">{message.text}</div>;
  }
  return (
    <div className="flex flex-col items-stretch gap-2">
      {message.parts.map((part, i) => (
        <Part key={i} part={part} onNavigate={phone ? niva.closeDock : undefined} />
      ))}
      {waiting ? (
        <p className="flex items-center gap-2 text-xs text-muted" role="status">
          <span className="h-2 w-2 rounded-full bg-saffron motion-safe:animate-pulse" aria-hidden="true" />
          Niva is working…
        </p>
      ) : null}
      {message.status === "stopped" ? (
        <p className="text-xs text-muted">
          Stopped.{" "}
          {isLastAnswer ? (
            <button type="button" onClick={niva.retry} className="crm-link font-semibold">
              Ask again
            </button>
          ) : null}
        </p>
      ) : null}
      {message.status === "error" && message.error ? (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          <p>{message.error.message}</p>
          {message.error.retryable && isLastAnswer ? (
            <button type="button" onClick={niva.retry} className={`${buttonClass("bad", "xs")} mt-2`}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const TOOL_WORD = { running: "working", done: "done", failed: "did not work" } as const;

function Part({ part, onNavigate }: { part: AssistantPart; onNavigate?: () => void }) {
  switch (part.kind) {
    case "text":
      return <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{part.text}</p>;
    case "tool":
      return (
        <p className="m-0 inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-ground px-2.5 py-1 text-xs text-ink-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${part.status === "running" ? "bg-saffron motion-safe:animate-pulse" : part.status === "done" ? "bg-success" : "bg-danger"}`}
          />
          <span>{part.title}</span>
          <span className={part.status === "failed" ? "text-danger" : "text-muted"}>· {TOOL_WORD[part.status]}</span>
        </p>
      );
    case "result":
      return <ResultCards title={part.title} data={part.data} onNavigate={onNavigate} />;
    case "proposal":
      return <ProposalCard key={part.proposal.id} proposal={part.proposal} />;
  }
}
