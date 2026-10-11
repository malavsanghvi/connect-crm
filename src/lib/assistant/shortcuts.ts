// The two keyboard shortcuts: ⌘K / Ctrl+K opens the palette, ⌘J / Ctrl+J opens or closes Niva's panel.

export type ShortcutEvent = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

export function shortcutFor(e: ShortcutEvent): "palette" | "panel" | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === "k") return "palette";
  if (key === "j") return "panel";
  return null;
}

export type KeyTarget = {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: "keydown", listener: (e: KeyboardEvent) => void): void;
};

/**
 * Registers the two shortcuts on `target` (the document) and returns the function that removes them. When `enabled` is false
 * nothing is registered at all, so a community that has Niva off keeps the browser's own Ctrl+K and Ctrl+J. A shortcut is left to
 * the browser while `blocked()` says another dialog is open.
 */
export function attachShortcuts(target: KeyTarget, enabled: boolean, onShortcut: (which: "palette" | "panel") => void, blocked: () => boolean = () => false): () => void {
  if (!enabled) return () => {};
  const listener = (e: KeyboardEvent) => {
    const which = shortcutFor(e);
    if (!which || blocked()) return;
    e.preventDefault();
    onShortcut(which);
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}

/** "⌘" on a Mac, "Ctrl" elsewhere, for the hints next to the buttons. */
export function modKeyLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

/** Next index for Tab / Shift+Tab inside a focus trap of `count` focusable things; null when there is nothing to trap. */
export function trapIndex(count: number, active: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (active < 0) return backwards ? count - 1 : 0;
  if (backwards) return active === 0 ? count - 1 : active - 1;
  return active === count - 1 ? 0 : active + 1;
}
