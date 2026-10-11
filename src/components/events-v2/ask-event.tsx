"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";

import { useNiva } from "@/components/niva/niva-context";

/**
 * The board's "Ask about this event" box at the foot of Niva's column. It hands the question to Niva's own panel, which knows the
 * person is looking at this event (the route says so), and answers there with the person's own access.
 */
export function AskAboutEvent() {
  const niva = useNiva();
  const id = useId();
  const [text, setText] = useState("");
  const ready = !!niva && niva.enabled && niva.aiReady;

  function submit(e: FormEvent) {
    e.preventDefault();
    const asked = text.trim();
    if (!asked || !niva || !ready) return;
    niva.ask(asked);
    setText("");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Ask Niva about this event
      </label>
      <div className="flex min-h-[52px] items-center gap-2.5 rounded-[26px] border border-line-input bg-[#f3f7fb] py-1.5 pl-4 pr-2">
        <input
          id={id}
          value={text}
          disabled={!ready}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about this event"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!ready || !text.trim()}
          aria-label="Ask Niva"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink disabled:cursor-not-allowed disabled:opacity-70"
          style={{ background: "var(--v2-sun)" }}
        >
          <SendIcon />
        </button>
      </div>
      {!ready ? <Note>{niva && niva.enabled ? "Chat is not switched on yet. Niva's commands still work from the top bar." : "Niva's chat is not on for you here."}</Note> : null}
    </form>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="m-0 px-2 text-[12px] text-muted">{children}</p>;
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 11l18-8-8 18-2-8z" />
    </svg>
  );
}
