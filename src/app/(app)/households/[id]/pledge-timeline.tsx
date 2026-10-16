"use client";

import { useState, useTransition } from "react";

import { Badge, buttonClass } from "@/components/ui";
import type { TimelineEntry } from "@/lib/payment-proofs/timeline";
import { timelineState, timelineText, timelineWhen } from "@/lib/payment-proofs/timeline";

import { loadPledgeTimelineAction } from "./timeline-actions";

type Loaded = { state: "idle" } | { state: "loading" } | { state: "error"; error: string } | { state: "ok"; entries: TimelineEntry[] };

const TONE = { ok: "success", warn: "warning", bad: "danger", info: "navy", muted: "neutral" } as const;

/**
 * The Timeline of one pledge, opened on demand: pledged, each proof event, each payment applied, Bank reconciled, in time order
 * (app.pledge_timeline). The same story the family reads. Nothing here can change a pledge, a proof or a payment.
 */
export function PledgeTimeline({ pledgeId, reference, currency, locale, timeZone }: { pledgeId: string; reference: string; currency: string; locale?: string; timeZone: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [, startTransition] = useTransition();

  function load() {
    setLoaded({ state: "loading" });
    startTransition(async () => {
      try {
        const r = await loadPledgeTimelineAction(pledgeId);
        setLoaded(r.ok ? { state: "ok", entries: r.data ?? [] } : { state: "error", error: r.error });
      } catch (err) {
        console.error("[household] loading the timeline failed:", err);
        setLoaded({ state: "error", error: "Could not load the timeline — the server did not respond. Try again." });
      }
    });
  }

  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && (loaded.state === "idle" || loaded.state === "error")) load();
      }}
    >
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">
        Timeline<span className="sr-only"> for {reference}</span>
      </summary>
      <div className="mt-2 w-[min(32rem,80vw)] space-y-2 whitespace-normal rounded-lg border border-line bg-white p-3 text-sm">
        <h4 className="m-0 text-sm font-bold">Timeline: {reference}</h4>
        {loaded.state === "loading" || loaded.state === "idle" ? <p className="m-0 text-muted">Loading the timeline…</p> : null}
        {loaded.state === "error" ? (
          <div role="alert" className="text-danger">
            <p className="m-0">{loaded.error}</p>
            {loaded.error !== "You don't have access to this area." ? (
              <button type="button" onClick={load} className={`${buttonClass("ghost", "xs")} mt-1 min-h-[36px]`}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {loaded.state === "ok" ? (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {loaded.entries.map((e, i) => {
              const st = timelineState(e);
              return (
                <li key={`${e.at}-${i}`} className="flex items-start gap-3">
                  <span className="mt-0.5 flex-none">
                    <Badge tone={TONE[st.tone]}>{st.label}</Badge>
                  </span>
                  <span>
                    <strong>{timelineWhen(e, timeZone)}</strong> {timelineText(e, currency, locale)}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </details>
  );
}
