// Where things go on the screen, as plain arithmetic (no DOM): the ring around the lit element, the transparent shield that stops clicks
// reaching the page behind it, the card next to the ring, and how far to scroll so the element is not under the card.

import type { Placement, Rect, Size } from "./types";

/** Under this width the card is a sheet at the bottom of the screen instead of a card next to the ring. */
export const SHEET_MAX_WIDTH = 640;

const MARGIN = 8;
const GAP = 14;

export function isSheetLayout(viewport: Size): boolean {
  return viewport.width < SHEET_MAX_WIDTH;
}

/**
 * Which edge the sheet sits on, on a narrow screen. Bottom by default; top when the lit element is one the page cannot scroll out of the
 * way (the phone's bottom bar) and the bottom sheet would cover it. A tall element that both would cover keeps the bottom.
 */
export function sheetSide(target: Rect | null, card: Size, vp: Size): "top" | "bottom" {
  if (!target) return "bottom";
  const coveredAtBottom = target.top + target.height > vp.height - card.height;
  const coveredAtTop = target.top < card.height;
  return coveredAtBottom && !coveredAtTop ? "top" : "bottom";
}

export function padRect(r: Rect, pad: number): Rect {
  return { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

export type Side = "top" | "bottom" | "left" | "right" | "center";

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/** Room on each side of the target inside the viewport. */
function room(target: Rect, vp: Size): Record<"top" | "bottom" | "left" | "right", number> {
  return {
    top: target.top - MARGIN,
    bottom: vp.height - (target.top + target.height) - MARGIN,
    left: target.left - MARGIN,
    right: vp.width - (target.left + target.width) - MARGIN,
  };
}

/**
 * The card's top-left corner beside the target. `auto` (and a side with no room) picks the side with space for the whole card, in the
 * order bottom, top, right, left; if none fits, the card is centred on the screen. The card never leaves the viewport.
 */
export function cardPosition(target: Rect | null, card: Size, vp: Size, placement: Placement = "auto"): { top: number; left: number; side: Side } {
  const center = () => ({
    top: clamp((vp.height - card.height) / 2, MARGIN, vp.height - card.height - MARGIN),
    left: clamp((vp.width - card.width) / 2, MARGIN, vp.width - card.width - MARGIN),
    side: "center" as const,
  });
  if (!target) return center();
  const r = room(target, vp);
  const fits: Record<"top" | "bottom" | "left" | "right", boolean> = {
    top: r.top >= card.height + GAP,
    bottom: r.bottom >= card.height + GAP,
    left: r.left >= card.width + GAP,
    right: r.right >= card.width + GAP,
  };
  const order: ("top" | "bottom" | "left" | "right")[] = ["bottom", "top", "right", "left"];
  const wanted = placement === "auto" ? null : placement;
  const side = wanted && fits[wanted] ? wanted : order.find((s) => fits[s]);
  if (!side) return center();
  const centeredLeft = target.left + target.width / 2 - card.width / 2;
  const centeredTop = target.top + target.height / 2 - card.height / 2;
  switch (side) {
    case "bottom":
      return { top: target.top + target.height + GAP, left: clamp(centeredLeft, MARGIN, vp.width - card.width - MARGIN), side };
    case "top":
      return { top: target.top - card.height - GAP, left: clamp(centeredLeft, MARGIN, vp.width - card.width - MARGIN), side };
    case "right":
      return { top: clamp(centeredTop, MARGIN, vp.height - card.height - MARGIN), left: target.left + target.width + GAP, side };
    case "left":
      return { top: clamp(centeredTop, MARGIN, vp.height - card.height - MARGIN), left: target.left - card.width - GAP, side };
  }
}

/**
 * The transparent shield: four strips around the hole that is the lit element, so a click anywhere else lands on the shield and not
 * on the page behind. With no hole (a step whose target is missing) one strip covers the screen. Strips are clipped to the viewport.
 */
export function shieldStrips(hole: Rect | null, vp: Size): Rect[] {
  if (!hole) return [{ top: 0, left: 0, width: vp.width, height: vp.height }];
  const top = clamp(hole.top, 0, vp.height);
  const bottom = clamp(hole.top + hole.height, 0, vp.height);
  const left = clamp(hole.left, 0, vp.width);
  const right = clamp(hole.left + hole.width, 0, vp.width);
  return [
    { top: 0, left: 0, width: vp.width, height: top },
    { top: bottom, left: 0, width: vp.width, height: vp.height - bottom },
    { top, left: 0, width: left, height: bottom - top },
    { top, left: right, width: vp.width - right, height: bottom - top },
  ].filter((s) => s.width > 0 && s.height > 0);
}

/**
 * How far the page must scroll (positive = down) so the target sits in the middle of the free band of the screen; a target taller than
 * the band lines up with its top. No scroll at all when it already fits well inside the band.
 */
export function scrollDelta(target: Rect, band: { top: number; bottom: number }): number {
  const bandHeight = band.bottom - band.top;
  if (bandHeight <= 0) return 0;
  const bottom = target.top + target.height;
  if (target.height >= bandHeight) return target.top - band.top;
  if (target.top >= band.top && bottom <= band.bottom) return 0;
  const wantedTop = band.top + (bandHeight - target.height) / 2;
  return target.top - wantedTop;
}
