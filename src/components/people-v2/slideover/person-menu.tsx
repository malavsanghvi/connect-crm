"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { personMenu, type MenuHrefs, type MenuItem, type MenuKey } from "@/lib/people-v2/slideover";

import { DeceasedSheet, type DeceasedTarget } from "./deceased-sheet";
import { ComingNext } from "./section";

// The ⋯ menu of a person: on the person's card and in the slide-over's footer. It holds the things done rarely: open the details, move
// to another family, merge a duplicate, the printed sign-in code (not built yet: shown switched off, and says so) and mark as
// deceased. Move and merge go to the existing screens for now; mark as deceased opens its sheet here. Opens with Enter, moves with the
// arrow keys, closes with Esc or a click elsewhere, and gives focus back to its button.

export type MenuPerson = DeceasedTarget & { isChild: boolean; deceased: boolean };

const ITEM =
  "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-left text-[14.5px] font-semibold no-underline focus-visible:outline-none";

export function PersonMenu({
  surface,
  person,
  canEdit,
  hasHousehold,
  hrefs,
  today,
  direction = "down",
}: {
  surface: "card" | "panel";
  person: MenuPerson;
  canEdit: boolean;
  hasHousehold: boolean;
  hrefs: MenuHrefs;
  today: string;
  direction?: "down" | "up";
}) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"mark" | "undo" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const items = personMenu({ surface, canEdit, isChild: person.isChild, deceased: person.deceased, hasHousehold, hrefs });

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  if (items.length === 0) return null;

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (!open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const live = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (live.length === 0) return;
    e.preventDefault();
    const at = live.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % live.length : (at - 1 + live.length) % live.length;
    live[next]?.focus();
  }

  function choose(key: MenuKey) {
    setOpen(false);
    if (key === "deceased") setSheet("mark");
    if (key === "undo_deceased") setSheet("undo");
  }

  const dots = (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      {surface === "card" ? (
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={`More about ${person.name}`}
          onClick={() => setOpen((v) => !v)}
          className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:size-10"
        >
          {dots}
        </button>
      ) : (
        <button
          ref={button}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
        >
          {dots}
          More
        </button>
      )}
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={`More about ${person.name}`}
          className={`absolute z-[46] m-0 min-w-[17rem] list-none rounded-2xl border border-line bg-white p-1.5 shadow-menu ${surface === "card" ? "right-0" : "left-0"} ${direction === "up" ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.25rem)]"}`}
        >
          {items.map((i, n) => (
            <li key={i.key} role="none" className={i.danger && n > 0 ? "mt-1 border-t border-line pt-1" : undefined}>
              <MenuRow item={i} onChoose={choose} />
            </li>
          ))}
        </ul>
      ) : null}
      {sheet ? <DeceasedSheet mode={sheet} person={person} today={today} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}

function MenuRow({ item, onChoose }: { item: MenuItem; onChoose: (key: MenuKey) => void }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col">
        <span>{item.label}</span>
        {item.hint ? <span className="text-[12px] font-normal text-muted">{item.hint}</span> : null}
      </span>
      {item.note ? <ComingNext /> : null}
    </>
  );
  if (item.kind === "disabled") {
    return (
      <span role="menuitem" aria-disabled="true" className={`${ITEM} cursor-not-allowed text-faint`}>
        {body}
      </span>
    );
  }
  const tone = item.danger ? "text-danger hover:bg-danger-50 focus-visible:bg-danger-50" : "text-ink hover:bg-[var(--v2-blue-tint)] focus-visible:bg-[var(--v2-blue-tint)]";
  if (item.kind === "link" && item.href) {
    return (
      <Link role="menuitem" href={item.href} scroll={false} onClick={() => onChoose(item.key)} className={`${ITEM} ${tone}`}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" onClick={() => onChoose(item.key)} className={`${ITEM} ${tone}`}>
      {body}
    </button>
  );
}
