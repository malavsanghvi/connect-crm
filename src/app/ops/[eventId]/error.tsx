"use client";

import { useEffect } from "react";

import { buttonClass } from "@/components/ui";

export default function OpsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ops] screen failed to render:", error);
  }, [error]);

  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 p-5 text-danger">
      <p className="font-bold">Something went wrong while loading this screen.</p>
      <p className="mt-1 text-sm">
        The problem has been logged{error.digest ? ` (reference ${error.digest})` : ""}. Try again; if it keeps happening, tell the event lead what you were
        doing.
      </p>
      <button type="button" className={`${buttonClass("bad")} mt-3`} onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
