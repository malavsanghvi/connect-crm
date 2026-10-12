"use client";

// The publish box beside the flyer draft (the prototype's "Publish or schedule"). A person approves the flyer first; then
// the event is published now or at a chosen time (in the community's time zone) to the channels Weaver has: the member
// app, the community calendar and the guest web page all come from publishing the event (src/lib/events/
// publish-schedule.ts). Facebook and Instagram are shown, honestly marked Coming next: Weaver does not post to them yet.

import { useId, useMemo, useState, type ReactNode } from "react";

import type { FlyerPanelSetup } from "@/app/(app)/events/flyer-publish-actions";
import { Toggle } from "@/components/controls";
import { btn, card, ComingNext, Pill, type PillTone } from "@/components/onboarding-front/parts";
import type { ActionResult } from "@/lib/errors";
import type { FlyerDesign } from "@/lib/events/flyer";
import { formatDateTime } from "@/lib/events/format";
import {
  approvalProblem,
  channelRows,
  checkPublishTime,
  publishProblems,
  publishState,
  suggestedPublishTime,
  type ApprovalEvent,
  type ApprovalState,
  type ChannelRow,
} from "@/lib/events/publish-schedule";

import type { FlyerPanelServices } from "./flyer-panel";

const STATE_TONE: Record<ChannelRow["state"], PillTone> = {
  ready: "grey",
  scheduled: "blue",
  live: "green",
  failed: "danger",
  not_shown: "grey",
  ended: "grey",
  off: "grey",
  coming_next: "grey",
};

/** "America/Chicago" as a person reads it ("Central Time"), else the zone's own name. */
export function zoneName(tz: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(at).find((p) => p.type === "timeZoneName");
    if (part?.value) return part.value;
  } catch {
    // An unknown zone falls through to its name.
  }
  return tz.replace(/_/g, " ");
}

function InlineProblem({ children, onRetry, retryLabel = "Try again" }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button type="button" className={btn.outline} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function PublishBox({
  eventId,
  setup,
  design,
  approval,
  eventNow,
  canApprove,
  run,
  services,
}: {
  eventId: string;
  setup: FlyerPanelSetup;
  /** The design on screen when it is valid (what "Approve" saves), else null. */
  design: FlyerDesign | null;
  approval: ApprovalState;
  eventNow: ApprovalEvent;
  canApprove: boolean;
  run: (fn: () => Promise<ActionResult<unknown>>) => Promise<ActionResult<unknown>>;
  services: FlyerPanelServices;
  onReload: () => void;
}) {
  const ids = { mode: useId(), when: useId(), whenHint: useId(), caption: useId(), approve: useId() };
  const tz = setup.tz;
  const ev = setup.event;
  const snapshot = { status: ev.status, publish_at: ev.publish_at, publish_failure: ev.publish_failure, guestVisible: setup.guestVisible };
  const state = publishState(snapshot);
  const rows = channelRows(snapshot, tz);
  const suggestion = useMemo(() => suggestedPublishTime(eventNow.starts_at, tz), [eventNow.starts_at, tz]);

  const [mode, setMode] = useState<"now" | "schedule">(ev.publish_at ? "schedule" : "now");
  // The suggestion follows the event's date until the person types a time of their own.
  const [typed, setTyped] = useState<string | null>(null);
  const when = typed ?? suggestion;

  const [pending, setPending] = useState<null | "approve" | "withdraw" | "publish" | "schedule" | "cancel">(null);
  const [error, setError] = useState<{ text: string; retry: (() => void) | null } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function act(kind: NonNullable<typeof pending>, fn: () => Promise<ActionResult<unknown>>, retry: () => void) {
    setPending(kind);
    setError(null);
    setDone(null);
    const res = await run(fn);
    setPending(null);
    if (!res.ok) setError({ text: res.error, retry });
    else setDone(res.message ?? null);
  }

  const approved = approval.state === "approved";
  function approve() {
    if (!design) return;
    void act("approve", () => services.approve(eventId, design), approve);
  }
  function withdraw() {
    void act("withdraw", () => services.withdraw(eventId), withdraw);
  }
  function publishNow() {
    void act("publish", () => services.publishNow(eventId), publishNow);
  }
  function schedule() {
    const t = checkPublishTime(when, tz, eventNow.starts_at);
    if (!t.ok) {
      setError({ text: t.error, retry: null });
      return;
    }
    void act("schedule", () => services.schedule(eventId, when), schedule);
  }
  function cancelSchedule() {
    void act("cancel", () => services.cancelSchedule(eventId), cancelSchedule);
  }

  // What stops a publish, as the server will see it (it checks again): at the chosen time when scheduling.
  const whenIso = mode === "schedule" ? checkPublishTime(when, tz, eventNow.starts_at) : null;
  const problems = useMemo(() => {
    const at = whenIso && whenIso.ok ? new Date(whenIso.iso) : new Date();
    return publishProblems({ ...ev, name: eventNow.name, starts_at: eventNow.starts_at, venue: eventNow.venue }, approval, at, tz).filter((p) => p !== approvalProblem(approval));
  }, [ev, eventNow, approval, tz, whenIso]);
  const canPublish = setup.canEdit && state !== "live" && state !== "ended" && state !== "cancelled";
  const approvalText =
    approval.state === "approved"
      ? `Approved ${formatDateTime(approval.approval.at, tz)}${approval.approval.by === setup.userId ? " by you" : ""}.`
      : approval.state === "none"
        ? "A person approves everything that goes out. Approving saves this design as the event's flyer."
        : approvalProblem(approval);
  const scheduledLater = state === "scheduled" && ev.publish_at && Date.parse(ev.publish_at) > Date.now();

  return (
    <section aria-labelledby="publish-box-title" id="publish-box" className={`${card} scroll-mt-24`}>
      <h2 id="publish-box-title" className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
        Publish or schedule
      </h2>

      {/* 1. Approve */}
      <div className="mt-3 flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="m-0 text-[14px] font-bold text-ink" id={ids.approve}>
            Approve this flyer
          </p>
          <p className={`m-0 mt-0.5 text-[12px] leading-[1.5] ${approval.state === "changed" || approval.state === "stale" ? "text-danger" : "text-muted"}`}>{approvalText}</p>
        </div>
        <Toggle
          label="Approve this flyer"
          checked={approved}
          disabled={!setup.canEdit || pending !== null || (!approved && !canApprove)}
          onChange={(on) => (on ? approve() : withdraw())}
          onNote={pending === "withdraw" ? "Withdrawing…" : "Approved"}
          offNote={pending === "approve" ? "Saving…" : approval.state === "none" ? "Not yet" : "Approve again"}
        />
      </div>

      {/* 2. Channels */}
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Where the event is published">
        {rows.map((r) => (
          <li key={r.key} className="flex items-start justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
            <div className="min-w-0">
              <p className="m-0 text-[14px] font-bold text-ink">{r.label}</p>
              <p className="m-0 mt-0.5 text-[12px] leading-[1.5] text-muted">{r.detail}</p>
              {r.key === "website" && r.state === "live" && setup.memberAppLink ? (
                <a href={setup.memberAppLink} className="text-[12px] font-bold text-navy underline" target="_blank" rel="noreferrer">
                  Open the event page
                </a>
              ) : null}
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5">
              {r.built ? (
                <Pill tone={STATE_TONE[r.state]}>{r.status}</Pill>
              ) : (
                <>
                  <button type="button" className={btn.off} disabled aria-label={`Connect ${r.label} (coming next)`}>
                    Connect
                  </button>
                  <ComingNext />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Social posting: visible, not built */}
      <div className="mt-2 rounded-[12px] border border-line bg-ground px-3 py-2.5">
        <label htmlFor={ids.caption} className="text-[12px] font-bold text-ink-2">
          Caption for Facebook and Instagram
        </label>
        <textarea
          id={ids.caption}
          disabled
          rows={2}
          aria-describedby={`${ids.caption}-why`}
          className="mt-1 block w-full cursor-not-allowed rounded-[10px] border border-line-input bg-white px-3 py-2 text-[13px] text-muted"
          defaultValue={`${eventNow.name}. ${eventNow.starts_at ? formatDateTime(eventNow.starts_at, tz) : ""}${eventNow.venue ? `, ${eventNow.venue}` : ""}. RSVP in the app or on our website.`}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <Toggle label="Post at the same time" checked={false} disabled offNote="Post at the same time" />
          <ComingNext />
        </div>
        <p id={`${ids.caption}-why`} className="m-0 mt-1 text-[12px] leading-[1.5] text-muted">
          Not available yet: Weaver does not post to Facebook or Instagram. An administrator will connect your Page once; until then, download the flyer and post it yourself.
        </p>
      </div>

      {/* 3. Now or later */}
      {state === "live" ? (
        <p className="m-0 mt-3 rounded-[10px] bg-success-50 px-3 py-2 text-[13px] text-success-900" role="status">
          Published. Members can RSVP in the app{setup.guestVisible ? ", and guests on the event page" : ""}.
        </p>
      ) : state === "ended" || state === "cancelled" ? (
        <p className="m-0 mt-3 text-[13px] text-muted">{state === "ended" ? "This event has ended." : "This event is cancelled. Restore it as a draft on its page to publish it again."}</p>
      ) : !setup.canEdit ? (
        <p className="m-0 mt-3 text-[13px] text-muted">Your role can see this event but not publish it.</p>
      ) : state === "scheduled" && ev.publish_at ? (
        <div className="mt-3 rounded-[12px] border border-navy-300 bg-navy-50 px-3 py-2.5" role="status">
          <p className="m-0 text-[14px] font-bold text-ink">Scheduled for {formatDateTime(ev.publish_at, tz)}</p>
          <p className="m-0 mt-0.5 text-[12px] leading-[1.5] text-ink-2">
            {scheduledLater
              ? `It will be published then (${zoneName(tz)}), after the same checks: if the event or its flyer changed in a way that stops it, it stays a draft and you are told why here. You can change or cancel until then.`
              : "The time has come: it is published within a few minutes."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn.outline} onClick={() => setMode("schedule")} disabled={pending !== null}>
              Change the time
            </button>
            <button type="button" className={btn.outline} onClick={cancelSchedule} disabled={pending !== null}>
              {pending === "cancel" ? "Cancelling…" : "Cancel the schedule"}
            </button>
          </div>
        </div>
      ) : null}

      {state === "failed" && ev.publish_failure && canPublish ? (
        <InlineProblem onRetry={publishNow} retryLabel={pending === "publish" ? "Publishing…" : "Try again"}>
          {ev.publish_failure} Fix it, then try again (it publishes now) or schedule a new time.
        </InlineProblem>
      ) : null}

      {canPublish && (state !== "scheduled" || mode === "schedule") ? (
        <div className="mt-3">
          <div role="radiogroup" aria-label="When to publish" className="flex flex-wrap gap-1.5" id={ids.mode}>
            {(["now", "schedule"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className="cc-chip min-h-[34px]" onClick={() => setMode(m)}>
                {m === "now" ? "Publish now" : "Schedule"}
              </button>
            ))}
          </div>
          {mode === "schedule" ? (
            <div className="mt-2">
              <label htmlFor={ids.when} className="text-[12px] font-bold text-ink-2">
                Publish on
              </label>
              <input
                id={ids.when}
                type="datetime-local"
                value={when}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setError(null);
                }}
                aria-describedby={ids.whenHint}
                className="crm-input mt-1 block w-full max-w-[280px]"
              />
              <p id={ids.whenHint} className="m-0 mt-1 text-[12px] leading-[1.5] text-muted">
                {suggestion ? "Suggested: 10 days before the event at 9:00 am. " : "The event is soon, so publishing now may suit better. "}
                Times are in {zoneName(tz)}, your community&apos;s time zone.
              </p>
            </div>
          ) : null}

          {problems.length ? (
            <div className="mt-3 rounded-[10px] border border-saffron-200 bg-saffron-50 px-3 py-2 text-[12px] text-brown-900">
              <p className="m-0 font-bold">Before it can be published:</p>
              <ul className="m-0 mt-1 list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={approved && !problems.length ? btn.primary : btn.offLarge}
              disabled={!approved || problems.length > 0 || pending !== null}
              aria-describedby={!approved ? ids.approve : undefined}
              onClick={mode === "now" ? publishNow : schedule}
            >
              {pending === "publish" ? "Publishing…" : pending === "schedule" ? "Scheduling…" : mode === "now" ? "Publish now" : state === "scheduled" ? "Change the schedule" : "Schedule"}
            </button>
            {!approved ? <span className="text-[12px] text-muted">Approve the flyer first.</span> : null}
          </div>
        </div>
      ) : null}

      {error ? <InlineProblem onRetry={error.retry ?? undefined}>{error.text}</InlineProblem> : null}
      {done ? (
        <p className="m-0 mt-3 text-[13px] text-success-900" role="status">
          {done}
        </p>
      ) : null}
    </section>
  );
}
