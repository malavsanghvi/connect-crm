"use client";

import { useEffect, useRef, useState } from "react";

import { searchPeopleAction } from "@/app/(app)/events/people-search";
import { buttonClass } from "@/components/ui";

type Option = { id: string; name: string; detail: string | null };

const NONE: Option[] = [];

/**
 * Search people and pick one (or several). Submits hidden inputs named `name`.
 * Only people the signed-in user may see (RLS) are found.
 */
export function PersonPicker({
  name,
  label,
  multiple = false,
  initial = NONE,
  hint,
  required,
  placeholder = "Type a name, email or phone",
}: {
  name: string;
  label: string;
  multiple?: boolean;
  initial?: Option[];
  hint?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [picked, setPicked] = useState<Option[]>(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Option[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const seq = useRef(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const inputId = `pp-${name}`;

  // Clear the selection when the surrounding form is reset (after a successful create).
  useEffect(() => {
    const form = wrapper.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setPicked(initial);
      setQuery("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [initial]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setState("loading");
      try {
        const res = await searchPeopleAction(q);
        if (mine !== seq.current) return;
        if (!res.ok) {
          setError(res.error);
          setState("error");
          return;
        }
        setResults(res.data ?? []);
        setError(null);
        setState("idle");
      } catch (e) {
        if (mine !== seq.current) return;
        console.error("[person-picker] search failed:", e);
        setError("Could not search people — the server did not respond. Check your connection.");
        setState("error");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, attempt]);

  function choose(o: Option) {
    setPicked((cur) => (multiple ? (cur.some((c) => c.id === o.id) ? cur : [...cur, o]) : [o]));
    setQuery("");
    setResults([]);
  }

  const showResults = query.trim().length >= 2;

  return (
    <div ref={wrapper}>
      <label htmlFor={inputId} className="crm-label">
        {label}
      </label>
      {picked.map((p) => (
        <input key={p.id} type="hidden" name={name} value={p.id} />
      ))}
      {picked.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {picked.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1 rounded-full border border-navy bg-navy-50 py-0.5 pl-3 pr-1 text-[13px]">
              <span className="font-bold text-navy">{p.name}</span>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-white"
                onClick={() => setPicked((cur) => cur.filter((c) => c.id !== p.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {multiple || picked.length === 0 ? (
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="crm-input"
          required={required && picked.length === 0}
          autoComplete="off"
        />
      ) : null}
      {hint ? <p className="crm-hint">{hint}</p> : null}
      {showResults && state === "loading" ? <p className="crm-hint">Searching…</p> : null}
      {showResults && state === "error" ? (
        <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {error}
          <button type="button" className={buttonClass("bad", "xs")} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </p>
      ) : null}
      {showResults && state === "idle" ? (
        <ul className="mt-1 max-h-64 overflow-y-auto rounded-[10px] border border-line bg-white">
          {results.length === 0 ? <li className="px-3 py-2 text-[13px] text-muted">No one found that you&apos;re allowed to see.</li> : null}
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => choose(r)} className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-navy-50">
                <span className="text-[13px] font-bold">{r.name}</span>
                {r.detail ? <span className="text-xs text-muted">{r.detail}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
