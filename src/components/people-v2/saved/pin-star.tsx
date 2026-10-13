"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { attempt, useSavedActions } from "./saved-actions";

// The star at the top of a Family page: pins the family to the top of the People home, or unpins it. Per person, on the server (a pin
// is the person's own and nobody else sees it). It shows the state, waits for the write, and says in words what happened: "Pinned" only
// after the pin was saved, and a failure is shown next to the star with the reason and the star stays as it was.

export type PinInfo = {
  householdId: string;
  /** Whether the person has pinned this family; null when that could not be read (said in `loadError`). */
  pinned: boolean | null;
  loadError: string | null;
};

export function PinStar({ pin, familyName }: { pin: PinInfo; familyName: string }) {
  const actions = useSavedActions();
  const router = useRouter();
  const [pinned, setPinned] = useState(pin.pinned);
  const [seen, setSeen] = useState(pin.pinned);
  if (pin.pinned !== seen) {
    setSeen(pin.pinned);
    setPinned(pin.pinned);
  }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const id = useId();
  const unknown = pinned === null;

  async function toggle() {
    if (unknown || busy) return;
    const want = !pinned;
    setBusy(true);
    setMessage(null);
    const res = await attempt(want ? "pin the family" : "unpin the family", () => actions.pin({ householdId: pin.householdId, pinned: want }));
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: "bad", text: res.error });
      return;
    }
    const now = res.data?.pinned ?? want;
    setPinned(now);
    setMessage({ tone: "ok", text: now ? "Pinned. It is at the top of the People home." : "Unpinned." });
    // The confirmation is there to be read, not kept: it goes away by itself (a failure never does).
    window.setTimeout(() => setMessage((m) => (m?.tone === "ok" ? null : m)), 5000);
    router.refresh();
  }

  const label = unknown ? "Pinning is not available just now" : pinned ? `Unpin ${familyName}` : `Pin ${familyName}`;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={unknown || busy}
        aria-pressed={unknown ? undefined : pinned === true}
        aria-label={label}
        aria-describedby={message || pin.loadError ? `${id}-msg` : undefined}
        title={unknown ? "Pinning is not available just now" : pinned ? "Unpin this family" : "Pin this family to the top of the People home"}
        className={`grid size-11 place-items-center rounded-full hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] disabled:cursor-not-allowed ${pinned ? "text-[var(--v2-sun-ink)]" : "text-muted"} ${busy ? "opacity-60" : ""}`}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
        </svg>
      </button>
      {message || pin.loadError ? (
        <span
          id={`${id}-msg`}
          role={message?.tone === "ok" ? "status" : "alert"}
          className={`absolute right-0 top-full z-30 mt-1 w-64 rounded-xl border bg-white px-3 py-2 text-[13px] shadow-lg ${message?.tone === "ok" ? "border-line text-ink-2" : "border-danger/30 text-danger"}`}
        >
          {message ? message.text : `Could not check whether this family is pinned — ${pin.loadError}`}
        </span>
      ) : null}
    </span>
  );
}
