"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { Pill } from "@/components/onboarding-front/parts";
import type { LanguageTab } from "@/lib/events/workspace";

/**
 * The reminder, one tab per language the community uses (its own list from Setup > Profile, never a fixed set). A language Weaver
 * has wording for shows that wording; any other language shows the English text marked "Needs translation". Nothing is sent from here.
 */
export function ReminderDrafts({ tabs, initial }: { tabs: LanguageTab[]; initial?: string }) {
  const [current, setCurrent] = useState(() => (initial && tabs.some((t) => t.code === initial) ? initial : (tabs[0]?.code ?? "")));
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = tabs.find((t) => t.code === current) ?? tabs[0];
  if (!tab) return null;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setCurrent(tabs[next].code);
    refs.current[next]?.focus();
  }

  return (
    <div className="overflow-hidden rounded-[16px] border border-line">
      <div role="tablist" aria-label="Reminder language" className="flex flex-wrap gap-1 bg-[#e9eff7] px-2.5 py-2">
        {tabs.map((t, i) => {
          const selected = t.code === tab.code;
          return (
            <button
              key={t.code}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.code}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              lang={t.code}
              onClick={() => setCurrent(t.code)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-[20px] px-3.5 text-[14px] font-bold ${selected ? "bg-white text-[#3d3bb8]" : "bg-transparent text-ink-2 hover:bg-white/60"}`}
            >
              {t.label}
              {t.needsTranslation ? (
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#a8400d]" title="Needs translation" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab.code}`} className="bg-white">
        {tab.needsTranslation ? (
          <div className="px-4 pt-3">
            <Pill tone="sun">Needs translation</Pill>
          </div>
        ) : null}
        <div lang={tab.needsTranslation ? "en" : tab.code} dir={tab.dir} className="px-4 py-3.5 text-[14px] leading-[1.6] text-ink">
          <p className="m-0 font-bold">{tab.subject}</p>
          <p className="m-0 mt-1">{tab.body}</p>
        </div>
        <p className="m-0 px-4 pb-3 text-[12px] leading-snug text-muted">{tab.note}</p>
      </div>
    </div>
  );
}
