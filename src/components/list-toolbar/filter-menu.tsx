"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/brand/icons";
import type { Chip } from "@/lib/giving-lists/types";
import type { MenuView } from "@/lib/list-toolbar";

/**
 * One filter of a list, as a chip: "Method" while nothing is chosen, "Method: Zelle" once something is. It opens a short list of
 * links (each is the address the list already builds for that option), so the filter is in the address as before and the server
 * answers (`startOpen` draws it open, for tests and previews). Escape, a click elsewhere or choosing an option closes it; arrow keys move between the options.
 */
export function FilterMenu({ label, view, startOpen = false }: { label: string; view: MenuView; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const focusOption = (n: number) => {
    const links = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a") ?? []);
    links[(n + links.length) % links.length]?.focus();
  };
  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => focusOption(0));
  };
  const onPanelKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const links = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a") ?? []);
    const i = links.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    focusOption(to);
  };

  if (view.options.length === 0) return null;
  return (
    <div ref={boxRef} className="relative flex-none">
      <button
        ref={buttonRef}
        type="button"
        className="cc-filter"
        data-on={view.on ? "true" : "false"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKey}
      >
        {view.on && view.value ? (
          <>
            {label}: {view.value}
          </>
        ) : (
          label
        )}
        <Icon name="chevron" className="h-2.5 w-2.5" strokeWidth={3} />
      </button>
      {open ? (
        <ul ref={panelRef} id={panelId} className="cc-filter-panel" aria-label={label} onKeyDown={onPanelKey}>
          {view.options.map((o: Chip) => (
            <li key={o.key || "all"}>
              <Link href={o.href} aria-current={o.on ? "page" : undefined} className="cc-filter-option" onClick={() => setOpen(false)}>
                {o.label}
                {o.count !== null ? <span className="tabular-nums text-muted">{o.count.toLocaleString("en-US")}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
