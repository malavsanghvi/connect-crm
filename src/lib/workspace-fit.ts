// Which workspaces fit in the top bar and which go under "More". Pure, so the bar (which measures) and the tests (which do not) agree.
//
// Rules (docs/CRM_NAV_REDESIGN_PLAN.md section 2): workspaces keep their order; when they do not all fit, "More" takes the ones that do
// not; the open workspace is never hidden: it takes the last visible slot.

export type FitInput = {
  /** The natural width of each workspace link, in order. */
  widths: readonly number[];
  /** The width the links may use. */
  available: number;
  /** The width of the "More" button. */
  moreWidth: number;
  /** The index of the open workspace, or -1 when none of these is open. */
  active: number;
  /** Space between two links. */
  gap?: number;
};

export type FitResult = {
  /** Indexes shown in the bar, in the order they appear. */
  visible: number[];
  /** Indexes under More, in workspace order. */
  overflow: number[];
};

export function fitWorkspaces({ widths, available, moreWidth, active, gap = 0 }: FitInput): FitResult {
  const n = widths.length;
  const all = Array.from({ length: n }, (_, i) => i);
  const used = (idx: readonly number[]) => idx.reduce((sum, i) => sum + widths[i], 0) + gap * Math.max(idx.length - 1, 0);
  if (n === 0 || used(all) <= available) return { visible: all, overflow: [] };

  // Everything cannot fit: leave room for More and its gap, then take links from the front while they fit.
  const budget = available - moreWidth - gap;
  const visible: number[] = [];
  for (const i of all) {
    if (used([...visible, i]) > budget) break;
    visible.push(i);
  }

  // The open workspace takes the last slot when it did not make it in.
  if (active >= 0 && !visible.includes(active)) {
    while (visible.length > 0 && used([...visible, active]) > budget) visible.pop();
    visible.push(active);
  }
  return { visible, overflow: all.filter((i) => !visible.includes(i)) };
}
