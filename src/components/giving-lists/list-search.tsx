"use client";

// The search of a Giving list: typing is free (no Enter needed); the address follows as ?q= a moment after the last key, so the
// list on the server answers and a search can be shared or reloaded. Nothing here moves money, so Enter only searches at once.

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

const WAIT_MS = 350;

/** `base`: the list's address without ?q= and ?page= (the chips chosen stay chosen). `compact`: the size of the one-line toolbar. */
export function ListSearch({ label, initial, base, compact = false }: { label: string; initial: string; base: string; compact?: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const timer = useRef<number | null>(null);
  const id = useId();

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  function go(text: string) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const t = text.trim().slice(0, 120);
    const href = t ? `${base}${base.includes("?") ? "&" : "?"}q=${encodeURIComponent(t)}` : base;
    start(() => router.replace(href, { scroll: false }));
  }

  return (
    <div className={`relative w-full ${compact ? "md:w-[280px]" : "md:max-w-[520px]"}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={label}
        autoComplete="off"
        enterKeyHint="search"
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => go(v), WAIT_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            go(value);
          }
        }}
        className={`crm-input w-full pr-10 ${compact ? "min-h-[38px] text-[14px]" : "min-h-[44px] text-[15px]"}`}
      />
      {pending ? (
        <span role="status" className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">
          Searching…
        </span>
      ) : null}
    </div>
  );
}
