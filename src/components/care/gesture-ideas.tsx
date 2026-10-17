"use client";

import { useState, useTransition } from "react";

import { logCareTouchAction } from "@/app/(app)/households/[id]/care-actions";
import { CopyButton } from "@/components/copy-button";
import { buttonClass } from "@/components/ui";
import { gestureLine, ideasFor, type GestureIdea, type GestureList } from "@/lib/care/gestures";
import { CHANNEL_LABEL, type CareCard } from "@/lib/care/model";
import type { CareRead } from "@/lib/data/care";

// "Ideas for this household" on the Care card (DonorDelight slice 6): the gestures from the organization's library that suit this household's care
// profile and the records it already holds, each with why it suits, a draft to use, and one tap to record that it was done. A gesture is never
// paired with an ask: the touch it records is always "no ask". Nothing is sent; the draft is the person's to use. A failed read is said in words.

function Idea({ idea, householdId }: { idea: GestureIdea; householdId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const g = idea.gesture;
  return (
    <li className="rounded-field border border-line-soft px-3 py-2.5" data-gesture={g.key}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-[14px] font-semibold text-ink">{g.name}</span>
        <span className="text-[12.5px] text-muted">{gestureLine(g)}</span>
      </div>
      <p className="m-0 mt-0.5 text-[13px] text-ink-2">{g.description}</p>
      <p className="m-0 mt-0.5 text-[12.5px] text-muted">Why: {idea.reasons.join(" · ")}</p>
      {idea.draft ? (
        <div className="mt-2 rounded-field border border-line bg-ground px-3 py-2">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] font-bold uppercase tracking-wide text-muted">Draft — you send it, Weaver sends nothing</span>
            <CopyButton value={idea.draft} label="Copy the draft" />
          </div>
          <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-snug text-ink">{idea.draft}</p>
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {done ? (
          <span role="status" className="text-[13px] font-semibold text-success">
            Recorded on the log: no ask.
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            className={buttonClass("ghost", "xs")}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await logCareTouchAction({ householdId, kind: g.kind, channel: idea.channel, outcome: "done", isAsk: false, note: g.name });
                if (!r.ok) setError(r.error);
                else setDone(true);
              });
            }}
          >
            {pending ? "Saving…" : `I did this · ${CHANNEL_LABEL[idea.channel] ?? idea.channel}`}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="m-0 mt-1.5 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function GestureIdeas({ gestures, card, org, householdId }: { gestures: CareRead<GestureList> | null; card: CareCard; org: string | null; householdId: string }) {
  if (!gestures) return null;
  if (gestures.status === "error") {
    return (
      <div className="mb-3 border-t border-line pt-3">
        <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          Could not load the ideas for this household — {gestures.error.replace(/\.?$/, ".")} Reload the page to try again.
        </p>
      </div>
    );
  }
  if (gestures.status !== "ok") return null;
  const ideas = ideasFor(gestures.data.gestures, card, { org });
  if (ideas.length === 0) return null;
  return (
    <details className="mb-3 border-t border-line pt-3" data-testid="care-ideas">
      <summary className="cursor-pointer text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">Ideas for this household ({ideas.length})</summary>
      <p className="m-0 mt-1.5 text-[12.5px] text-muted">From your gesture library, chosen from how they like to be thanked and what you already know about them. Never an ask.</p>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {ideas.map((i) => (
          <Idea key={i.gesture.id} idea={i} householdId={householdId} />
        ))}
      </ul>
    </details>
  );
}
