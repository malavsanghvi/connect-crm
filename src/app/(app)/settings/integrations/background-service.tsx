"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";

import { testBackgroundServiceAction } from "./actions";

/** "Send a test job": queues demo.ping, then refreshes a few times so its result shows up. */
export function TestJobButton() {
  const router = useRouter();
  const toast = useToast();
  const [working, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function run() {
    setError(null);
    start(async () => {
      const res = await testBackgroundServiceAction();
      if (!res.ok) {
        setError(res.error);
        toast?.show(res.error, "bad");
        return;
      }
      toast?.show(res.message ?? "Test job queued", "ok");
      router.refresh();
      timers.current.push(...[3000, 7000, 15000].map((ms) => setTimeout(() => router.refresh(), ms)));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className={buttonClass("ghost", "sm")} onClick={run} disabled={working}>
        {working ? "Queuing…" : "Send a test job"}
      </button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
