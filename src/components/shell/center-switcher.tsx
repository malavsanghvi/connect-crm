"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { switchCenterAction } from "@/app/tenancy-actions";

export type SwitcherCenter = { slug: string; name: string; environment: string; status: string };

/**
 * The top bar's center pill, as a menu when the user works with more than one
 * organization (docs/ONBOARDING_PLAN.md §7). Choosing one reloads the whole
 * portal for it: its address when it has one, otherwise the same address with
 * the choice remembered.
 */
export function CenterSwitcher({
  current,
  centers,
  platformLink,
}: {
  current: { slug: string; name: string };
  centers: SwitcherCenter[];
  platformLink: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (slug: string, name: string) => {
    setError(null);
    setPendingSlug(slug);
    startTransition(async () => {
      try {
        const res = await switchCenterAction(slug);
        if (!res.ok) {
          setError(res.error);
          setPendingSlug(null);
          return;
        }
        // A full load, so every part of the portal is read again for the new organization.
        window.location.assign(res.data?.url ?? "/");
      } catch (err) {
        console.error("[switcher] switching failed:", err);
        setError(`Could not switch to ${name} — the portal could not be reached. Check your connection and try again.`);
        setPendingSlug(null);
      }
    });
  };

  return (
    <div ref={box} className="relative hidden shrink-0 sm:block">
      <button
        type="button"
        className="cc-center-pill cursor-pointer"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="center-switcher"
      >
        Center: {current.name} ▾
      </button>
      {open ? (
        <div role="menu" aria-label="Switch community" className="absolute left-0 top-[calc(100%+6px)] z-50 w-80 rounded-[12px] border border-line bg-white p-1.5 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Switch community</p>
          {centers.map((c) => {
            const isCurrent = c.slug === current.slug;
            return (
              <button
                key={c.slug}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                disabled={isCurrent || pending}
                onClick={() => choose(c.slug, c.name)}
                className="flex min-h-11 w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[13px] hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{c.name}</span>
                  <span className="block font-mono text-[11px] text-muted">{c.slug}</span>
                </span>
                {c.environment === "sandbox" ? (
                  <span className="rounded-full bg-saffron-50 px-2 py-0.5 text-[11px] font-bold text-brown-900">Sandbox</span>
                ) : null}
                {isCurrent ? <span className="text-[12px] font-semibold text-muted">Current</span> : null}
                {pendingSlug === c.slug ? <span className="text-[12px] font-semibold text-muted">Opening…</span> : null}
              </button>
            );
          })}
          {platformLink ? (
            <Link href="/platform" className="mt-1 block rounded-[8px] border-t border-line px-2.5 py-2 text-[13px] font-semibold text-navy no-underline hover:bg-subtle">
              All centers (Platform)
            </Link>
          ) : null}
          {error ? (
            <p role="alert" className="m-1 rounded-[8px] border border-danger/30 bg-danger-50 px-2.5 py-2 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The sandbox watermark: a strip over the top bar and a corner label that stays in view. */
export function SandboxWatermark({ name }: { name: string }) {
  return (
    <>
      <div role="note" data-testid="sandbox-watermark" className="border-b border-saffron/40 bg-saffron-50 px-4 py-1.5 text-center text-[12px] font-semibold text-brown-900">
        Sandbox · test data — {name} is a practice copy. Messages reach only verified test recipients and payments run in test mode.
      </div>
      <div aria-hidden className="pointer-events-none fixed bottom-3 left-3 z-40 rounded-full border border-saffron/50 bg-saffron-50/95 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brown-900 shadow-sm">
        Sandbox · test data
      </div>
    </>
  );
}
