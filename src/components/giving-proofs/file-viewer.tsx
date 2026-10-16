"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { buttonClass } from "@/components/ui";
import { canShowInline, type ProofFile } from "@/lib/payment-proofs/queue";

// The full-screen viewer for a proof's photos and PDFs. The links are short-lived (10 minutes): when one has expired the file shows
// that in words and offers to make new links, never a broken picture. Esc and the close button leave it; the arrows move between files.

export function FileViewer({
  files,
  start,
  onClose,
  onRelink,
}: {
  files: ProofFile[];
  start: number;
  onClose: () => void;
  /** Make new links for the proof's files; resolves to a sentence when it failed. */
  onRelink: () => Promise<string | null>;
}) {
  const open = files.filter((f) => !f.removed);
  const [index, setIndex] = useState(Math.min(Math.max(start, 0), Math.max(open.length - 1, 0)));
  const [broken, setBroken] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const file = open[index] ?? null;

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, open.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open.length]);

  async function relink() {
    setRelinking(true);
    setRelinkError(null);
    const problem = await onRelink();
    setRelinking(false);
    if (problem) setRelinkError(problem);
    else setBroken(null);
  }

  if (typeof document === "undefined") return null;
  const expired = file !== null && broken === file.id;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Proof file" className="fixed inset-0 z-[60] flex flex-col bg-ink/90 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="m-0 text-[14px] font-bold">{file ? `File ${index + 1} of ${open.length}` : "No file to show"}</p>
        <div className="flex flex-wrap items-center gap-2">
          {file?.url ? (
            <a href={file.url} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
              Open in a new tab
            </a>
          ) : null}
          <button ref={closeRef} type="button" onClick={onClose} className={buttonClass("primary", "sm")}>
            Close
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        {open.length > 1 ? (
          <button type="button" aria-label="Previous file" disabled={index === 0} onClick={() => setIndex(index - 1)} className="absolute left-2 z-10 h-11 w-11 rounded-full bg-white/90 text-[22px] font-bold text-navy disabled:opacity-40">
            &lsaquo;
          </button>
        ) : null}
        {!file ? (
          <p className="text-[14px]">All the files of this proof were removed.</p>
        ) : !file.url || expired ? (
          <div className="max-w-md rounded-card bg-white p-5 text-center text-ink">
            <p className="m-0 font-bold">{expired ? "This link has expired" : "This file is not ready to open"}</p>
            <p className="m-0 mt-1 text-[13px] text-muted">Links to a proof file last 10 minutes. Make a new one to keep looking.</p>
            {relinkError ? (
              <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
                {relinkError}
              </p>
            ) : null}
            <button type="button" onClick={relink} disabled={relinking} className={`${buttonClass("primary", "sm")} mt-3`}>
              {relinking ? "Making new links…" : "Make new links"}
            </button>
          </div>
        ) : file.kind === "pdf" ? (
          <iframe title={`Proof file ${index + 1}`} src={file.url} className="h-full w-full max-w-4xl rounded-card bg-white" />
        ) : canShowInline(file.contentType) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.url} alt={`Proof file ${index + 1} of ${open.length}`} onError={() => setBroken(file.id)} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="max-w-md rounded-card bg-white p-5 text-center text-ink">
            <p className="m-0 font-bold">This kind of photo cannot be shown here</p>
            <p className="m-0 mt-1 text-[13px] text-muted">Open it in a new tab, or save it to your computer to look at it.</p>
          </div>
        )}
        {open.length > 1 ? (
          <button type="button" aria-label="Next file" disabled={index >= open.length - 1} onClick={() => setIndex(index + 1)} className="absolute right-2 z-10 h-11 w-11 rounded-full bg-white/90 text-[22px] font-bold text-navy disabled:opacity-40">
            &rsaquo;
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
