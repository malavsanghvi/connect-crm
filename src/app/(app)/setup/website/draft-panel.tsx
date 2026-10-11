"use client";

import Link from "next/link";
import { useState } from "react";

import { Card, StatusText, buttonClass } from "@/components/ui";
import type { DraftSummary } from "@/lib/site-draft/types";

import { buildFirstDraftAction } from "./draft-actions";

type Note = { tone: "ok" | "bad"; text: string };

/**
 * Setup › Your website › "Your first website draft". After Weaver has finished looking at the website, "Build my first draft"
 * turns what it found and Weaver's own records into a draft of the new website. The draft is opened in a private preview and
 * approved page by page there. Nothing is published from here.
 */
export function DraftPanel({ initial, canBuild, waitingReason, loadError }: { initial: DraftSummary | null; canBuild: boolean; waitingReason: string | null; loadError: string | null }) {
  const [summary, setSummary] = useState<DraftSummary | null>(initial);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<Note | null>(loadError ? { tone: "bad", text: `${loadError} Reload the page to try again.` } : null);

  async function build(replace: boolean) {
    setBusy(true);
    setNote(null);
    try {
      const res = await buildFirstDraftAction(replace);
      if (!res.ok) {
        setNote({ tone: "bad", text: res.error });
        return;
      }
      setAsking(false);
      if (res.data) {
        setSummary(res.data);
        setNote({ tone: "ok", text: res.message ?? "Your first draft is ready." });
      } else {
        setNote({ tone: "ok", text: `${res.message ?? "Your first draft is ready."} The page could not show it just now; reload it to see the draft.` });
      }
    } catch (err) {
      console.error("[setup/website] building the first draft failed:", err);
      setNote({ tone: "bad", text: "Could not build the first draft of your website — the server did not respond. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Your first website draft"
      description="Weaver drafts your new website from what it found and from your records in Weaver: your events, giving, leaders and contact details. You look at it in a private preview and approve it page by page. Nothing is published."
    >
      {summary ? (
        <div className="flex flex-col gap-3" data-draft-panel="ready">
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {summary.pages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-2">
                <Link href={`/setup/website/preview?page=${encodeURIComponent(p.slug)}`} className="font-semibold text-navy underline">
                  {p.title}
                </Link>
                {p.status === "approved" ? <StatusText tone="ok">Approved</StatusText> : <span className="text-muted">Draft</span>}
                <span className="text-muted">
                  · {p.blocks} {p.blocks === 1 ? "part" : "parts"}
                  {p.standIns > 0 ? `, ${p.standIns} with stand-in text to replace` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/setup/website/preview" className={buttonClass("primary")}>
              Open the private preview
            </Link>
            {!asking ? (
              <button type="button" className={buttonClass("ghost")} disabled={busy || !canBuild} onClick={() => setAsking(true)}>
                Start the draft again
              </button>
            ) : null}
          </div>
          {asking ? (
            <div className="rounded-[10px] border border-line bg-ground px-3 py-3 text-[13px]" role="group" aria-label="Start the draft again">
              <p className="text-ink">Starting again replaces the whole draft and clears the approval on every page. Your websites are not changed.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={buttonClass("warn")} disabled={busy} onClick={() => void build(true)}>
                  {busy ? "Building…" : "Yes, replace the draft"}
                </button>
                <button type="button" className={buttonClass("ghost")} disabled={busy} onClick={() => setAsking(false)}>
                  Keep the draft I have
                </button>
              </div>
            </div>
          ) : null}
          {!canBuild && waitingReason ? <p className="text-[12px] text-muted">{waitingReason}</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-draft-panel="empty">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass("primary")} disabled={busy || !canBuild} onClick={() => void build(false)}>
              {busy ? "Building…" : "Build my first draft"}
            </button>
            {!canBuild && waitingReason ? <span className="text-[13px] text-muted">{waitingReason}</span> : null}
          </div>
        </div>
      )}
      {note ? (
        <p
          role={note.tone === "bad" ? "alert" : "status"}
          className={
            note.tone === "bad"
              ? "mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger"
              : "mt-2 rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900"
          }
        >
          {note.text}
          {note.tone === "bad" ? (
            <>
              {" "}
              <button type="button" onClick={() => void build(summary !== null)} className="font-semibold underline">
                Try again
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </Card>
  );
}
