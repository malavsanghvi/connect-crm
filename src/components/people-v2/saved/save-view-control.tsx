"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { attempt, useSavedActions } from "./saved-actions";

// "Save this view" on a list: a small name field, prefilled with what the list is ("Adults with no email"), that saves the list's filters
// and sort for this person. Only the person sees it; a typed search is not saved (it can be a name). Saved only when the write worked:
// a failure is shown in words next to the field, with the reason, and the field keeps what was typed.

export function SaveViewControl({
  list,
  params,
  sort,
  suggested,
  blockedReason,
}: {
  list: "households" | "people";
  /** The filters as the address holds them (the typed search is dropped before saving). */
  params: Record<string, string>;
  sort: string | null;
  suggested: string;
  /** Why saving is not possible right now (no filter yet), said in words next to the button. */
  blockedReason: string | null;
}) {
  const actions = useSavedActions();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const id = useId();

  async function save() {
    setBusy(true);
    setError(null);
    const res = await attempt("save the view", () => actions.save({ name, list, params, sort }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setDone(`Saved “${res.data?.name ?? name.trim()}”.`);
    router.refresh();
  }

  if (open) {
    return (
      <form
        className="flex w-full flex-col gap-2 rounded-2xl border border-line bg-white p-3 sm:w-[22rem]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <label htmlFor={id} className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted">
          Name this view
        </label>
        <input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} dir="auto" className="crm-input w-full" aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`} />
        <p id={`${id}-hint`} className="m-0 text-[12px] text-muted">
          Saves this list&apos;s filters and sort, not a typed search. Only you see it.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className="inline-flex min-h-11 items-center rounded-[22px] bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover disabled:opacity-60">
            {busy ? "Saving…" : "Save view"}
          </button>
          <button type="button" onClick={() => setOpen(false)} disabled={busy} className="inline-flex min-h-11 items-center rounded-[22px] border border-line-input bg-white px-4 text-[14px] font-bold text-ink">
            Cancel
          </button>
        </div>
        {error ? (
          <p id={`${id}-err`} role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={blockedReason !== null}
        aria-describedby={blockedReason ? `${id}-why` : undefined}
        onClick={() => {
          setName(suggested);
          setError(null);
          setDone(null);
          setOpen(true);
        }}
        className="inline-flex min-h-11 items-center rounded-[22px] border border-line-input bg-white px-[18px] text-[14px] font-bold text-ink hover:border-navy disabled:cursor-not-allowed disabled:text-faint disabled:hover:border-line-input"
      >
        Save this view
      </button>
      {blockedReason ? (
        <span id={`${id}-why`} className="max-w-[18rem] text-[12px] text-muted">
          {blockedReason}
        </span>
      ) : null}
      {done ? (
        <span role="status" className="max-w-[22rem] text-[13px] text-ink-2">
          {done}{" "}
          <Link href="/people#saved-views" className="font-semibold text-navy">
            See it under Saved views on the People home
          </Link>
        </span>
      ) : null}
    </span>
  );
}
