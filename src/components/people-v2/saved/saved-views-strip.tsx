"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import type { SavedViewItem } from "@/lib/people-v2/home-model";

import { attempt, useSavedActions } from "./saved-actions";

// The Saved views strip on the People home: the view everyone has (memberships ending soon), a first place to start (adults with no email),
// and the person's OWN views, each with a way to rename or delete it. A saved view is the person's own: nobody else sees it, and deleting
// one removes only the view, never a family or a person (the confirmation says so). Every write says in words what happened; a write that
// failed is shown next to the view it was for, with the reason, and the view stays as it was.

const CHIP = "inline-flex min-h-11 items-center gap-1.5 rounded-[22px] border bg-white px-4 text-[13px] font-bold text-ink no-underline";
const SMALL_BTN = "inline-flex min-h-11 items-center rounded-[22px] px-3 text-[13px] font-bold";

type Mode = "idle" | "options" | "rename" | "delete";

export function SavedViewsStrip({
  endingSoon,
  contactGapHref,
  views,
  max,
  loadError,
}: {
  endingSoon: { count: number | null; href: string } | null;
  contactGapHref: string;
  views: SavedViewItem[];
  max: number;
  /** The views could not be read: said in words, and no empty strip that looks like "none". */
  loadError?: string | null;
}) {
  const [items, setItems] = useState(views);
  const [seen, setSeen] = useState(views);
  if (views !== seen) {
    setSeen(views);
    setItems(views);
  }
  const [status, setStatus] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {endingSoon ? (
          <Link href={endingSoon.href} title="Active memberships that end soon" className={`${CHIP} border-line hover:border-navy`}>
            Memberships ending soon{endingSoon.count === null ? "" : ` · ${endingSoon.count}`}
          </Link>
        ) : null}
        <Link href={contactGapHref} title="Adults whose record has no email address" className={`${CHIP} border-line hover:border-navy`}>
          Adults with no email
        </Link>
        {items.map((v) => (
          <ViewChip
            key={v.id}
            view={v}
            onRenamed={(name) => {
              setItems((list) => list.map((x) => (x.id === v.id ? { ...x, name } : x)));
              setStatus(`Renamed to “${name}”.`);
            }}
            onDeleted={() => {
              setItems((list) => list.filter((x) => x.id !== v.id));
              setStatus(`Deleted “${v.name}”. Only your saved view is gone: no family or person was changed.`);
            }}
          />
        ))}
      </div>
      {loadError ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not load your saved views — {loadError} Reload the page to try again.
        </p>
      ) : items.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">
          Your own saved views show up here. Open a list (Lists, then All families or All people), add a filter, and press Save this view. Only you see them.
        </p>
      ) : (
        <p className="m-0 text-[12px] text-muted">
          {items.length} of {max} saved views. Only you see them.
        </p>
      )}
      <p role="status" aria-live="polite" className="m-0 min-h-0 text-[13px] text-ink-2">
        {status}
      </p>
    </div>
  );
}

function ViewChip({ view, onRenamed, onDeleted }: { view: SavedViewItem; onRenamed: (name: string) => void; onDeleted: () => void }) {
  const actions = useSavedActions();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [name, setName] = useState(view.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    setMode("idle");
    setError(null);
    setName(view.name);
  };

  async function rename() {
    setBusy(true);
    setError(null);
    const res = await attempt("rename the view", () => actions.rename({ id: view.id, name }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const saved = res.data?.name ?? name.trim();
    setMode("idle");
    onRenamed(saved);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const res = await attempt("delete the view", () => actions.remove({ id: view.id }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMode("idle");
    onDeleted();
    router.refresh();
  }

  if (mode === "rename") {
    return (
      <form
        className="flex w-full flex-col gap-2 rounded-2xl border border-line bg-white p-3 sm:w-auto sm:min-w-[22rem]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void rename();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <label htmlFor={inputId} className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">
          New name for this view
        </label>
        <input id={inputId} ref={input} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" className="crm-input w-full" aria-describedby={error ? `${inputId}-err` : undefined} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className={`${SMALL_BTN} bg-navy text-white hover:bg-navy-hover disabled:opacity-60`}>
            {busy ? "Saving…" : "Save name"}
          </button>
          <button type="button" onClick={close} disabled={busy} className={`${SMALL_BTN} border border-line-input bg-white text-ink`}>
            Cancel
          </button>
        </div>
        {error ? (
          <p id={`${inputId}-err`} role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (mode === "delete") {
    return (
      <div className="flex w-full flex-col gap-2 rounded-2xl border border-danger/30 bg-danger-50 p-3 sm:w-auto sm:max-w-[26rem]" role="group" aria-label={`Delete the saved view ${view.name}`}>
        <p className="m-0 text-[14px] text-ink">
          Delete the saved view <strong dir="auto">“{view.name}”</strong>? Only this view is removed: no family or person is changed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void remove()} disabled={busy} className={`${SMALL_BTN} bg-danger text-white disabled:opacity-60`}>
            {busy ? "Deleting…" : "Delete view"}
          </button>
          <button type="button" onClick={close} disabled={busy} className={`${SMALL_BTN} border border-line-input bg-white text-ink`}>
            Keep it
          </button>
        </div>
        {error ? (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center rounded-[22px] border border-line bg-white">
        <Link href={view.href} title={view.summary || undefined} dir="auto" className="inline-flex min-h-11 items-center rounded-l-[22px] pl-4 pr-2 text-[13px] font-bold text-ink no-underline hover:bg-ground">
          {view.name}
        </Link>
        <button
          type="button"
          aria-expanded={mode === "options"}
          aria-label={`Rename or delete the saved view ${view.name}`}
          onClick={() => setMode(mode === "options" ? "idle" : "options")}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-r-[22px] pr-1 text-[16px] font-bold leading-none text-muted hover:bg-ground hover:text-ink"
        >
          <span aria-hidden="true">⋯</span>
        </button>
      </span>
      {mode === "options" ? (
        <>
          <button type="button" onClick={() => setMode("rename")} className={`${SMALL_BTN} border border-line-input bg-white text-ink hover:border-navy`}>
            Rename
          </button>
          <button type="button" onClick={() => setMode("delete")} className={`${SMALL_BTN} border border-line-input bg-white text-danger hover:border-danger`}>
            Delete
          </button>
        </>
      ) : null}
      {error && mode === "idle" ? (
        <span role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
