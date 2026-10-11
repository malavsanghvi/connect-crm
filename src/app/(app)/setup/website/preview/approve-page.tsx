"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui";
import type { PageStatus } from "@/lib/site-draft/types";

import { setDraftPageStatusAction } from "../draft-actions";

/**
 * "Approve page" / "Reopen page" under the preview. Approving only marks the page as looked at and accepted; nothing is
 * published. The outcome (or the reason it failed, with Try again) is shown right next to the button.
 */
export function ApprovePage({ pageId, title, initial, standIns }: { pageId: string; title: string; initial: PageStatus; standIns: number }) {
  const [status, setStatus] = useState<PageStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const approved = status === "approved";

  async function toggle() {
    const next: PageStatus = approved ? "draft" : "approved";
    setBusy(true);
    setNote(null);
    try {
      const res = await setDraftPageStatusAction(pageId, next);
      if (!res.ok) {
        setNote({ tone: "bad", text: res.error });
        return;
      }
      setStatus(next);
      setNote({ tone: "ok", text: res.message ?? (next === "approved" ? "Page approved." : "Page reopened.") });
    } catch (err) {
      console.error("[setup/website/preview] changing the page's status failed:", err);
      setNote({ tone: "bad", text: `Could not ${approved ? "reopen" : "approve"} this page — the server did not respond. Nothing was changed.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-approve-page={pageId}>
      <p className="text-[13px] text-muted">
        {approved ? <strong className="text-success-900">&ldquo;{title}&rdquo; is approved.</strong> : <>&ldquo;{title}&rdquo; is still a draft.</>}{" "}
        {standIns > 0
          ? `${standIns} ${standIns === 1 ? "part has" : "parts have"} short stand-in text. You can approve the page now and replace the text later.`
          : "Every part of this page uses your own words or Weaver's records."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass(approved ? "ghost" : "primary")} disabled={busy} onClick={() => void toggle()}>
          {busy ? "Saving…" : approved ? "Reopen page" : "Approve page"}
        </button>
        <span className="text-[12px] text-muted">Approving does not publish anything.</span>
      </div>
      {note ? (
        <p
          role={note.tone === "bad" ? "alert" : "status"}
          className={
            note.tone === "bad"
              ? "rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger"
              : "rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900"
          }
        >
          {note.text}
          {note.tone === "bad" ? (
            <>
              {" "}
              <button type="button" onClick={() => void toggle()} className="font-semibold underline">
                Try again
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
