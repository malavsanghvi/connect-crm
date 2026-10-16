// The one line above a list (docs/CRM_NAV_REDESIGN_PLAN.md, slice 2): search, a switch for the main way to cut the list (Open, Closed,
// All), a dropdown for each other filter, and a summary. A list hands over the chips it always built; this draws them in a row that
// wraps on a narrow screen instead of one block of chips per filter. No hooks: the dropdown is its own client part.

import Link from "next/link";
import type { ReactNode } from "react";

import type { Chip } from "@/lib/giving-lists/types";
import type { MenuView } from "@/lib/list-toolbar";

import { FilterMenu } from "./filter-menu";

export type ToolbarMenu = { label: string; view: MenuView };

/** The links of a switch: the options sit in one box, the lit one filled. Scrolls sideways inside its own box on a phone. */
export function SwitchLinks({ label, chips }: { label: string; chips: readonly Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label={label} className="max-w-full overflow-x-auto">
      <ul className="cc-seg">
        {chips.map((c) => (
          <li key={c.key || "all"} className="flex-none">
            <Link href={c.href} aria-current={c.on ? "page" : undefined}>
              {c.label}
              {c.count !== null ? <span className="tabular-nums opacity-80">{c.count.toLocaleString("en-US")}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ListToolbar({
  search,
  switchLabel,
  switchChips = [],
  menus = [],
  summary,
}: {
  /** The list's search box, drawn by the list. */
  search?: ReactNode;
  switchLabel?: string;
  switchChips?: readonly Chip[];
  menus?: readonly ToolbarMenu[];
  /** One short line about what is shown ("3 open pledges · $1,200 to pay"). */
  summary?: string | null;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {search}
        {switchLabel ? <SwitchLinks label={switchLabel} chips={switchChips} /> : null}
        {menus.map((m) => (
          <FilterMenu key={m.label} label={m.label} view={m.view} />
        ))}
      </div>
      {summary ? <p className="m-0 text-[13px] text-muted">{summary}</p> : null}
    </div>
  );
}
