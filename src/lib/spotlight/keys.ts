// Keyboard use of a running tour, decided without a DOM: Right arrow or Enter = Next, Left arrow = Back, Esc = close.
// The keys never take over from the page: a field being typed in keeps its arrows, and a focused button, link or control keeps its
// own arrows and Enter (so the Skip tour button skips instead of moving on). After each step opens, focus is on the card itself,
// where these keys work.

export type KeyContext = {
  key: string;
  /** Ctrl, Alt or Meta held: a browser or screen reader shortcut, never ours. */
  modified: boolean;
  /** The focused element is a text field, select, textarea or contenteditable. */
  inEditable: boolean;
  /** The focused element is a button, link or other control that has its own use for Enter and the arrows. */
  onControl: boolean;
};

export type KeyAction = "next" | "back" | "skip" | null;

export function tourKeyAction(c: KeyContext): KeyAction {
  if (c.modified) return null;
  // Closing is always one key, wherever focus is.
  if (c.key === "Escape") return "skip";
  if (c.inEditable || c.onControl) return null;
  if (c.key === "ArrowRight" || c.key === "Enter") return "next";
  if (c.key === "ArrowLeft") return "back";
  return null;
}
