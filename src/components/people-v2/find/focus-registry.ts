"use client";

import { otherDialogOpen } from "@/components/niva/focus";

// One Ctrl+K (or ⌘K) for the find box. Whichever box is on screen takes the key: the big one on the People home, otherwise the one in
// the top bar. Registered with a priority; a box that is not showing (the top-bar box is hidden on the People home) is skipped.
// The key is handled before the page's other shortcut handlers (capture phase on the window), so Niva's palette does not open as well.

type Entry = { el: HTMLInputElement; priority: number };

const entries = new Set<Entry>();
let attached = false;

function visible(el: HTMLInputElement): boolean {
  return el.isConnected && !el.disabled && el.getClientRects().length > 0;
}

function onKeyDown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
  if (otherDialogOpen()) return;
  const target = [...entries].filter((x) => visible(x.el)).sort((a, b) => b.priority - a.priority)[0];
  if (!target) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  target.el.focus();
  target.el.select();
}

export function registerFindInput(el: HTMLInputElement, priority: number): () => void {
  const entry: Entry = { el, priority };
  entries.add(entry);
  if (!attached) {
    window.addEventListener("keydown", onKeyDown, true);
    attached = true;
  }
  return () => {
    entries.delete(entry);
    if (entries.size === 0 && attached) {
      window.removeEventListener("keydown", onKeyDown, true);
      attached = false;
    }
  };
}
