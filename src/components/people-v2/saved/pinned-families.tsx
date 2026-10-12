"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PinnedFamilyCard } from "@/lib/people-v2/home-model";

import { attempt, useSavedActions } from "./saved-actions";

// The families the person pinned, on the People home above the recent ones: each card is the household card line (a family is never shown
// by name alone) and opens the family. "Unpin" removes only the pin. A pin is the person's own, so nobody else sees it. Each family is read
// again under the person's own access every time, so a family they can no longer see is simply not drawn (the page says how many).

const CARD = "rounded-[18px] border border-line bg-white";

export function PinnedFamilies({ pins, hidden, loadError }: { pins: PinnedFamilyCard[]; hidden: number; /** The pins could not be read: said in words, never an empty strip that looks like "none". */ loadError?: string | null }) {
  const actions = useSavedActions();
  const router = useRouter();
  const [items, setItems] = useState(pins);
  const [seen, setSeen] = useState(pins);
  if (pins !== seen) {
    setSeen(pins);
    setItems(pins);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function unpin(card: PinnedFamilyCard) {
    setBusy(card.id);
    setError(null);
    const res = await attempt("unpin the family", () => actions.pin({ householdId: card.householdId, pinned: false }));
    setBusy(null);
    if (!res.ok) {
      setError({ id: card.id, message: res.error });
      return;
    }
    setItems((list) => list.filter((x) => x.id !== card.id));
    router.refresh();
  }

  if (loadError) {
    return (
      <p role="alert" className="m-0 text-[13px] text-danger">
        Could not load your pinned families — {loadError}{" "}
        <Link href="/people" className="font-semibold text-navy">
          Try again
        </Link>
      </p>
    );
  }
  if (items.length === 0 && hidden === 0) {
    return <p className="m-0 rounded-[14px] border border-dashed border-line-input px-4 py-5 text-[13px] text-muted">Pin a family with the star at the top of its page, and it stays here, one click away. Only you see your pins.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 grid list-none grid-flow-col auto-cols-[minmax(240px,80%)] gap-3 overflow-x-auto p-0 pb-1 md:grid-flow-row md:auto-cols-auto md:grid-cols-2 md:overflow-visible xl:grid-cols-3">
        {items.map((p) => (
          <li key={p.id} className={`${CARD} relative flex flex-col`}>
            <Link href={p.href} className="block flex-1 rounded-[18px] px-4 pb-2 pt-3 no-underline hover:bg-ground">
              <span dir="auto" className="block truncate pr-9 text-[15px] font-bold text-ink">
                <span aria-hidden="true" className="mr-1.5 text-[var(--v2-sun-ink)]">
                  ★
                </span>
                {p.title}
              </span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{p.cardLine}</span>
            </Link>
            <button
              type="button"
              onClick={() => void unpin(p)}
              disabled={busy === p.id}
              aria-label={`Unpin ${p.title}, ${p.cardLine}`}
              title="Unpin this family"
              className="absolute right-1 top-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[15px] text-muted hover:bg-white hover:text-ink disabled:opacity-60"
            >
              <span aria-hidden="true">{busy === p.id ? "…" : "×"}</span>
            </button>
            {error?.id === p.id ? (
              <p role="alert" className="m-0 px-4 pb-3 text-[13px] text-danger">
                {error.message}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="m-0 text-[12px] text-muted">
          {hidden === 1 ? "1 pinned family is not shown: it was merged into another, or you can no longer see it." : `${hidden} pinned families are not shown: they were merged into others, or you can no longer see them.`}
        </p>
      ) : null}
    </div>
  );
}
