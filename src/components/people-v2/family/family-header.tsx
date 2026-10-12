"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { adultsLine, type FamilyModel } from "@/lib/people-v2/family-model";

import { HouseholdTitle } from "./household-edit";
import { Chip } from "./person-card";

// The top of the Family page: where you are, the household's name (click to rename), the household card line as plain facts (never
// a name alone), the status chips, and three actions: Record payment, Add person and More. On a phone the three actions move to a
// bar fixed above the bottom navigation, so they are always under the thumb.

export type HeaderChip = { key: string; label: string; tone: "blue" | "green" | "grey" | "sun" };

export type FamilyLinks = {
  people: string;
  payment: string | null;
  addPerson: string | null;
  /** The ID list's "Manage IDs" link (the IDs tab), or null when there is nothing to manage. */
  manageIds: string | null;
  /** Items of the More menu for the household. */
  more: { key: string; label: string; href: string; hint?: string }[];
};

const PILL_BASE = "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full px-5 text-[14.5px] font-bold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";
const PRIMARY = `${PILL_BASE} bg-navy text-white hover:bg-navy-hover`;
const SECONDARY = `${PILL_BASE} border border-[var(--v2-line-input)] bg-white text-ink hover:border-[var(--v2-blue)]`;

/** The pin star: another stream builds pinned families. Switched off, and says so. */
function PinStar() {
  return (
    <button
      type="button"
      disabled
      aria-label="Pin this family. Coming next."
      title="Pin this family: coming next"
      className="grid size-11 cursor-not-allowed place-items-center rounded-full text-faint"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />
      </svg>
      <span className="sr-only">Coming next</span>
    </button>
  );
}

/** More ⋯: a small menu of the things done rarely. Opens with Enter, closes with Esc or a click elsewhere. */
export function MoreMenu({ items, align = "right", direction = "down" }: { items: FamilyLinks["more"]; align?: "left" | "right"; direction?: "down" | "up" }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  if (items.length === 0) return null;
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((v) => !v)} className={SECONDARY}>
        <span aria-hidden="true" className="mr-1.5 tracking-widest">
          •••
        </span>
        More
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label="More about this family"
          className={`absolute z-40 m-0 min-w-[16rem] list-none rounded-2xl border border-line bg-white p-1.5 shadow-[0_12px_32px_rgba(18,32,58,0.18)] ${align === "right" ? "right-0" : "left-0"} ${direction === "up" ? "bottom-[calc(100%+0.5rem)]" : "top-[calc(100%+0.5rem)]"}`}
        >
          {items.map((i) => (
            <li key={i.key} role="none">
              <Link role="menuitem" href={i.href} onClick={() => setOpen(false)} className="flex min-h-11 flex-col justify-center rounded-xl px-3 py-1.5 text-[14.5px] font-semibold text-ink no-underline hover:bg-[var(--v2-blue-tint)] focus-visible:bg-[var(--v2-blue-tint)] focus-visible:outline-none">
                {i.label}
                {i.hint ? <span className="text-[12px] font-normal text-muted">{i.hint}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionButtons({ links, direction }: { links: FamilyLinks; direction: "down" | "up" }) {
  return (
    <>
      {links.payment ? (
        <Link href={links.payment} className={PRIMARY}>
          Record payment
        </Link>
      ) : null}
      {links.addPerson ? (
        <Link href={links.addPerson} scroll={false} className={SECONDARY}>
          <span aria-hidden="true" className="mr-1.5 text-[18px] leading-none">
            +
          </span>
          Add person
        </Link>
      ) : null}
      <MoreMenu items={links.more} direction={direction} />
    </>
  );
}

export function FamilyHeader({ model, chips, links, canEdit, children }: { model: FamilyModel; chips: HeaderChip[]; links: FamilyLinks; canEdit: boolean; children?: ReactNode }) {
  const adults = adultsLine(model.card.adults);
  return (
    <header className="mb-1">
      <nav aria-label="Where you are" className="mb-1 flex items-center gap-1.5 text-[13.5px] text-muted">
        <Link href={links.people} className="inline-flex min-h-8 items-center font-bold text-[var(--v2-blue)] no-underline hover:underline">
          <span aria-hidden="true" className="mr-1">
            ‹
          </span>
          People
        </Link>
        <span aria-hidden="true">›</span>
        <span dir="auto" className="truncate">
          {model.name}
        </span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-[18rem]">
          <HouseholdTitle model={model} canEdit={canEdit} />
          <p data-testid="card-line" className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[14px] text-ink-2">
            {model.card.number ? (
              <span className="font-mono text-[13px]" title="Household number">
                No. {model.card.number}
              </span>
            ) : (
              <span className="text-muted">No household number yet</span>
            )}
            {model.card.orgIds.map((id) => (
              <span key={id} className="font-mono text-[13px]" title={model.orgLabel}>
                {id}
              </span>
            ))}
            {adults ? <span dir="auto">{adults}</span> : null}
            {model.card.place ? <span dir="auto">{model.card.place}</span> : null}
          </p>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <PinStar />
          <ActionButtons links={links} direction="down" />
        </div>
      </div>

      {chips.length > 0 || !canEdit ? (
        <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0" aria-label="Status">
          {chips.map((c) => (
            <li key={c.key}>
              <Chip tone={c.tone}>{c.label}</Chip>
            </li>
          ))}
          {!canEdit ? (
            <li>
              <Chip tone="grey">View only</Chip>
            </li>
          ) : null}
        </ul>
      ) : null}
      {children}

      {/* Phone: the three actions in a bar above the bottom navigation. */}
      <div
        data-testid="sticky-actions"
        className="fixed inset-x-0 bottom-[calc(67px+env(safe-area-inset-bottom))] z-20 flex items-center gap-2 border-t border-line bg-white/95 px-3 py-2 backdrop-blur md:hidden"
      >
        <ActionButtons links={links} direction="up" />
      </div>
    </header>
  );
}
