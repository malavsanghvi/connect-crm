"use client";

import { useState } from "react";

import { useNiva } from "@/components/niva/niva-context";
import { browserFetch, runCommand } from "@/lib/assistant/client";

import { AiTag } from "@/components/brand/ai-tag";
import { Icon } from "@/components/brand/icons";

const PILL = "inline-flex min-h-11 items-center rounded-[22px] px-[18px] text-[14px] font-bold";

/** "Niva noticed" when Niva is on for this organization; "Possible duplicate" otherwise (the match comes from the system either way). */
export function NoticedLabel() {
  const niva = useNiva();
  return (
    <span className="flex items-center gap-2 text-[13px] font-bold text-[var(--v2-sun-ink)]">
      {niva?.enabled ? (
        <>
          <AiTag label="Niva" />
          noticed
        </>
      ) : (
        <>
          <Icon name="alert" size={16} />
          Possible duplicate
        </>
      )}
    </span>
  );
}

/**
 * "Draft a reminder for these": asks Niva to DRAFT (nothing is sent) for the households on the list. The sentence carries the
 * filters in words and the count, never a typed search or a name (D2). Without Niva's chat it is shown, switched off, with why.
 */
export function DraftForThese({ prompt }: { prompt: string | null }) {
  const niva = useNiva();
  const ready = !!niva?.enabled && !!niva.aiReady && !!prompt;
  if (!ready) {
    return (
      <span className="inline-flex items-center gap-2">
        <button type="button" disabled className={`${PILL} cursor-not-allowed bg-navy/45 text-white`} title={prompt ? "Drafting a message from this list is done by Niva, and Niva's chat is not switched on here yet." : "There is no one on the list to draft for."}>
          Draft a reminder for these
        </button>
        {prompt ? <ComingNext label="Needs Niva" /> : null}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => niva?.ask(prompt!)} className={`${PILL} bg-navy text-white hover:bg-navy-hover`}>
      Draft a reminder for these
    </button>
  );
}

/** The list's footer hint: Niva can page and sort only when its chat is on. */
export function ListHint() {
  const niva = useNiva();
  return <>{niva?.enabled && niva.aiReady ? "Ask Niva to “show the next 10”, or sort by household, area or open balance." : "Sort by household, area or open balance."}</>;
}

export function ComingNext({ label = "Coming next", badge = false }: { label?: string; /** Sits on the corner of the switched-off control it belongs to. */ badge?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--v2-indigo-tint)] font-bold tracking-[0.02em] text-[var(--v2-indigo-dark)] ${badge ? "pointer-events-none absolute -right-2 -top-2.5 min-h-5 px-2 text-[10px] ring-2 ring-white" : "min-h-6 px-2.5 text-[11px]"}`}
    >
      {label}
    </span>
  );
}

type MergeKey = "people.merge_households" | "people.merge_people";

/**
 * Merge from a confirmation card. Only when the organization has ticked Niva's merge action (Platform > Niva for admins): it asks
 * Niva's command door to prepare the merge, and the card (both records, what will happen) opens in Niva's panel for the person to
 * confirm. Nothing is merged here. When the action is not ticked, it says so and the existing compare screen does the merge.
 */
export type MergeOption = { keepId: string; dropId: string; keepLabel: string };

export function MergeByCard({ kind, options, compareHref }: { kind: "household" | "person"; options: MergeOption[]; compareHref: string }) {
  const niva = useNiva();
  const key: MergeKey = kind === "household" ? "people.merge_households" : "people.merge_people";
  const ticked = !!niva?.enabled && niva.commands.some((c) => c.key === key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ticked) {
    return (
      <p className="text-[12px] leading-5 text-muted">
        Merging from a confirmation card is not switched on for this organization.{" "}
        <a href={compareHref} className="font-semibold text-navy underline-offset-2 hover:underline">
          Compare side by side
        </a>{" "}
        to merge on the screen.
      </p>
    );
  }

  async function prepare({ keepId, dropId, keepLabel }: MergeOption) {
    if (busy || !niva) return;
    setBusy(true);
    setError(null);
    try {
      const res = await runCommand(browserFetch, { key, input: { keep_id: keepId, drop_id: dropId } });
      if (!res.ok) {
        setError(`Could not prepare the merge — ${res.error}`);
        return;
      }
      if (res.kind === "proposal") niva.showProposal({ asked: `Merge these two ${kind === "household" ? "households" : "records"}, keeping ${keepLabel}`, proposal: res.proposal });
      else setError("Could not prepare the merge — the answer was not a confirmation card. Compare side by side instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.keepId} type="button" onClick={() => prepare(o)} disabled={busy} className="inline-flex min-h-10 items-center rounded-window border border-line-control bg-white px-4 text-[13px] font-bold text-ink hover:border-navy disabled:opacity-60">
            {busy ? "Preparing the card…" : `Merge, keeping ${o.keepLabel}`}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}{" "}
          Choose again.
        </p>
      ) : null}
    </div>
  );
}
