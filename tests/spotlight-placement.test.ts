import { describe, expect, it } from "vitest";

import { tourKeyAction, type KeyContext } from "@/lib/spotlight/keys";
import { SHEET_MAX_WIDTH, cardPosition, isSheetLayout, padRect, scrollDelta, sheetSide, shieldStrips } from "@/lib/spotlight/placement";

// Where the ring, the shield and the card go, and what the keys do, as plain arithmetic.

const VP = { width: 1280, height: 800 };
const CARD = { width: 384, height: 240 };

describe("card position", () => {
  it("goes below the lit element by default and stays on the screen", () => {
    const p = cardPosition({ top: 100, left: 600, width: 200, height: 40 }, CARD, VP, "auto");
    expect(p.side).toBe("bottom");
    expect(p.top).toBeGreaterThan(140);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + CARD.width).toBeLessThanOrEqual(VP.width - 8);
  });

  it("honours the side a step asks for when there is room", () => {
    const target = { top: 300, left: 500, width: 200, height: 40 };
    expect(cardPosition(target, CARD, VP, "top").side).toBe("top");
    expect(cardPosition(target, CARD, VP, "right").side).toBe("right");
    expect(cardPosition(target, CARD, VP, "left").side).toBe("left");
    expect(cardPosition(target, CARD, VP, "bottom").side).toBe("bottom");
  });

  it("moves to a side that fits when the asked-for side has no room", () => {
    const nearBottom = { top: 700, left: 500, width: 200, height: 40 };
    const p = cardPosition(nearBottom, CARD, VP, "bottom");
    expect(p.side).not.toBe("bottom");
    expect(p.side).not.toBe("center");
  });

  it("beside a nav item at the left edge it goes to the right", () => {
    const nav = { top: 200, left: 0, width: 200, height: 40 };
    const p = cardPosition(nav, CARD, VP, "right");
    expect(p.side).toBe("right");
    expect(p.left).toBeGreaterThan(200);
  });

  it("is centred when there is no target, or no side has room", () => {
    const centred = cardPosition(null, CARD, VP);
    expect(centred.side).toBe("center");
    expect(centred.left).toBe((VP.width - CARD.width) / 2);
    expect(centred.top).toBe((VP.height - CARD.height) / 2);
    const huge = { top: 0, left: 0, width: VP.width, height: VP.height };
    expect(cardPosition(huge, CARD, VP).side).toBe("center");
  });

  it("never leaves the screen, whatever the size", () => {
    for (const target of [null, { top: 0, left: 0, width: 10, height: 10 }, { top: 790, left: 1270, width: 10, height: 10 }, { top: 400, left: 640, width: 1, height: 1 }]) {
      const p = cardPosition(target, CARD, VP);
      expect(p.top).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p.left).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(p.left + CARD.width).toBeLessThanOrEqual(VP.width - 8 + 1e-9);
    }
  });
});

describe("layout", () => {
  it("a narrow screen gets a sheet at the bottom instead of a card beside the element", () => {
    expect(isSheetLayout({ width: SHEET_MAX_WIDTH - 1, height: 800 })).toBe(true);
    expect(isSheetLayout({ width: SHEET_MAX_WIDTH, height: 800 })).toBe(false);
    expect(isSheetLayout({ width: 375, height: 812 })).toBe(true);
  });

  it("the sheet is at the bottom, unless the lit element is in the bottom bar and the sheet would cover it", () => {
    const phone = { width: 375, height: 812 };
    const sheet = { width: 375, height: 240 };
    expect(sheetSide(null, sheet, phone)).toBe("bottom");
    expect(sheetSide({ top: 300, left: 20, width: 300, height: 120 }, sheet, phone)).toBe("bottom");
    // The phone's bottom bar: a fixed element the page cannot scroll out of the way.
    expect(sheetSide({ top: 748, left: 121, width: 72, height: 64 }, sheet, phone)).toBe("top");
    // An element that would be covered at both edges keeps the bottom.
    expect(sheetSide({ top: 100, left: 0, width: 375, height: 650 }, sheet, phone)).toBe("bottom");
  });

  it("pads the ring around the element", () => {
    expect(padRect({ top: 10, left: 20, width: 100, height: 50 }, 6)).toEqual({ top: 4, left: 14, width: 112, height: 62 });
  });
});

describe("the shield", () => {
  const area = (r: { width: number; height: number }) => r.width * r.height;

  it("covers the screen around the lit element and leaves the element itself free", () => {
    const hole = { top: 200, left: 300, width: 400, height: 100 };
    const strips = shieldStrips(hole, VP);
    expect(strips).toHaveLength(4);
    expect(strips.reduce((sum, s) => sum + area(s), 0)).toBe(VP.width * VP.height - area(hole));
    // No strip overlaps the hole.
    for (const s of strips) {
      const overlapX = Math.min(s.left + s.width, hole.left + hole.width) - Math.max(s.left, hole.left);
      const overlapY = Math.min(s.top + s.height, hole.top + hole.height) - Math.max(s.top, hole.top);
      expect(overlapX > 0 && overlapY > 0).toBe(false);
    }
  });

  it("with no lit element the shield is the whole screen", () => {
    expect(shieldStrips(null, VP)).toEqual([{ top: 0, left: 0, width: VP.width, height: VP.height }]);
  });

  it("an element at the edge or partly off the screen leaves no empty strips", () => {
    const strips = shieldStrips({ top: -20, left: 0, width: 220, height: 100 }, VP);
    for (const s of strips) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
    }
    expect(strips.reduce((sum, s) => sum + area(s), 0)).toBe(VP.width * VP.height - 220 * 80);
  });
});

describe("scrolling the lit element into view", () => {
  const band = { top: 76, bottom: 780 };

  it("does not scroll an element that is already well inside the free band", () => {
    expect(scrollDelta({ top: 300, left: 0, width: 100, height: 100 }, band)).toBe(0);
  });

  it("scrolls down to bring an element below the fold into the middle", () => {
    const delta = scrollDelta({ top: 1500, left: 0, width: 100, height: 100 }, band);
    expect(delta).toBeGreaterThan(0);
    expect(1500 - delta).toBe(76 + (704 - 100) / 2);
  });

  it("scrolls up for an element above the band", () => {
    expect(scrollDelta({ top: -300, left: 0, width: 100, height: 100 }, band)).toBeLessThan(0);
  });

  it("lines up the top of an element taller than the band", () => {
    expect(scrollDelta({ top: 500, left: 0, width: 100, height: 900 }, band)).toBe(500 - 76);
  });

  it("on a phone the band stops above the sheet", () => {
    const phoneBand = { top: 76, bottom: 812 - 300 };
    const delta = scrollDelta({ top: 600, left: 0, width: 300, height: 80 }, phoneBand);
    expect(delta).toBeGreaterThan(0);
    expect(600 - delta + 80).toBeLessThanOrEqual(phoneBand.bottom);
  });

  it("does nothing when there is no free band", () => {
    expect(scrollDelta({ top: 10, left: 0, width: 10, height: 10 }, { top: 100, bottom: 100 })).toBe(0);
  });
});

describe("keyboard", () => {
  const key = (k: string, over: Partial<KeyContext> = {}): KeyContext => ({ key: k, modified: false, inEditable: false, onControl: false, ...over });

  it("Right arrow and Enter go on, Left arrow goes back, Esc closes", () => {
    expect(tourKeyAction(key("ArrowRight"))).toBe("next");
    expect(tourKeyAction(key("Enter"))).toBe("next");
    expect(tourKeyAction(key("ArrowLeft"))).toBe("back");
    expect(tourKeyAction(key("Escape"))).toBe("skip");
  });

  it("Esc closes the tour from anywhere, even in a text field or on a button", () => {
    expect(tourKeyAction(key("Escape", { inEditable: true }))).toBe("skip");
    expect(tourKeyAction(key("Escape", { onControl: true }))).toBe("skip");
  });

  it("does not take the arrows or Enter from a field being typed in", () => {
    for (const k of ["ArrowRight", "ArrowLeft", "Enter"]) expect(tourKeyAction(key(k, { inEditable: true }))).toBeNull();
  });

  it("does not take Enter from a focused button: Skip tour must skip, not go on", () => {
    expect(tourKeyAction(key("Enter", { onControl: true }))).toBeNull();
    expect(tourKeyAction(key("ArrowRight", { onControl: true }))).toBeNull();
  });

  it("leaves browser and screen reader shortcuts alone", () => {
    expect(tourKeyAction(key("ArrowRight", { modified: true }))).toBeNull();
    expect(tourKeyAction(key("Escape", { modified: true }))).toBeNull();
  });

  it("ignores every other key", () => {
    for (const k of ["a", "Tab", " ", "ArrowDown", "ArrowUp"]) expect(tourKeyAction(key(k))).toBeNull();
  });
});
