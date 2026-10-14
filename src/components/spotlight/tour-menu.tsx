"use client";

import { useEffect, useId, useRef, useState } from "react";

import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import type { TourDef, TourStatus } from "@/lib/spotlight/types";

import { useSpotlight } from "./spotlight-provider";

const SIZE = "min-h-[44px]";

/**
 * What the Tour item opens: the person's tours to take (again, any time), and the one switch for tours. With tours off it says so and
 * offers to turn them back on; nothing else, so it is the way back for someone who pressed "Don't show tours again".
 */
export function TourMenuPanelView({
  id,
  tours,
  toursOff,
  statusOf,
  onStart,
  onTurnOff,
  onTurnOn,
}: {
  id?: string;
  tours: readonly Pick<TourDef, "id" | "title" | "summary">[];
  toursOff: boolean;
  statusOf: (tourId: string) => TourStatus;
  onStart: (tourId: string) => void;
  onTurnOff: () => void;
  onTurnOn: () => void;
}) {
  return (
    <div id={id} role="group" aria-label={T.menuTitle} data-testid="tour-menu-panel" className="flex flex-col gap-3 p-3">
      {toursOff ? (
        <>
          <p className="m-0 text-[13.5px] leading-snug text-ink-2">{T.menuOffNote}</p>
          <button type="button" onClick={onTurnOn} data-testid="tour-turn-on" className={`${buttonClass("primary")} ${SIZE}`}>
            {T.menuTurnOn}
          </button>
        </>
      ) : (
        <>
          <p className="m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-muted">{T.menuTitle}</p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {tours.map((t) => (
              <li key={t.id} className="flex flex-col gap-1.5">
                <p className="m-0 text-[14px] font-bold leading-snug text-ink">{t.title}</p>
                <p className="m-0 text-[12.5px] leading-snug text-muted">
                  {t.summary}
                  {statusOf(t.id) === "completed" || statusOf(t.id) === "dismissed" ? ` ${T.menuSeenNote}` : ""}
                </p>
                <button type="button" onClick={() => onStart(t.id)} data-testid="tour-menu-start" className={`${buttonClass("primary")} ${SIZE} self-start`}>
                  {T.menuReplay}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onTurnOff} data-testid="tour-turn-off" className={`${buttonClass("plain")} ${SIZE} self-start text-[13.5px] font-bold underline underline-offset-2`}>
            {T.menuTurnOff}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The "Tour" item of the account menu: replay a tour any time, or turn tours off and back on. It exists only for a person who has a
 * tour (so every other role sees nothing new). `variant` "bar" is the classic top bar's button with a small popover; "menu" is a row
 * of the redesigned account menu that opens its panel in place; "block" is the same in the classic phone menu. `onStarted` lets a menu
 * close itself when a tour begins.
 */
export function TourMenuItem({ variant, onStarted }: { variant: "bar" | "menu" | "block"; onStarted?: () => void }) {
  const spotlight = useSpotlight();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open || variant !== "bar") return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
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
  }, [open, variant]);

  if (spotlight.tours.length === 0) return null;

  const warn = (ok: boolean) => {
    if (!ok) toast?.show(T.notRemembered, "bad");
  };
  const panel = (
    <TourMenuPanelView
      id={panelId}
      tours={spotlight.tours}
      toursOff={spotlight.toursOff}
      statusOf={spotlight.statusOf}
      onStart={(id) => {
        setOpen(false);
        onStarted?.();
        spotlight.start(id);
      }}
      onTurnOff={() => warn(spotlight.setToursOff(true).ok)}
      onTurnOn={() => warn(spotlight.setToursOff(false).ok)}
    />
  );

  if (variant === "menu" || variant === "block") {
    return (
      <div data-testid="tour-menu" className={variant === "block" ? "block" : undefined}>
        <button type="button" className={variant === "menu" ? "v2-menu-item" : `${buttonClass("plain")} min-h-[44px] w-full justify-center text-[13px]`} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((o) => !o)}>
          {T.menuItem}
        </button>
        {open ? panel : null}
      </div>
    );
  }
  return (
    <div ref={boxRef} className="relative hidden sm:block" data-testid="tour-menu">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`${buttonClass("plain")} min-h-[44px] text-[13px]`}
      >
        {T.menuItem}
      </button>
      {open ? <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-line bg-white shadow-[var(--shadow-menu)]">{panel}</div> : null}
    </div>
  );
}
