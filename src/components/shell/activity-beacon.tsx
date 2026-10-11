"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { createBeaconEngine, type BeaconEngine } from "@/lib/activity/beacon-engine";
import { browserBeaconEnv } from "@/lib/activity/browser-env";

/**
 * Records which screens staff open and for how long, once, for the whole portal (mounted in AppShell). It
 * sends the screen's pattern ("/events/[id]", never the id or the query string) and the time it was
 * visible. It does nothing unless the community has turned recording on (`enabled`, decided on the server),
 * renders nothing, and cannot slow or break a page: all of its work is in the background.
 */
export function ActivityBeacon({ centerId, enabled }: { centerId: string; enabled: boolean }) {
  const pathname = usePathname();
  const params = useParams();
  const engineRef = useRef<BeaconEngine | null>(null);
  // The values of the route's dynamic parameters, so a segment that is one is always [id].
  const dynamicKey = Object.values(params ?? {})
    .flat()
    .join("\u0000");

  useEffect(() => {
    if (!enabled) return;
    const engine = createBeaconEngine(centerId, browserBeaconEnv());
    engineRef.current = engine;
    const onVisibility = () => engine.visibility(document.visibilityState === "visible");
    const onHide = () => engine.pageHide();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onVisibility);
      engine.dispose();
      engineRef.current = null;
    };
  }, [enabled, centerId]);

  useEffect(() => {
    engineRef.current?.enter(pathname ?? "/", dynamicKey ? dynamicKey.split("\u0000") : []);
  }, [enabled, centerId, pathname, dynamicKey]);

  return null;
}
