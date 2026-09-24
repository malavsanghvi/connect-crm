"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the page from the server every `seconds` (paused while the tab is hidden) and shows when it last did. */
export function AutoRefresh({ seconds = 10, timeZone, className = "" }: { seconds?: number; timeZone: string; className?: string }) {
  const router = useRouter();
  const [stamp, setStamp] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone }).format(new Date());
    const first = setTimeout(() => setStamp(fmt()), 0);
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      router.refresh();
      setStamp(fmt());
    }, seconds * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [router, seconds, timeZone]);
  return (
    <p className={`text-xs text-muted ${className}`} aria-live="off">
      Updates every {seconds} s{stamp ? ` · last ${stamp}` : ""}
    </p>
  );
}
