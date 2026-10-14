"use client";

// Giving's one tab row (New look). The layout of /giving hands the person's tabs down (GivingTabsProvider); every Giving page's
// header draws this row instead of the old module pills and tab strip, and Today draws it with its counts.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { activeGivingTab, type GivingTab, type GivingTabKey } from "@/lib/giving-today/tabs";

const GivingTabsContext = createContext<GivingTab[] | null>(null);

export function GivingTabsProvider({ tabs, children }: { tabs: GivingTab[]; children: ReactNode }) {
  return <GivingTabsContext.Provider value={tabs}>{children}</GivingTabsContext.Provider>;
}

/** The Giving tab row of this person, or null outside Giving (and in the classic look). */
export function useGivingTabs(): GivingTab[] | null {
  return useContext(GivingTabsContext);
}

export function GivingTabRow({
  tabs,
  counts,
  active,
  className = "",
}: {
  tabs: readonly GivingTab[];
  counts?: Partial<Record<GivingTabKey, number>>;
  /** Which tab is lit; read from the address when left out. */
  active?: GivingTabKey | null;
  className?: string;
}) {
  const pathname = usePathname() ?? "";
  const current = active === undefined ? activeGivingTab(tabs, pathname) : active;
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Giving sections" className={`max-w-full overflow-x-auto border-b border-line ${className}`}>
      <ul className="m-0 flex list-none gap-0.5 p-0">
        {tabs.map((t) => {
          const n = counts?.[t.key];
          const on = t.key === current;
          return (
            <li key={t.key} className="flex-none">
              <Link
                href={t.href}
                aria-current={on ? "page" : undefined}
                className={`relative inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap border-b-[3px] px-3.5 text-[14px] font-bold no-underline ${
                  on ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
                {n ? (
                  <span className="rounded-full bg-saffron-50 px-2 py-px text-[12px] font-extrabold text-saffron">
                    {n}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
