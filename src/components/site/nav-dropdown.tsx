"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/site/icons";

/**
 * One drop-down of the website's main menu (desktop). Opens on hover, click, or the keyboard; closes on Escape, on a click
 * outside, when focus leaves, and when a link inside it is used. The links are rendered by the server and passed in.
 */
export function NavDropdown({ label, width = 560, children }: { label: string; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => cancelClose, []);

  return (
    <div
      ref={root}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelClose();
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return;
        cancelClose();
        closeTimer.current = setTimeout(() => setOpen(false), 140);
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[48px] items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-colors ${open ? "bg-navy-50 text-navy" : "text-ink-2 hover:bg-navy-50 hover:text-navy"}`}
      >
        {label}
        <Icon name="chevron" className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
      </button>
      {open ? (
        <div id={panelId} className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3" style={{ width }}>
          <div
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
            className="rounded-[28px] border border-line bg-white p-3 shadow-[0_30px_60px_-18px_rgba(27,44,92,0.35)]"
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
