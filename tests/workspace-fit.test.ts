import { describe, expect, it } from "vitest";

import { fitWorkspaces } from "@/lib/workspace-fit";

const widths = [60, 70, 70, 60, 80, 70, 50];

describe("which workspaces fit in the top bar", () => {
  it("shows all of them, and no More, when they fit", () => {
    const r = fitWorkspaces({ widths, available: 600, moreWidth: 60, active: 2 });
    expect(r.visible).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.overflow).toEqual([]);
  });

  it("sends the ones that do not fit to More, in order, and leaves room for More", () => {
    // 60 + 70 + 70 + 60 = 260; More needs 60, so 330 takes four.
    const r = fitWorkspaces({ widths, available: 330, moreWidth: 60, active: 0 });
    expect(r.visible).toEqual([0, 1, 2, 3]);
    expect(r.overflow).toEqual([4, 5, 6]);
  });

  it("never hides the open workspace: it takes the last visible slot", () => {
    const r = fitWorkspaces({ widths, available: 330, moreWidth: 60, active: 6 });
    expect(r.visible).toEqual([0, 1, 2, 6]);
    expect(r.overflow).toEqual([3, 4, 5]);
  });

  it("drops more than one link when the open workspace is wide", () => {
    // Room for 270 beside More: two 100px links fit, but the open 150px one needs one of them out.
    const r = fitWorkspaces({ widths: [100, 100, 100, 150], available: 330, moreWidth: 60, active: 3 });
    expect(r.visible).toEqual([0, 3]);
    expect(r.overflow).toEqual([1, 2]);
  });

  it("counts the gap between links", () => {
    // Four 60px links with 10px gaps need 270, more than 200. With More and its gap there are 130px left: two links and a gap.
    const r = fitWorkspaces({ widths: [60, 60, 60, 60], available: 200, moreWidth: 60, active: 0, gap: 10 });
    expect(r.visible).toEqual([0, 1]);
    expect(r.overflow).toEqual([2, 3]);
  });

  it("keeps the open workspace even when nothing else fits", () => {
    const r = fitWorkspaces({ widths, available: 50, moreWidth: 60, active: 4 });
    expect(r.visible).toEqual([4]);
    expect(r.overflow).toEqual([0, 1, 2, 3, 5, 6]);
  });

  it("handles no workspaces and an open workspace outside the list", () => {
    expect(fitWorkspaces({ widths: [], available: 100, moreWidth: 60, active: -1 })).toEqual({ visible: [], overflow: [] });
    const r = fitWorkspaces({ widths, available: 330, moreWidth: 60, active: -1 });
    expect(r.visible).toEqual([0, 1, 2, 3]);
  });
});
