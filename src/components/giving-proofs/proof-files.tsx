"use client";

import type { ProofFile } from "@/lib/payment-proofs/queue";

// Thumbnails of a proof's files: a picture, or a plain tile for a PDF or a photo the browser cannot draw. Each opens the full-screen
// viewer. A file whose link is not ready says so, with one button that asks for new links; a file retention removed says that.

export function ProofFiles({
  files,
  size = "sm",
  onOpen,
  onRelink,
  relinkError,
  relinking,
}: {
  files: ProofFile[];
  size?: "sm" | "lg";
  onOpen: (index: number) => void;
  onRelink?: () => void;
  relinkError?: string | null;
  relinking?: boolean;
}) {
  if (files.length === 0) return <p className="m-0 text-[13px] text-muted">No files were sent with this confirmation.</p>;
  const dim = size === "lg" ? "h-24 w-24" : "h-14 w-14";
  const missing = files.some((f) => !f.removed && !f.url);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {files.map((f, i) => {
          const tile = `${dim} flex-none overflow-hidden rounded-field border border-line bg-canvas`;
          if (f.removed) {
            return (
              <li key={f.id} className={`${tile} flex items-center justify-center p-1 text-center text-[10.5px] font-bold text-muted`}>
                Removed
              </li>
            );
          }
          return (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onOpen(i)}
                disabled={!f.url}
                aria-label={`Open file ${i + 1} of ${files.length}${f.kind === "pdf" ? " (PDF)" : ""}`}
                className={`${tile} flex items-center justify-center text-[12px] font-bold text-navy hover:border-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {f.url && f.kind === "image" && f.contentType !== "image/heic" && f.contentType !== "image/heif" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span>{f.kind === "pdf" ? "PDF" : f.kind === "image" ? "Photo" : "File"}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {missing ? (
        <p className="m-0 text-[12.5px] text-muted">
          Some previews are not ready.{" "}
          {onRelink ? (
            <button type="button" onClick={onRelink} disabled={relinking} className="crm-link font-bold">
              {relinking ? "Making new links…" : "Make new links"}
            </button>
          ) : null}
        </p>
      ) : null}
      {relinkError ? (
        <p role="alert" className="m-0 text-[12.5px] text-danger">
          {relinkError}
        </p>
      ) : null}
    </div>
  );
}
