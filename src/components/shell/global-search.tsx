"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";

import { globalSearchAction } from "@/app/(app)/search/actions";
import { GLOBAL_SEARCH_MIN_CHARS, normalizeSearchQuery, type GlobalSearchResult } from "@/lib/global-search";

type State =
  | { status: "idle" }
  | { status: "results"; query: string; results: GlobalSearchResult[] }
  | { status: "error"; message: string };

/**
 * The top-bar search pill. Searches households and people as you type
 * (after 2 characters, 250ms pause); results open the record. Failures are
 * shown in the dropdown in plain English, never swallowed.
 */
export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pending, startTransition] = useTransition();
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function search(value: string) {
    const q = normalizeSearchQuery(value);
    const mine = ++seq.current;
    if (!q) {
      setState({ status: "idle" });
      return;
    }
    startTransition(async () => {
      try {
        const res = await globalSearchAction(q);
        if (mine !== seq.current) return; // a newer search is on its way
        if (!res.ok) {
          setState({ status: "error", message: res.error });
          return;
        }
        setState({ status: "results", query: q, results: res.data ?? [] });
        setActive(-1);
      } catch (err) {
        console.error("[global-search] search failed:", err);
        if (mine !== seq.current) return;
        setState({ status: "error", message: "Could not search — the server did not respond. Try again." });
      }
    });
  }

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  function onChange(value: string) {
    setQuery(value);
    setOpen(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search(value), 250);
  }

  const results = state.status === "results" ? state.results : [];

  function go(r: GlobalSearchResult) {
    setOpen(false);
    router.push(r.href);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (debounce.current) clearTimeout(debounce.current);
      const pick = results[active >= 0 ? active : 0];
      if (pick && state.status === "results" && state.query === normalizeSearchQuery(query)) go(pick);
      else search(query);
    }
  }

  const showBox = open && (normalizeSearchQuery(query) !== null || state.status === "error");
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div ref={boxRef} className="relative w-full max-w-[460px]" role="search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search households and people
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showBox}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        placeholder="Search households, people, member numbers…"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="cc-search"
      />
      {showBox ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-[var(--shadow-menu)]"
        >
          {state.status === "error" ? (
            <p role="alert" className="px-3 py-2.5 text-[13px] text-danger">
              {state.message}
            </p>
          ) : pending || state.status === "idle" || state.query !== normalizeSearchQuery(query) ? (
            <p className="px-3 py-2.5 text-[13px] text-faint">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-[13px] text-faint">No household or person matches “{state.query}”.</p>
          ) : (
            results.map((r, i) => (
              <Link
                key={`${r.kind}-${r.id}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                href={r.href}
                onClick={() => setOpen(false)}
                onMouseEnter={() => setActive(i)}
                className={`flex items-start gap-3 rounded-[10px] px-3 py-2 text-left no-underline ${i === active ? "bg-navy-50" : ""}`}
              >
                <span
                  className={`mt-0.5 w-[74px] shrink-0 rounded-lg py-[3px] text-center text-[11px] font-bold text-white ${r.kind === "household" ? "bg-navy" : "bg-purple"}`}
                >
                  {r.kind === "household" ? "Household" : "Person"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted">{r.detail}</span>
                </span>
              </Link>
            ))
          )}
          {normalizeSearchQuery(query) === null && state.status !== "error" ? (
            <p className="px-3 py-2.5 text-[13px] text-faint">Type at least {GLOBAL_SEARCH_MIN_CHARS} characters.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
