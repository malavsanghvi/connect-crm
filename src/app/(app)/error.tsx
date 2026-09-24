"use client";

import { useEffect } from "react";

import { buttonClass } from "@/components/ui";

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

  return (
    <div role="alert" className="rounded-xl border border-maroon/30 bg-maroon-50 px-6 py-8">
      <h1 className="font-display text-xl font-semibold text-maroon">This page could not be shown</h1>
      <p className="mt-2 text-sm text-maroon">
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
