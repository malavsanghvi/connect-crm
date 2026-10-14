"use client";

import { useId, useState, type FormEvent } from "react";

import { GlobalSearch } from "@/components/shell/global-search";
import { Sparkle } from "@/components/niva/sparkle";
import { useNiva } from "@/components/niva/niva-context";
import { buttonClass } from "@/components/ui";
import { AI_OFF } from "@/lib/ai-gate";

/**
 * Today's one box. When Niva is on, it takes anything: Enter opens Niva beside the work and asks it. When Niva is off (or has not
 * answered yet) the same place holds the portal's search for households and people, so the box is never an empty promise.
 *
 * The sentence typed here is sent to Niva exactly as typed; Niva's own rules keep anything about children out (D2).
 */
export function AskBox() {
  const niva = useNiva();
  const [text, setText] = useState("");
  const id = useId();

  if (!niva || !niva.enabled) {
    return (
      <div className="mb-4" data-testid="today-search">
        <GlobalSearch />
      </div>
    );
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const asked = text.trim();
    if (!asked || !niva) return;
    // Without a model key the panel cannot answer, but its command search still works: start it with the words.
    if (niva.aiReady) niva.ask(asked);
    else niva.openPalette(asked);
    setText("");
  }

  return (
    <form onSubmit={submit} className="mb-4" aria-label="Ask Niva" data-testid="today-ask">
      <label htmlFor={`${id}-ask`} className="sr-only">
        Ask Niva anything
      </label>
      <div className="flex items-center gap-2">
        <span className="text-brown" aria-hidden="true">
          <Sparkle className="h-5 w-5" />
        </span>
        <input
          id={`${id}-ask`}
          name="ask"
          type="text"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask Niva anything, for example: who is behind on pledges?"
          className="cc-search"
        />
        <button type="submit" className={buttonClass("primary", "sm")} disabled={text.trim() === ""}>
          Ask
        </button>
      </div>
      <p className="mt-1 pl-7 text-[12px] text-muted">
        {niva.aiReady
          ? "Press Enter. Niva opens beside your work and nothing changes until you confirm it."
          : niva.aiOff
            ? `${AI_OFF} Enter opens the command search with your words.`
            : "Niva's chat is not switched on yet, so Enter opens the command search with your words."}
      </p>
    </form>
  );
}
