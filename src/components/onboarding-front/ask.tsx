"use client";

// The foot of the front door (board 1): three common questions with written answers, and the box that asks Niva. The box
// opens Niva's panel with the question when Niva is on for this person and has a model; otherwise it is switched off and
// says so, never pretending to send. Asking here is AI used in onboarding, so it stays core (0755): while the community is
// onboarding the chat answers on this page without iWeaver; after that it needs iWeaver like the rest of the chat.

import { useId, useState } from "react";

import { useNiva } from "@/components/niva/niva-context";
import { AI_OFF } from "@/lib/ai-gate";

import { NivaBubble, NivaMark, UserBubble } from "./parts";

/** Written answers, true for any organization today. */
export const COMMON_QUESTIONS: readonly { q: string; a: string }[] = [
  {
    q: "How much history should I load?",
    a: "Many organizations load the last seven years of giving, which covers most tax and audit needs, and every current membership. Older years can wait: you can add them later, a file at a time.",
  },
  {
    q: "Can I keep using my current system while I try this?",
    a: "Yes. Nothing here changes your current system: Weaver only looks at the files you give it, and nothing is saved until you confirm.",
  },
  {
    q: "I only have paper. Where do I start?",
    a: "Reading photos of printed lists is coming next. For now, the template is the quickest way: type the list into it, or ask a helper to, then drop the file here.",
  },
];

export function AskMe() {
  const [ask, setAsk] = useState(0);
  const labelId = useId();
  const picked = ask > 0 ? COMMON_QUESTIONS[ask - 1] : null;
  return (
    <>
      <div className="flex flex-col gap-[10px] @md:ml-[46px]">
        <div id={labelId} className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
          Not sure? Ask me
        </div>
        <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {COMMON_QUESTIONS.map((x, i) => {
            const on = ask === i + 1;
            return (
              <button
                key={x.q}
                type="button"
                aria-pressed={on}
                onClick={() => setAsk(on ? 0 : i + 1)}
                className={`min-h-[44px] rounded-[22px] border border-navy px-4 py-2 text-left text-[14px] font-semibold ${on ? "bg-navy text-white" : "bg-white text-navy hover:bg-navy-50"}`}
              >
                {x.q}
              </button>
            );
          })}
        </div>
      </div>
      <div aria-live="polite">
        {picked ? (
          <div className="flex flex-col gap-[14px]">
            <UserBubble>{picked.q}</UserBubble>
            <div className="flex items-start gap-3">
              <NivaMark />
              <NivaBubble>{picked.a}</NivaBubble>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function AskNivaBar() {
  const niva = useNiva();
  const ready = Boolean(niva && niva.enabled && niva.aiReady);
  const [text, setText] = useState("");
  const noteId = useId();
  return (
    <form
      className="mt-auto flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!ready || !niva || t === "") return;
        niva.ask(t);
        setText("");
      }}
    >
      <div className="flex items-center gap-[10px] rounded-[28px] border border-line-input bg-white py-2 pl-[18px] pr-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy">
        <input
          type="text"
          aria-label="Ask Niva about your data"
          aria-describedby={noteId}
          placeholder="Ask Niva about your data, a file, or a connection"
          value={text}
          disabled={!ready}
          onChange={(e) => setText(e.currentTarget.value)}
          className="min-h-[44px] min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!ready}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full border-0 bg-navy text-white hover:bg-navy-hover disabled:cursor-not-allowed disabled:bg-line-input disabled:text-ink-2"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <p id={noteId} className="m-0 pl-[18px] text-[12px] leading-[1.5] text-muted">
        {ready
          ? "Describe the kind of thing, not the person: please leave out names of children."
          : niva?.enabled && niva.aiOff
            ? `${AI_OFF} This box is switched off; an administrator can ask for it in Settings › Marketplace.`
            : "Niva is not available here yet, so this box is switched off."}
      </p>
    </form>
  );
}
