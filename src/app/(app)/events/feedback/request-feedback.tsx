"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

import { requestFeedback } from "./actions";

export type FeedbackCandidate = { id: string; name: string; checkedIn: number };

/**
 * "Request feedback" (prototype): a confirmation modal that schedules the
 * standard survey for an event's checked-in attendees.
 */
export function RequestFeedbackButton({
  candidates,
  timingText,
  reminderText,
  anonymousAllowed,
  disabledReason,
}: {
  candidates: FeedbackCandidate[];
  timingText: string;
  reminderText: string;
  anonymousAllowed: boolean;
  disabledReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState(candidates[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const chosen = candidates.find((c) => c.id === eventId) ?? candidates[0];

  if (disabledReason) {
    return (
      <button type="button" className={buttonClass("off")} aria-disabled="true" title={disabledReason} onClick={() => toast?.show(disabledReason, "bad")}>
        Request feedback
      </button>
    );
  }

  function confirm() {
    if (!chosen) return;
    setError(null);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("event_id", chosen.id);
        const res = await requestFeedback(null, fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        toast?.show(res.message ?? "Feedback request scheduled", "ok");
      } catch (e) {
        console.error("[feedback] request failed to reach the server:", e);
        setError("Could not schedule the feedback request — the server did not respond. Check your connection and try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass("primary")}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={candidates.length === 0}
        title={candidates.length === 0 ? "Every recent event already has a feedback survey" : undefined}
      >
        Request feedback
      </button>
      <Modal
        open={open}
        kicker="SEND FEEDBACK REQUEST"
        title={chosen ? `Ask ${chosen.name} attendees for feedback?` : "Ask attendees for feedback?"}
        confirmLabel="Schedule request"
        tone="primary"
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      >
        {candidates.length > 1 ? (
          <div className="mb-3">
            <label htmlFor="fb-event" className="crm-label">
              Event
            </label>
            <select id="fb-event" value={eventId} onChange={(e) => setEventId(e.target.value)} className="crm-input">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {chosen ? (
          <p>
            {/* What really happens (0596): the database schedules the pushes for this time. */}
            The survey opens in the member app {timingText} for the adults of the families who checked in ({chosen.checkedIn} people checked in).
            Those with the app on a phone get a push then (held until quiet hours end at night). {reminderText}. Everyone else with a login
            sees it on Home; nothing goes by SMS, WhatsApp or email. {anonymousAllowed ? "Anonymous answers are allowed." : "All answers are anonymous."}
          </p>
        ) : null}
        {chosen ? (
          <p className="mt-2 text-[13px] text-muted">
            Want points for answering, or the survey sent automatically when the event is marked completed? Set it up on the event&apos;s{" "}
            <Link href={`/events/${chosen.id}?tab=survey`} className="crm-link">
              Survey tab
            </Link>{" "}
            instead. An event has one survey.
          </p>
        ) : null}
      </Modal>
    </>
  );
}
