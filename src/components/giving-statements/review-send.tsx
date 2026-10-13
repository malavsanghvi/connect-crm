"use client";

// "Review and send" (docs/GIVING_REDESIGN.md section 2: year-end statements in 3 clicks; decision 8). The sheet shows how many
// statements would go by email, by post and to the app, and what needs a fix first. Its Send button stays off and says why:
// the statements service that generates and sends them is not connected yet. Nothing is sent and nothing is recorded here.

import { useState } from "react";

import { GivingSheet } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { buttonClass } from "@/components/ui";
import { SEND_COMING_NEXT, sendLabel, type ReviewSummary } from "@/lib/giving-statements/review";

export function ReviewAndSend({
  year,
  yearOver,
  summary,
  labels,
  initiallyOpen = false,
}: {
  year: number;
  yearOver: boolean;
  summary: ReviewSummary;
  labels: CardLabels;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const c = summary.counts;
  const tiles: { n: number; label: string }[] = [
    { n: c.email, label: "by email" },
    { n: c.post, label: "by post (asked for paper)" },
    { n: c.app, label: "in the app only" },
    { n: c.none, label: c.none === 1 ? "needs a fix first" : "need a fix first" },
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("primary", "sm")} min-h-[44px]`} data-testid="statements-review-open">
        Review and send
      </button>
      {open ? (
        <GivingSheet
          title={`Year-end statements for ${year}${yearOver ? "" : " (so far)"}`}
          labels={labels}
          what={
            <>
              {summary.households.toLocaleString("en-US")} {summary.households === 1 ? "household" : "households"} gave {summary.total} in {year}
              {yearOver ? "" : " so far"}: {summary.sentence}. Opening-balance lines are left out of the totals and refunds are taken off, as on
              every statement. Statements are addressed to adults; a child is never named.
            </>
          }
          confirmLabel={`${sendLabel(c)} · coming next`}
          confirmDisabled
          pending={false}
          onConfirm={() => undefined}
          onClose={() => setOpen(false)}
        >
          <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0" data-testid="statements-review-counts">
            {tiles.map((t) => (
              <li key={t.label} className="rounded-[12px] border border-line px-3 py-2">
                <span className="block text-[22px] font-bold tabular-nums text-ink">{t.n.toLocaleString("en-US")}</span>
                <span className="text-[13px] text-muted">{t.label}</span>
              </li>
            ))}
          </ul>
          {summary.nothingToState ? (
            <p className="m-0 text-[13px] text-muted">
              {summary.nothingToState.toLocaleString("en-US")} {summary.nothingToState === 1 ? "household has" : "households have"} nothing to
              state: refunds cancel their gifts.
            </p>
          ) : null}
          <p role="status" className="m-0 rounded-[12px] border border-line bg-canvas px-3 py-2 text-[13px] text-ink-2" data-testid="statements-send-coming-next">
            {SEND_COMING_NEXT} The button stays off until it is. Nothing has been sent, and nothing reaches a family from this screen.
          </p>
        </GivingSheet>
      ) : null}
    </>
  );
}
