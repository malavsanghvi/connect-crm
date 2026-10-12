"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { SlideOverFrame } from "./frame";

// The slide-over when there is nothing to show but a sentence: the person is not in this family (a shared link that is out of date, or a
// person this role cannot see), or the person could not be read. It says so in words, with the way on, and closes like the real one.

export function SlideOverMessage({ title, closeHref, children }: { title: string; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  const close = () => router.push(closeHref, { scroll: false });
  return (
    <SlideOverFrame label={title} onClose={close}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="slideover-message">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="m-0 font-display text-[20px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={close} aria-label="Close details" className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-[var(--v2-ground)]">
            <span aria-hidden="true" className="text-[26px] leading-none">
              ×
            </span>
          </button>
        </header>
        <div className="flex-1 px-5 py-4 text-[14.5px] text-ink-2">{children}</div>
        <footer className="flex justify-end border-t border-line px-5 py-3">
          <Link href={closeHref} scroll={false} className="inline-flex min-h-11 items-center rounded-full bg-navy px-7 text-[14.5px] font-bold text-white no-underline hover:bg-navy-hover">
            Done
          </Link>
        </footer>
      </div>
    </SlideOverFrame>
  );
}
