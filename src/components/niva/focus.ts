"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { trapIndex } from "@/lib/assistant/shortcuts";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getAttribute("aria-hidden") !== "true");
}

/**
 * Keeps Tab and Shift+Tab inside `container` (a sheet or the palette). Only acts on keys pressed inside it, so the security-code
 * window (a separate dialog) keeps its own focus handling.
 */
export function trapTab(e: ReactKeyboardEvent, container: HTMLElement | null): void {
  if (e.key !== "Tab" || !container || !container.contains(e.target as Node)) return;
  const items = focusableIn(container);
  const next = trapIndex(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  if (next === null) return;
  const active = items.indexOf(document.activeElement as HTMLElement);
  // Only take over at the ends; in the middle the browser's own order is right.
  if (active === -1 || (e.shiftKey && active === 0) || (!e.shiftKey && active === items.length - 1)) {
    e.preventDefault();
    items[next].focus();
  }
}

/** True while another dialog (the security-code window, a confirmation) is open on top of the page. */
export function otherDialogOpen(): boolean {
  return document.querySelector(".cc-scrim [role=dialog][aria-modal=true]") !== null;
}
