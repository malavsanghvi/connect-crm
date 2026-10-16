// What the one-line list toolbar shows for a group of chips (docs/CRM_NAV_REDESIGN_PLAN.md, slice 2). A list builds its chips once, as it
// always did (a label, an address, whether it is on, an optional count); the toolbar draws a group of them either as a switch (one
// line of links) or as a dropdown that shows its value while a filter is on. Pure, so the lists and the tests read the same thing.

import type { Chip } from "@/lib/giving-lists/types";

export type MenuView = {
  /** The chip is lit: some option other than the "all" one is on. */
  on: boolean;
  /** What the lit chip says ("Zelle", "1 to 30 days"); null while nothing is chosen. */
  value: string | null;
  /** The options in the menu, the "all" option first. */
  options: Chip[];
};

/** A chip's label without the amount or count after a middle dot ("1 to 30 days · $96,200" is "1 to 30 days"). */
export function chipName(label: string): string {
  return label.split(" · ")[0].trim();
}

/**
 * A group of chips as a dropdown. A group with an "all" chip (key "": All methods, All years) keeps it as the first option. A group
 * without one (the Behind-by buckets) gets `reset` as its first option when the list says where "no filter" is.
 */
export function menuView(chips: readonly Chip[], reset?: { label: string; href: string }): MenuView {
  const all = chips.find((c) => c.key === "");
  const rest = chips.filter((c) => c.key !== "");
  const lit = rest.find((c) => c.on) ?? null;
  const first: Chip[] = all ? [all] : reset ? [{ key: "", label: reset.label, href: reset.href, count: null, on: lit === null }] : [];
  return { on: lit !== null, value: lit ? chipName(lit.label) : null, options: [...first, ...rest] };
}
