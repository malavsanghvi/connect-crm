"use client";

import { useEffect } from "react";

import { buttonClass } from "@/components/ui";
import { isStalePageError } from "@/lib/stale-page";

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[crm] page failed to render:", error);
  }, [error]);

  // A page left open across a deploy: its buttons point at an older build. Trying again cannot help; reloading does.
  if (isStalePageError(error)) {
    return (
      <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 px-6 py-8">
        <h1 className="font-display text-xl font-semibold text-danger">This page is out of date</h1>
        <p className="mt-2 text-sm text-danger">
          The portal was updated while this page was open, so that click did not go through and nothing was saved. Reload the page, then do it again.
        </p>
        <button type="button" onClick={() => window.location.reload()} className={`${buttonClass("secondary")} mt-4`}>
          Reload page
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 px-6 py-8">
      <h1 className="font-display text-xl font-semibold text-danger">This page could not be shown</h1>
      <p className="mt-2 text-sm text-danger">
        {error.digest
          ? "Something went wrong on the server while loading this page. The details were logged"
          : error.message || "Something went wrong while loading this page"}
        {error.digest ? ` (reference ${error.digest}).` : "."}
      </p>
      <button type="button" onClick={() => reset()} className={`${buttonClass("secondary")} mt-4`}>
        Try again
      </button>
    </div>
  );
}
