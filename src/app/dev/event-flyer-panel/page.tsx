import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { KindProvider } from "@/components/kind-context";
import { ToastProvider } from "@/components/toast";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

import { FIXTURES, PREVIEW_KINDS, isPreviewKind, sampleSetup } from "./fixtures";
import { PreviewFlyerPanel } from "./preview-client";

export const metadata: Metadata = { title: "Flyer and publish panel · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = ["draft", "scheduled", "live", "failed"] as const;
type State = (typeof STATES)[number];

/**
 * DEV ONLY. The event creator's flyer-first and publish panel for an invented event, without a database or a session:
 * `?kind=church|chamber|temple`, `?state=draft|scheduled|live|failed`. The flyer is really drawn by the server (the dev render
 * route); approving, publishing and scheduling only change this page's copy. Beside it, where the creator's question cards
 * go, a plain placeholder. Returns notFound() in production.
 */
export default async function EventFlyerPanelPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const kind = isPreviewKind(one(sp.kind)) ? (one(sp.kind) as (typeof PREVIEW_KINDS)[number]) : "church";
  const state: State = (STATES as readonly string[]).includes(one(sp.state) ?? "") ? (one(sp.state) as State) : "draft";
  const f = FIXTURES[kind];
  const setup = sampleSetup(kind, state);

  return (
    <ToastProvider>
      <KindProvider kind={f.kind ?? (f.tradition ? LEGACY_KIND : NEUTRAL_KIND)}>
        <div data-v2-tokens className="min-h-screen bg-canvas text-ink">
          <div className="flex justify-center bg-white pb-1 pt-[5px]">
            <span className="rounded-field bg-danger px-2.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white">DEV PREVIEW · SAMPLE DATA</span>
          </div>
          <main className="mx-auto max-w-[1180px] px-4 py-5">
            <nav aria-label="Sample events" className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
              {PREVIEW_KINDS.map((k) => (
                <Link key={k} href={`?kind=${k}&state=${state}`} aria-current={k === kind ? "page" : undefined} className={`rounded-[14px] border px-3 py-1 font-semibold ${k === kind ? "border-navy bg-navy text-white" : "border-line bg-white text-navy"}`}>
                  {FIXTURES[k].org}
                </Link>
              ))}
              <span className="mx-1 text-muted">·</span>
              {STATES.map((s) => (
                <Link key={s} href={`?kind=${kind}&state=${s}`} aria-current={s === state ? "page" : undefined} className={`rounded-[14px] border px-3 py-1 font-semibold ${s === state ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink-2"}`}>
                  {s}
                </Link>
              ))}
            </nav>
            <h1 className="m-0 mb-4 font-display text-[24px] font-semibold">New event</h1>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
              <div className="hidden rounded-tile border border-dashed border-line-control bg-white p-5 text-[14px] text-muted lg:block" aria-hidden="true">
                The creator&apos;s question cards go here (built separately). This preview shows the panel beside them.
              </div>
              <PreviewFlyerPanel initial={setup} kind={kind} />
            </div>
          </main>
        </div>
      </KindProvider>
    </ToastProvider>
  );
}
