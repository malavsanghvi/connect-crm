"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

import { Icon } from "@/components/site/icons";

/** The menu button and drop-down panel of the website's header on small screens. The links are rendered by the server and passed in. */
export function MobileMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-white text-navy"
      >
        <Icon name={open ? "close" : "menu"} className="h-6 w-6" />
      </button>
      {open ? (
        <div
          id={panelId}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className="absolute inset-x-0 top-full max-h-[calc(100dvh-124px)] overflow-y-auto border-b border-line bg-white px-5 pb-6 pt-2 shadow-[0_18px_30px_rgba(20,18,14,0.12)]"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
