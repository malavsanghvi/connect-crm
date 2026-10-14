"use client";

import { useEffect, useMemo, type ReactNode } from "react";

import { GivingSheetBackendContext } from "@/components/giving-actions/backend";
import { GivingSheetsProvider } from "@/components/giving-actions/provider";
import { FindBackendContext } from "@/components/people-v2/find/find-backend";

import { PREVIEW_BACKEND, previewContext, previewSearch, type PreviewRole } from "./fixtures";

/**
 * DEV ONLY. Gives the find box and the Giving sheets invented data instead of the server, so the box's Giving lane, the Record payment
 * sheet and a family's giving can be tried without a session. `type` is typed into Today's large box a moment after the page loads.
 */
export function GivingRecordPreview({ role, type, children }: { role: PreviewRole; type: string | null; children: ReactNode }) {
  const search = useMemo(() => async (q: string, opts?: { scope?: "people" | "giving" }) => previewSearch(q, opts?.scope ?? "people", role), [role]);
  const ctx = useMemo(() => previewContext(role), [role]);

  useEffect(() => {
    if (!type) return;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>("[data-giving-find] input");
      if (!el) return;
      el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(el, type);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, 400);
    return () => clearTimeout(t);
  }, [type]);

  return (
    <FindBackendContext.Provider value={search}>
      <GivingSheetBackendContext.Provider value={PREVIEW_BACKEND}>
        <GivingSheetsProvider ctx={ctx}>{children}</GivingSheetsProvider>
      </GivingSheetBackendContext.Provider>
    </FindBackendContext.Provider>
  );
}
