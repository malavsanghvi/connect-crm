"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";

import { audienceAtAction } from "@/app/(app)/events/[id]/workspace-actions";
import { buttonClass } from "@/components/ui";
import type { AudiencePreviewData } from "@/lib/commands/catalog/events/audience";
import { audienceTiles, type Piece, type WorkspaceHouseholds } from "@/lib/events/workspace";

const TILE_TONE = { plain: "bg-ground text-ink", warn: "bg-[#fff1e6] text-[#7c2d06]", bad: "bg-danger-50 text-[#7a1a14]" } as const;

/**
 * Who the reminder would reach, counted (events.audience_preview): households, adults, each channel, and what quiet hours would do
 * to the send time. Two households in the audience are shown as cards (never a name alone; adults only). Sends nothing.
 */
export function AudienceCard({
  eventId,
  initial,
  households,
  allHref,
}: {
  eventId: string;
  initial: Piece<AudiencePreviewData>;
  households: Piece<WorkspaceHouseholds>;
  allHref: string;
}) {
  const [audience, setAudience] = useState(initial);
  const [sendAt, setSendAt] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const titleId = useId();
  const timeId = useId();

  function recheck(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    start(async () => {
      const res = await audienceAtAction(eventId, sendAt);
      if (res.ok && res.data) setAudience({ ok: true, data: res.data });
      else setProblem(res.error ?? "Could not count who the reminder would reach — try again.");
    });
  }

  if (!audience.ok) {
    return (
      <section aria-labelledby={titleId} className="rounded-[16px] border border-line bg-white px-4 py-3.5">
        <h3 id={titleId} className="m-0 text-[15px] font-bold text-ink">
          Audience
        </h3>
        <p role="alert" className="m-0 mt-1.5 text-[13px] text-danger">
          {audience.error}
        </p>
      </section>
    );
  }
  const a = audience.data;
  const cards = households.ok ? households.data.cards : [];

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-[16px] border border-line bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={titleId} className="m-0 text-[15px] font-bold text-ink">
          Audience: {a.households.toLocaleString("en-US")} {a.households === 1 ? "household" : "households"}
        </h3>
        <span className="text-[13px] text-muted">{a.adults === null ? "Adults not counted" : `${a.adults.toLocaleString("en-US")} ${a.adults === 1 ? "adult" : "adults"}`}</span>
      </div>
      <p className="m-0 text-[12px] text-muted">{a.who}</p>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 text-[13px] sm:grid-cols-2">
        {audienceTiles(a).map((t) => (
          <li key={t.key} className={`rounded-[10px] px-2.5 py-2 ${TILE_TONE[t.tone]}`}>
            <b>{t.strong}</b> {t.text}
          </li>
        ))}
      </ul>
      {cards.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[12px] leading-[1.45] text-ink-2" aria-label="Households in the audience">
          {cards.map((c) => (
            <li key={c.household_id} className="rounded-[10px] bg-ground px-2.5 py-2">
              <b>{c.household_name ?? "Unnamed household"}</b>
              {c.household_number ? <> · <span className="font-mono">{c.household_number}</span></> : null}
              {c.org_household_id ? <> · <span className="font-mono">{c.org_household_id}</span></> : null}
              {c.city ? <> · {c.city}</> : null}
              {c.adults.length > 0 ? <span className="block text-muted">Adults: {c.adults.join(", ")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!households.ok ? (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {households.error}
        </p>
      ) : null}
      <Link href={allHref} className="px-0.5 py-1 text-[12px] font-bold text-navy no-underline hover:underline">
        See all {a.households.toLocaleString("en-US")} {a.households === 1 ? "household" : "households"}
      </Link>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] leading-snug text-muted">
        <li>{a.quiet_hours.held ? `${a.quiet_hours.note} Email is not held.` : a.quiet_hours.applies_to}</li>
        {a.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <form onSubmit={recheck} className="flex flex-wrap items-end gap-2 border-t border-line-soft pt-2.5">
        <div className="flex min-w-[180px] flex-1 flex-col gap-1">
          <label htmlFor={timeId} className="text-[12px] font-semibold text-ink-2">
            Check another send time
          </label>
          <input
            id={timeId}
            type="datetime-local"
            value={sendAt}
            onChange={(e) => setSendAt(e.target.value)}
            className="min-h-[40px] rounded-[10px] border border-line-input bg-white px-2.5 text-[13px] text-ink"
          />
        </div>
        <button type="submit" disabled={pending || !sendAt} className={`${buttonClass("ghost", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending ? "Counting…" : "Check"}
        </button>
        {problem ? (
          <p role="alert" className="m-0 w-full text-[12px] text-danger">
            {problem}
          </p>
        ) : null}
      </form>
    </section>
  );
}
