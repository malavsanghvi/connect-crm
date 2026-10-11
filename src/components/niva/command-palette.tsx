"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { useStepUp } from "@/components/step-up";
import { buttonClass } from "@/components/ui";
import { browserFetch, runCommand } from "@/lib/assistant/client";
import {
  LEVEL_HINT,
  LEVEL_LABEL,
  areaLabel,
  buildPalette,
  buildRunInput,
  describeRun,
  flattenGroups,
  type PaletteItem,
} from "@/lib/assistant/palette";
import type { CommandInfo, CommandLevel } from "@/lib/assistant/protocol";

import { otherDialogOpen, trapTab } from "./focus";
import { type NivaApi, useNiva } from "./niva-context";
import { ResultCards } from "./result-cards";
import { Sparkle } from "./sparkle";
import { useModKey } from "./use-mod-key";

const LEVEL_BADGE: Record<CommandLevel, string> = {
  read: "bg-success-50 text-success-900",
  draft: "bg-navy-50 text-navy",
  confirm: "bg-saffron-50 text-brown",
  only_you: "bg-purple-50 text-purple-900",
};

const RUN_LABEL: Record<CommandLevel, string> = {
  read: "Show me",
  draft: "Prepare it",
  confirm: "Show what will happen",
  only_you: "Show me where",
};

type Mode =
  | { name: "list" }
  | { name: "form"; command: CommandInfo; values: Record<string, string>; errors: Record<string, string> }
  | { name: "running"; command: CommandInfo }
  | { name: "result"; command: CommandInfo; asked: string; title: string; data: unknown; text?: string }
  | { name: "error"; command: CommandInfo; input: Record<string, unknown>; error: string };

type Row = PaletteItem | { kind: "ask"; id: string; text: string };

const optionIdFor = (listId: string, row: Row) => `${listId}-${row.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** The ⌘K palette. Works with no AI key: it only uses the command list the server gave. Renders nothing while closed. */
export function CommandPalette() {
  const niva = useNiva();
  if (!niva || !niva.enabled || !niva.paletteOpen) return null;
  return <PaletteDialog niva={niva} />;
}

function LevelBadge({ level }: { level: CommandLevel }) {
  return (
    <span title={LEVEL_HINT[level]} className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold ${LEVEL_BADGE[level]}`}>
      {LEVEL_LABEL[level]}
    </span>
  );
}

function PaletteDialog({ niva }: { niva: NivaApi }) {
  const router = useRouter();
  const stepUp = useStepUp();
  const modKey = useModKey();
  const listId = useId();
  const inputId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const [query, setQuery] = useState(niva.paletteQuery);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<Mode>({ name: "list" });
  const close = niva.closePalette;

  const groups = useMemo(() => buildPalette(niva.commands, niva.nav, query), [niva.commands, niva.nav, query]);
  const rows = useMemo<Row[]>(() => {
    const list: Row[] = flattenGroups(groups);
    const text = query.trim();
    if (niva.aiReady && text.length >= 3) list.push({ kind: "ask", id: "ask", text });
    return list;
  }, [groups, query, niva.aiReady]);
  const activeIndex = Math.min(active, Math.max(0, rows.length - 1));
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const optionId = (row: Row) => optionIdFor(listId, row);

  // Opening moves focus in; closing gives it back. The page behind does not scroll.
  useEffect(() => {
    const opener = document.activeElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) opener.focus();
    };
  }, []);

  // Each screen of the palette puts focus where typing or reading starts.
  useEffect(() => {
    if (mode.name === "list") inputRef.current?.focus();
    else if (mode.name === "form") dialogRef.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    else resultRef.current?.focus();
  }, [mode.name]);

  useEffect(() => {
    if (mode.name !== "list") return;
    const row = rows[activeIndex];
    if (row) document.getElementById(optionIdFor(listId, row))?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, rows, mode.name, listId]);

  async function execute(command: CommandInfo, input: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setMode({ name: "running", command });
    try {
      let res = await runCommand(browserFetch, { key: command.key, input });
      if (!res.ok && res.needsStepUp && stepUp) {
        // The security code is asked for in its own window, then the command runs once more.
        if (await stepUp.request(command.title)) res = await runCommand(browserFetch, { key: command.key, input });
      }
      if (!res.ok) {
        setMode({ name: "error", command, input, error: res.error });
        return;
      }
      const asked = describeRun(command, input);
      if (res.kind === "proposal") {
        // Something that needs the person's OK lives in the panel, where the confirmation card keeps its state.
        niva.showProposal({ asked, proposal: res.proposal });
        return;
      }
      setMode({ name: "result", command, asked, title: res.title || command.title, data: res.data, text: res.text });
    } finally {
      inFlight.current = false;
    }
  }

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.kind === "go") {
      close();
      router.push(row.href);
    } else if (row.kind === "ask") {
      niva.ask(row.text);
    } else if (row.command.fields.length === 0) {
      void execute(row.command, {});
    } else {
      setMode({ name: "form", command: row.command, values: {}, errors: {} });
    }
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      choose(rows[activeIndex]);
    }
  }

  function onDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !otherDialogOpen()) {
      e.stopPropagation();
      close();
      return;
    }
    trapTab(e, dialogRef.current);
  }

  function submitForm(e: FormEvent) {
    e.preventDefault();
    if (mode.name !== "form") return;
    const built = buildRunInput(mode.command.fields, mode.values);
    if (!built.ok) {
      setMode({ ...mode, errors: built.errors });
      dialogRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    void execute(mode.command, built.input);
  }

  const hasMatches = rows.length > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[55] flex items-start justify-center bg-[rgba(20,18,14,0.5)] p-4 pt-[10vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onDialogKeyDown}
        className="flex max-h-[75vh] w-[620px] max-w-full flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--shadow-menu)]"
      >
        <h2 id={titleId} className="sr-only">
          Commands and pages
        </h2>

        {mode.name === "list" ? (
          <>
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-3">
              <span className="text-saffron">
                <Sparkle className="h-5 w-5" />
              </span>
              <label htmlFor={inputId} className="sr-only">
                Search commands and pages
              </label>
              <input
                id={inputId}
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={hasMatches}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={rows[activeIndex] ? optionId(rows[activeIndex]) : undefined}
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Type a command or a page…"
                className="min-h-[40px] flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
              />
              <button type="button" onClick={close} aria-label="Close the command list" className="cc-drawer-close">
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div id={listId} role="listbox" aria-label="Commands and pages" className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {!hasMatches ? (
                <p className="px-3 py-4 text-[13px] text-muted">
                  Nothing matches “{query.trim()}”. {niva.aiReady ? "Type a few more words to ask Niva instead." : "Try a shorter word."}
                </p>
              ) : null}
              {groups.map((g) => (
                <div key={g.key} role="group" aria-labelledby={`${listId}-g-${g.key}`}>
                  <p id={`${listId}-g-${g.key}`} className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                    {g.label}
                  </p>
                  {g.items.map((item) => {
                    const i = indexById.get(item.id) ?? -1;
                    return (
                      <div
                        key={item.id}
                        id={optionId(item)}
                        role="option"
                        aria-selected={i === activeIndex}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(item)}
                        className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 ${i === activeIndex ? "bg-navy-50" : ""}`}
                      >
                        {item.kind === "command" ? (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ink">{item.command.title}</span>
                              <span className="line-clamp-1 block text-xs text-muted">{item.command.description}</span>
                            </span>
                            <LevelBadge level={item.command.level} />
                          </>
                        ) : item.kind === "go" ? (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{item.label}</span>
                            <span className="block text-xs text-muted">Open this page</span>
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {rows.some((r) => r.kind === "ask") ? (
                <div role="group" aria-label="Ask Niva">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Ask Niva</p>
                  {rows.map((row, i) =>
                    row.kind === "ask" ? (
                      <div
                        key={row.id}
                        id={optionId(row)}
                        role="option"
                        aria-selected={i === activeIndex}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(row)}
                        className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 ${i === activeIndex ? "bg-navy-50" : ""}`}
                      >
                        <span className="text-saffron">
                          <Sparkle />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">Ask Niva: {row.text}</span>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
            <p className="border-t border-line-soft px-4 py-2 text-[11px] text-muted">
              Up and down to move · Enter to choose · Esc to close · {modKey}+J opens Niva
              {niva.aiReady ? "" : " · Chat is not switched on yet, but every command here still works"}
            </p>
          </>
        ) : null}

        {mode.name === "form" ? (
          <form onSubmit={submitForm} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4" noValidate>
            <div>
              <button type="button" onClick={() => setMode({ name: "list" })} className="crm-link text-xs font-semibold">
                ← All commands
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-[20px] font-semibold leading-tight text-ink">{mode.command.title}</h3>
                <LevelBadge level={mode.command.level} />
              </div>
              <p className="mt-0.5 text-[13px] text-muted">{mode.command.description}</p>
              <p className="mt-0.5 text-xs text-muted">
                {areaLabel(mode.command.area)} · {LEVEL_HINT[mode.command.level]}
              </p>
            </div>
            {mode.command.fields.map((f) => {
              const id = `${inputId}-f-${f.name}`;
              const err = mode.errors[f.name];
              const common = {
                id,
                value: mode.values[f.name] ?? "",
                "aria-invalid": err ? true : undefined,
                "aria-describedby": err ? `${id}-err` : undefined,
                className: "min-h-[40px] w-full rounded-[10px] border border-line-input bg-white px-3 text-[13px] text-ink",
              };
              const set = (v: string) => setMode({ ...mode, values: { ...mode.values, [f.name]: v }, errors: { ...mode.errors, [f.name]: "" } });
              return (
                <div key={f.name}>
                  <label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-ink">
                    {f.label}
                    {f.required ? null : <span className="font-normal text-muted"> (optional)</span>}
                  </label>
                  {f.type === "choice" ? (
                    <select {...common} onChange={(e) => set(e.target.value)}>
                      <option value="">{f.required ? "Choose…" : "Any"}</option>
                      {(f.choices ?? []).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      inputMode={f.type === "number" ? "decimal" : undefined}
                      step={f.type === "number" ? "any" : undefined}
                      autoComplete="off"
                      onChange={(e) => set(e.target.value)}
                    />
                  )}
                  {err ? (
                    <p id={`${id}-err`} role="alert" className="mt-1 text-[13px] font-semibold text-danger">
                      {err}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button type="button" onClick={() => setMode({ name: "list" })} className={buttonClass("ghost", "sm")}>
                Back
              </button>
              <button type="submit" className={buttonClass("primary", "sm")}>
                {RUN_LABEL[mode.command.level]}
              </button>
            </div>
          </form>
        ) : null}

        {mode.name === "running" ? (
          <div ref={resultRef} tabIndex={-1} role="status" className="flex items-center gap-2 p-6 text-[14px] text-muted outline-none">
            <span className="h-2 w-2 rounded-full bg-saffron motion-safe:animate-pulse" aria-hidden="true" />
            Working on “{mode.command.title}”…
          </div>
        ) : null}

        {mode.name === "result" ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
            <div ref={resultRef} tabIndex={-1} className="outline-none">
              <h3 className="font-display text-[20px] font-semibold leading-tight text-ink">{mode.command.title}</h3>
              {mode.text ? <p className="mt-1 text-[13px] text-ink-2">{mode.text}</p> : null}
            </div>
            <ResultCards title={mode.title} data={mode.data} onNavigate={close} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setMode({ name: "list" })} className={buttonClass("ghost", "sm")}>
                Back to commands
              </button>
              <button
                type="button"
                onClick={() => niva.showResult({ asked: mode.asked, command: mode.command.key, title: mode.title, data: mode.data, text: mode.text })}
                className={buttonClass("primary", "sm")}
              >
                Keep this in the Niva panel
              </button>
            </div>
          </div>
        ) : null}

        {mode.name === "error" ? (
          <div className="flex flex-col gap-3 p-4">
            <div ref={resultRef} tabIndex={-1} className="outline-none">
              <h3 className="font-display text-[20px] font-semibold leading-tight text-ink">{mode.command.title}</h3>
            </div>
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {mode.error}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setMode({ name: "list" })} className={buttonClass("ghost", "sm")}>
                Back to commands
              </button>
              <button type="button" onClick={() => void execute(mode.command, mode.input)} className={buttonClass("primary", "sm")}>
                Try again
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
