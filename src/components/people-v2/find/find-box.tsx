"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useGivingSheets } from "@/components/giving-actions/provider";
import { useNiva } from "@/components/niva/niva-context";
import { useModKey } from "@/components/niva/use-mod-key";
import { classifyInput, squeeze } from "@/lib/find/classify";
import type { FindScope } from "@/lib/find/giving";
import { buildUiRows, enterAction, moveActive, selectable } from "@/lib/find/rows";
import type { EnterAction, FindResponse, NivaState, UiRow } from "@/lib/find/types";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/global-search";

import { useFindSearch } from "./find-backend";
import { FindRows } from "./find-results";
import { registerFindInput } from "./focus-registry";
import { SearchIcon } from "./icons";
import { recordRecentFamily } from "./recent-cookie";

type Result = { query: string; data: FindResponse } | { query: string; error: string };

const PAUSE_MS = 200;

/**
 * THE find box. One behaviour in two sizes: "page" is the big box on the People home (focused on arrival), "bar" is the one in the top
 * bar of every other page. Type a name in any script, phone digits, an email, a member number, any old or system ID: it shows families
 * and people, the best match first, each with its household card line and a tag that says why it matched. Enter opens the family (or a
 * person's family with their details open), the arrow keys move, Esc closes, Ctrl+K (or ⌘K) focuses it from anywhere.
 *
 * A question goes to Niva when Niva is on. When Niva is off the same words are offered as a list if the page's own reader understands
 * them, and otherwise the box says so. Nothing is looked up for fewer than two characters. Failures are said in words, never swallowed.
 *
 * Giving (docs/GIVING_REDESIGN.md section 4): "200 check patel" offers to record that payment (Enter opens the Record payment sheet
 * filled in; only the sheet's own button records), a receipt or pledge number or an amount finds it. On Giving pages (`scope`
 * "giving", from the address when not given) a family opens its giving in place instead of its page.
 */
export function FindBox({
  variant,
  cookieName,
  autoFocus = false,
  scope: scopeProp,
}: {
  variant: "page" | "bar";
  cookieName: string | null;
  autoFocus?: boolean;
  scope?: FindScope;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const scope: FindScope = scopeProp ?? (pathname === "/giving" || pathname?.startsWith("/giving/") ? "giving" : "people");
  const sheets = useGivingSheets();
  const search = useFindSearch();
  const niva = useNiva();
  const mod = useModKey();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nivaState: NivaState = !niva?.enabled ? "off" : niva.aiReady ? "on" : niva.aiOff ? "ai_off" : "no_key";
  const live = useRef({ niva, nivaState });
  useEffect(() => {
    live.current = { niva, nivaState };
  });

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const off = registerFindInput(el, variant === "page" ? 2 : 1);
    if (autoFocus) el.focus();
    return off;
  }, [variant, autoFocus]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const ui = useMemo(() => {
    if (!result || !("data" in result)) return null;
    return buildUiRows(result.data, { niva: nivaState, withPalette: !!niva?.enabled, shape: classifyInput(result.query).shape, scope });
  }, [result, nivaState, niva?.enabled, scope]);

  function perform(act: EnterAction) {
    if (act.type === "open") {
      recordRecentFamily(cookieName, act.familyId);
      setOpen(false);
      router.push(act.href);
    } else if (act.type === "niva") {
      setOpen(false);
      setText("");
      setResult(null);
      live.current.niva?.ask(act.text);
    } else if (act.type === "palette") {
      setOpen(false);
      live.current.niva?.openPalette(act.text);
    } else if (act.type === "record-payment") {
      // The sheet opens filled in; nothing is saved until its own button is pressed. Without the sheets (no Giving here), the screen.
      setOpen(false);
      if (sheets?.canRecord) sheets.openRecordPayment(act.request);
      else router.push(act.href);
    } else if (act.type === "record-pledge") {
      // The Record pledge sheet opens filled in (slice 7); nothing is saved until its own button is pressed.
      setOpen(false);
      if (sheets?.canRecordPledge) sheets.openRecordPledge(act.request);
      else router.push(act.href);
    } else if (act.type === "family-giving") {
      recordRecentFamily(cookieName, act.householdId);
      setOpen(false);
      if (sheets) sheets.openFamilyGiving(act.householdId, act.focus);
      else router.push(act.href);
    }
  }

  /** Look the text up now. When `then` is set the person pressed Enter before the answer was there: act on it when it arrives. */
  function run(value: string, then: { shift: boolean } | null) {
    const q = squeeze(value);
    const mine = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    if (q.length < GLOBAL_SEARCH_MIN_CHARS) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    search(q, { scope })
      .then((res) => {
        if (mine !== seq.current) return; // a newer look-up is on its way
        setLoading(false);
        if (!res.ok) {
          setResult({ query: q, error: res.error });
          return;
        }
        setResult({ query: q, data: res.data });
        setActive(0);
        if (then) {
          const { nivaState: state, niva: n } = live.current;
          const built = buildUiRows(res.data, { niva: state, withPalette: !!n?.enabled, shape: classifyInput(q).shape, scope });
          perform(enterAction(built.rows, 0, { shift: then.shift, niva: state, typed: q, scope }));
        }
      })
      .catch((error: unknown) => {
        console.error("[find] the look-up did not complete:", error);
        if (mine !== seq.current) return;
        setLoading(false);
        setResult({ query: q, error: "Could not search — the server did not respond. Check your connection and try again." });
      });
  }

  function onChange(value: string) {
    setText(value);
    setOpen(true);
    setActive(0);
    if (timer.current) clearTimeout(timer.current);
    if (squeeze(value).length < GLOBAL_SEARCH_MIN_CHARS) {
      seq.current += 1;
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => run(value, null), PAUSE_MS);
  }

  const typed = squeeze(text);
  const fresh = !!result && result.query === typed && !loading;
  const rows: readonly UiRow[] = fresh && ui ? ui.rows : [];
  const count = selectable(rows).length;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (count === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => moveActive(i, count, e.key as "ArrowDown" | "ArrowUp"));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (typed.length < GLOBAL_SEARCH_MIN_CHARS) return;
      if (fresh && ui) perform(enterAction(ui.rows, active, { shift: e.shiftKey, niva: nivaState, typed, scope }));
      else run(text, { shift: e.shiftKey });
    } else if (e.key === "Escape") {
      if (open && (typed || result)) setOpen(false);
      else if (text) {
        setText("");
        setResult(null);
      } else inputRef.current?.blur();
    }
  }

  const showList = open && typed.length > 0;
  const failed = result && "error" in result && result.query === typed ? result.error : null;
  const best = fresh && ui ? selectable(ui.rows)[0] : null;
  const announce =
    fresh && ui
      ? count === 0
        ? "No matches."
        : `${count} ${count === 1 ? "result" : "results"}.${best && (best.type === "family" || best.type === "person") ? ` Best: ${best.row.title}.` : ""}`
      : "";
  const page = variant === "page";

  return (
    <div ref={boxRef} role="search" data-find-bar={page ? undefined : ""} className={`relative w-full ${page ? "" : "max-w-[560px]"}`}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        {scope === "giving"
          ? "Find a family, a receipt or pledge number or an amount, or say what you received, like 200 check patel"
          : "Find a family or a person: a name, phone number, email, member number or any ID"}
      </label>
      <div className={`flex items-center gap-3 border border-line-control bg-white focus-within:border-navy focus-within:ring-2 focus-within:ring-navy/30 ${page ? "min-h-[60px] rounded-[30px] pl-5 pr-4 shadow-sm" : "min-h-[40px] rounded-window bg-canvas pl-3.5 pr-3"}`}>
        <span className="text-muted">
          <SearchIcon size={page ? 22 : 18} />
        </span>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && fresh && count > 0 && active >= 0 ? `${listId}-o-${active}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={
            scope === "giving"
              ? page
                ? "A family, a receipt number, an amount, or what you received: 200 check patel"
                : "Family, receipt, amount, or 200 check patel"
              : page
                ? "A name, a phone number, an email, a member number, any old ID, or a question"
                : "Find a family or person: name, phone, email, any ID"
          }
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none! placeholder:text-muted ${page ? "py-3 text-[18px]" : "py-2 text-[14px]"}`}
        />
        <kbd className="hidden shrink-0 rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline" title={`Press ${mod} K from anywhere`}>
          {mod} K
        </kbd>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {showList ? (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 rounded-window border border-line bg-white shadow-[var(--shadow-menu)]">
          {failed ? (
            <div className="flex flex-wrap items-center gap-3 p-4" role="alert">
              <p className="m-0 flex-1 text-[13px] text-danger">{failed}</p>
              <button type="button" onClick={() => run(text, null)} className="min-h-9 rounded-[18px] border border-line px-3.5 text-[13px] font-bold text-navy">
                Try again
              </button>
            </div>
          ) : !fresh || !ui ? (
            <p role="status" className="m-0 px-4 py-3 text-[13px] text-muted">
              {typed.length < GLOBAL_SEARCH_MIN_CHARS ? `Type at least ${GLOBAL_SEARCH_MIN_CHARS} characters.` : "Looking…"}
            </p>
          ) : (
            <FindRows
              listId={listId}
              rows={ui.rows}
              active={active}
              understood={ui.understood}
              inPlace={scope === "giving"}
              onHover={(i) => i >= 0 && setActive(i)}
              onPick={(row) => {
                if (row.type === "family") recordRecentFamily(cookieName, row.row.id);
                else if (row.type === "person") recordRecentFamily(cookieName, row.row.householdId);
                const inPlace = row.type === "giving" || (scope === "giving" && (row.type === "family" || row.type === "person"));
                if (row.type === "niva" || row.type === "palette" || inPlace) perform(enterAction([row], 0, { scope }));
                else setOpen(false);
              }}
              hints={
                <>
                  <span>
                    <kbd className="rounded border border-line bg-canvas px-1 font-mono">↑</kbd> <kbd className="rounded border border-line bg-canvas px-1 font-mono">↓</kbd> move
                  </span>
                  <span>
                    <kbd className="rounded border border-line bg-canvas px-1 font-mono">Enter</kbd> {scope === "giving" ? "opens it" : "opens the family"}
                  </span>
                  {nivaState === "on" ? (
                    <span>
                      <kbd className="rounded border border-line bg-canvas px-1 font-mono">Shift</kbd>+<kbd className="rounded border border-line bg-canvas px-1 font-mono">Enter</kbd> asks Niva
                    </span>
                  ) : null}
                  <span>
                    <kbd className="rounded border border-line bg-canvas px-1 font-mono">Esc</kbd> closes
                  </span>
                </>
              }
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
