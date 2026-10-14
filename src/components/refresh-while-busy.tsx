"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * While `active` (something runs in the background and the page shows it), re-renders the page from the server every `seconds`
 * (paused while the tab is hidden) for at most `maxSeconds`, so the page never sits on "Running…" until someone reloads it.
 * If the work is still going when the time is up it says so in plain words, with the way to check again, instead of going quiet.
 * It shows nothing while `active` is false.
 */
export function RefreshWhileBusy({
  active,
  seconds = 3,
  maxSeconds = 180,
  className = "",
}: {
  active: boolean;
  seconds?: number;
  maxSeconds?: number;
  className?: string;
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!active) return;
    const reset = setTimeout(() => setTimedOut(false), 0);
    const started = Date.now();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (Date.now() - started >= maxSeconds * 1000) {
        clearInterval(t);
        setTimedOut(true);
        return;
      }
      router.refresh();
    }, seconds * 1000);
    return () => {
      clearTimeout(reset);
      clearInterval(t);
    };
  }, [active, router, seconds, maxSeconds]);
  if (!active) return null;
  return (
    <p className={`text-xs text-muted ${className}`} role="status" data-testid="refresh-while-busy">
      {timedOut ? "Still working in the background. Reload this page to check again." : "This page checks again by itself every few seconds."}
    </p>
  );
}
