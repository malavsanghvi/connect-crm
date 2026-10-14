"use client";

// The running tour: a dimmed page, a ring around one real element, a card beside it. Loaded only when a tour starts (next/dynamic in
// the provider), so a page with no tour running pays nothing. It reads the page and moves the person between pages (Next/Back on a step
// with an address); it never clicks, submits or writes. All the deciding (which step, what is said, where things go) is in
// src/lib/spotlight/*, which is tested without a browser.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { SPOTLIGHT_TEXT as T } from "@/lib/spotlight/copy";
import { tourKeyAction } from "@/lib/spotlight/keys";
import { navigateTarget, reduceTour, startTour, stepAt, type MachineEvent, type MachineState } from "@/lib/spotlight/machine";
import { cardPosition, isSheetLayout, padRect, scrollDelta, shieldStrips, sheetSide } from "@/lib/spotlight/placement";
import { SPOTLIGHT_ATTRIBUTE, selectorFor, waitForTarget } from "@/lib/spotlight/target";
import type { Rect, Size, TourDef } from "@/lib/spotlight/types";

import { SpotlightCard } from "./spotlight-card";

const RING_PAD = 6;
const CARD_WIDTH = 384;
/** The sticky top bar covers this much of the screen; a lit element is scrolled to the free band below it. */
const TOP_BAR = 76;

function visible(el: Element): boolean {
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The first element for the key that is actually on the screen (a key can be on a hidden copy too). */
function findTarget(key: string): Element | null {
  for (const el of document.querySelectorAll(selectorFor(key))) if (visible(el)) return el;
  return null;
}

/** Calls back when the page changes: elements added or removed, or the attribute changed. */
function watchPage(onChange: () => void): () => void {
  const observer = new MutationObserver(() => onChange());
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: [SPOTLIGHT_ATTRIBUTE, "hidden", "class", "style"] });
  return () => observer.disconnect();
}

function toRect(r: DOMRect): Rect {
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (a !== null && b !== null && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The nearest ancestor that scrolls on its own, or the page. */
function scroller(el: Element): Element | Window {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

function bringIntoView(el: Element, band: { top: number; bottom: number }) {
  const delta = scrollDelta(toRect(el.getBoundingClientRect()), band);
  if (Math.abs(delta) < 2) return;
  scroller(el).scrollBy({ top: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

const EDITABLE_INPUT = /^(text|search|email|url|tel|password|number|date|datetime-local|month|time|week)$/;

function describeFocus(t: EventTarget | null): { inEditable: boolean; onControl: boolean } {
  if (!(t instanceof HTMLElement)) return { inEditable: false, onControl: false };
  const tag = t.tagName;
  const inEditable = t.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && EDITABLE_INPUT.test((t as HTMLInputElement).type));
  const role = t.getAttribute("role") ?? "";
  const onControl = tag === "BUTTON" || tag === "A" || tag === "INPUT" || tag === "SUMMARY" || /^(button|link|menuitem|tab|checkbox|radio|switch|option|slider)$/.test(role);
  return { inEditable, onControl };
}

export default function SpotlightRunner({
  tour,
  onEnd,
  announce,
}: {
  tour: TourDef;
  /** Called once when the tour is over: finished, or skipped/closed. The provider remembers it and returns focus. */
  onEnd: (how: "completed" | "skipped") => void;
  announce: (words: string) => void;
}) {
  const router = useRouter();
  const [m, dispatch] = useReducer((s: MachineState, e: MachineEvent) => reduceTour(tour, s, e), undefined, startTour);
  const step = stepAt(tour, m.index);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState<Size>({ width: 1024, height: 768 });
  const [cardSize, setCardSize] = useState<Size>({ width: CARD_WIDTH, height: 220 });
  const targetRef = useRef<Element | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stepKey = step?.target ?? "";
  const sheet = isSheetLayout(vp);

  // Measure the lit element, the card and the window. Called from events and observers, never while rendering.
  const measure = useCallback(() => {
    let el = targetRef.current;
    if (el && !visible(el)) {
      // The page re-rendered (or the element went away): look for the key again before giving up on the ring.
      el = stepKey ? findTarget(stepKey) : null;
      targetRef.current = el;
    }
    const next = el ? toRect(el.getBoundingClientRect()) : null;
    setRect((prev) => (sameRect(prev, next) ? prev : next));
    const size = { width: window.innerWidth, height: window.innerHeight };
    setVp((prev) => (prev.width === size.width && prev.height === size.height ? prev : size));
    const c = cardRef.current?.getBoundingClientRect();
    if (c) setCardSize((prev) => (Math.abs(prev.width - c.width) < 1 && Math.abs(prev.height - c.height) < 1 ? prev : { width: c.width, height: c.height }));
  }, [stepKey]);

  // Arriving at a step: go to its page when the person is elsewhere, then wait for its target to be on the screen. A target that is
  // already there is found before the browser paints, so moving along one page does not flicker.
  useLayoutEffect(() => {
    if (m.ended || !step) return;
    const light = (el: Element) => {
      targetRef.current = el;
      const free = window.innerHeight - (isSheetLayout({ width: window.innerWidth, height: window.innerHeight }) ? 300 : 24);
      bringIntoView(el, { top: TOP_BAR, bottom: free });
      // Measure now, so the ring is drawn on this element from its first frame, not on the last step's.
      measure();
      dispatch({ type: "found" });
    };
    if (m.phase === "missing") {
      // The wait ran out, but the page may still arrive (a slow connection): light the step if its target shows up later.
      return watchPage(() => {
        const el = findTarget(step.target);
        if (el) light(el);
      });
    }
    if (m.phase !== "waiting") return;
    targetRef.current = null;
    const go = navigateTarget(step, window.location.pathname);
    if (go) router.push(go);
    return waitForTarget<Element>({ find: () => findTarget(step.target), watch: watchPage }, (el) => {
      if (el) light(el);
      else dispatch({ type: "missing" });
    });
  }, [m.index, m.phase, m.ended, step, router, measure]);

  // The ring follows the element: on scroll (any scroller), resize, a change of its size, and a slow tick for late layout changes.
  useEffect(() => {
    if (m.ended) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    schedule();
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const tick = window.setInterval(() => {
      if (!document.hidden) schedule();
    }, 400);
    const watcher = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (targetRef.current) watcher?.observe(targetRef.current);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", schedule);
      window.clearInterval(tick);
      watcher?.disconnect();
    };
  }, [m.ended, m.index, m.phase, measure]);

  // Words for the polite live region, and the end of the tour.
  useEffect(() => {
    if (m.announce) announce(m.announce);
  }, [m.tick, m.announce, announce]);
  useEffect(() => {
    if (m.ended) onEnd(m.ended);
  }, [m.ended, onEnd]);

  // Focus moves to the card when a step opens (the page behind is not made inert, and nothing traps focus).
  useEffect(() => {
    if (!m.ended && m.phase !== "waiting") cardRef.current?.focus({ preventScroll: true });
  }, [m.index, m.phase, m.ended]);

  const last = m.index >= tour.steps.length - 1;
  useEffect(() => {
    if (m.ended) return;
    const onKey = (e: KeyboardEvent) => {
      const action = tourKeyAction({ key: e.key, modified: e.ctrlKey || e.altKey || e.metaKey, ...describeFocus(e.target) });
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      dispatch(action === "skip" ? { type: "skip" } : action === "back" ? { type: "back" } : { type: last ? "finish" : "next" });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [m.ended, last]);

  if (!step || m.ended || typeof document === "undefined") return null;

  // A click on the shield does nothing to the page; it also leaves focus on the card, so the keys keep working.
  const keepFocus = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    cardRef.current?.focus({ preventScroll: true });
  };

  const lit = m.phase === "ready" && rect ? padRect(rect, RING_PAD) : null;
  const strips = shieldStrips(lit, vp);
  const width = Math.min(CARD_WIDTH, vp.width - 16);
  const pos = cardPosition(lit, { width, height: cardSize.height }, vp, step.placement);
  const style = sheet ? undefined : { top: pos.top, left: pos.left, width };

  return createPortal(
    <div data-testid="spotlight-overlay" data-step={step.id} data-phase={m.phase}>
      {/* The transparent shield: a click anywhere but the lit element lands here, not on the page behind. */}
      {strips.map((s, i) => (
        <div key={i} aria-hidden="true" className="sp-shield" onMouseDown={keepFocus} style={{ top: s.top, left: s.left, width: s.width, height: s.height }} />
      ))}
      {/* Over the lit element too, unless the step is "try it yourself": then the real element can be pressed by the person. */}
      {lit && !step.interactive ? (
        <div aria-hidden="true" className="sp-shield" onMouseDown={keepFocus} style={{ top: lit.top, left: lit.left, width: lit.width, height: lit.height }} />
      ) : null}
      {/* Separate keys: React must not turn the full-screen dim into the ring (it would grow out of the corner). */}
      {lit ? (
        <div key="ring" aria-hidden="true" className="sp-ring" style={{ top: lit.top, left: lit.left, width: lit.width, height: lit.height }} />
      ) : (
        <div key="dim" aria-hidden="true" className="sp-dim" />
      )}
      <SpotlightCard
        cardRef={cardRef}
        step={step}
        index={m.index}
        total={tour.steps.length}
        phase={m.phase}
        missingNote={step.missing ?? T.missing}
        sheet={sheet}
        sheetTop={sheet && sheetSide(lit, cardSize, vp) === "top"}
        style={style}
        onNext={() => dispatch({ type: "next" })}
        onBack={() => dispatch({ type: "back" })}
        onSkip={() => dispatch({ type: "skip" })}
        onFinish={() => dispatch({ type: "finish" })}
        onRetry={() => dispatch({ type: "retry" })}
      />
    </div>,
    document.body,
  );
}
