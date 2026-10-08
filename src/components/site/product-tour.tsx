"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/site/icons";

export type TourTab = { id: string; label: string; icon: IconName; panel: ReactNode };

/** Tabs for the product tour on the home page. The panels are rendered by the server; this only switches between them. */
export function ProductTour({ tabs }: { tabs: TourTab[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (to: number) => {
    const next = (to + tabs.length) % tabs.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowRight") move(i + 1);
    else if (e.key === "ArrowLeft") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-8">
      <div role="tablist" aria-label="Product tour" className="mx-auto flex max-w-full gap-2 overflow-x-auto rounded-full border border-line bg-white p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={`flex min-h-[48px] flex-none items-center gap-2 rounded-full px-5 text-[15px] font-bold transition-colors ${
              i === active ? "bg-navy text-white" : "text-ink-2 hover:bg-navy-50 hover:text-navy"
            }`}
          >
            <Icon name={tab.icon} className="h-[18px] w-[18px]" />
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.id} role="tabpanel" id={`${base}-panel-${tab.id}`} aria-labelledby={`${base}-tab-${tab.id}`} hidden={i !== active} tabIndex={0} className="rounded-[28px] focus-visible:outline-offset-8">
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
