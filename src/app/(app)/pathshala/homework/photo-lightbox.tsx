"use client";

import { useRef } from "react";

/**
 * A photo part of a submission: a thumbnail that opens the full picture in a modal (native <dialog>), with a link
 * to the original. Signed Storage URLs are short-lived and vary per request, so next/image caching does not apply.
 */
export function PhotoLightbox({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="block overflow-hidden rounded-lg border border-line bg-[#F6F2EA] transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
        aria-label={`Open ${alt} full size`}
        title="Open full size"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="h-28 w-28 object-cover" loading="lazy" />
      </button>
      <dialog
        ref={ref}
        aria-label={alt}
        className="m-auto max-h-[92vh] max-w-[92vw] rounded-xl border border-line bg-white p-3 shadow-xl backdrop:bg-[rgba(20,18,14,0.6)]"
        onClick={(e) => {
          // A click on the backdrop (the dialog itself, not its content) closes it.
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="max-h-[80vh] max-w-[88vw] object-contain" />
          <div className="flex items-center gap-3 text-[13px]">
            <a href={src} target="_blank" rel="noreferrer" className="crm-link font-semibold">
              Open the original
            </a>
            <button type="button" onClick={() => ref.current?.close()} className="crm-link font-semibold">
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
