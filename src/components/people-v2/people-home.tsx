import Link from "next/link";
import type { ReactNode } from "react";

import type { ListLink } from "@/lib/find/lists";
import type { InboxTile, PeopleHomeModel, RecentFamily } from "@/lib/people-v2/home-model";
import type { Problem } from "@/lib/people-v2/model";

import { FindBox } from "./find/find-box";
import { ChevronDownIcon } from "./find/icons";
import { PinnedFamilies } from "./saved/pinned-families";
import { SavedViewsStrip } from "./saved/saved-views-strip";

// The People home in the New look, as drawn in the redesign plan (docs/PEOPLE_REDESIGN.md, section 4): the title, ONE big find box
// (the same box as the top bar, which hides here), the inbox, the families opened lately, the saved views strip and the Lists menu.
// It only draws the model; the page (people-v2.tsx) and the dev preview build it.

const CARD = "rounded-[18px] border border-line bg-white";

export function PeopleHome({ model, inbox }: { model: PeopleHomeModel; /** The inbox section; the page passes the live one. Defaults to the counts. */ inbox?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
      {/* The big box is the box on this page: the top-bar one steps aside (no flash, it is hidden by the page itself). */}
      <style>{"[data-find-bar]{display:none}"}</style>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 font-display text-[30px] font-semibold leading-tight text-ink">People</h1>
          {model.summary ? <p className="m-0 mt-0.5 text-[14px] text-muted">{model.summary}</p> : null}
        </div>
        <ListsMenu lists={model.lists} />
      </div>

      <section aria-label="Find a family or a person">
        <FindBox variant="page" cookieName={model.cookieName} autoFocus />
        <p className="m-0 mt-2.5 px-2 text-[13px] text-muted">Type anything. Enter opens the family. A question goes to Niva when Niva is on. The same box is in the top bar on every other page.</p>
      </section>

      {model.problems
        .filter((p) => p.what !== "your saved views")
        .map((p) => (
          <ProblemLine key={p.what} problem={p} />
        ))}

      {inbox ?? <InboxCounts tiles={model.inbox} />}

      <section aria-label="Pinned families" className="flex flex-col gap-3">
        <SectionHeading title="Pinned families" note="Yours alone: pin one with the star on its page" />
        <PinnedFamilies pins={model.pins} hidden={model.pinsHidden} />
      </section>

      <RecentFamilies recents={model.recents} />

      <section id="saved-views" aria-label="Saved views" className="flex scroll-mt-6 flex-col gap-3">
        <SectionHeading title="Saved views" />
        <SavedViewsStrip
          endingSoon={model.endingSoon}
          contactGapHref={model.contactGapHref}
          views={model.savedViews}
          max={model.maxViews}
          loadError={model.problems.find((p) => p.what === "your saved views")?.message ?? null}
        />
      </section>
    </div>
  );
}

function ProblemLine({ problem }: { problem: Problem }) {
  return (
    <p role="alert" className="m-0 rounded-xl border border-danger/30 bg-danger-50 px-4 py-2.5 text-[13px] text-danger">
      Could not load {problem.what} — {problem.message}
    </p>
  );
}

/** "Lists": the whole lists, and the screens that stay as they are, behind the same permissions as today. No script needed. */
export function ListsMenu({ lists }: { lists: ListLink[] }) {
  return (
    <details className="relative">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-[22px] border border-line bg-white px-[18px] text-[14px] font-bold text-ink [&::-webkit-details-marker]:hidden">
        Lists
        <ChevronDownIcon />
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-[min(92vw,340px)] rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-menu)]">
        <ul className="m-0 list-none p-0">
          {lists.map((l) => (
            <li key={l.key}>
              <Link href={l.href} className="block rounded-xl px-3 py-2 no-underline hover:bg-ground">
                <span className="block text-[14px] font-bold text-ink">{l.label}</span>
                <span className="block text-[12px] text-muted">{l.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-1 border-t border-line-soft px-3 pb-1 pt-2 text-[12px] text-muted">
          Your own saved views are on the{" "}
          <Link href="/people#saved-views" className="font-semibold text-navy">
            People home
          </Link>
          .
        </p>
      </div>
    </details>
  );
}

function SectionHeading({ title, note, badge }: { title: string; note?: string; badge?: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="m-0 font-display text-[20px] font-semibold text-ink">{title}</h2>
      {badge ? <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-[12px] font-bold text-navy">{badge}</span> : null}
      {note ? <span className="text-[12px] text-muted">{note}</span> : null}
    </div>
  );
}

/** The inbox as counts, each opening where it is decided. */
export function InboxCounts({ tiles }: { tiles: InboxTile[] }) {
  const known = tiles.map((t) => t.count).filter((c): c is number => c !== null);
  const waiting = known.reduce((a, b) => a + b, 0);
  return (
    <section aria-label="Inbox" className={`${CARD} flex flex-col gap-3 p-4`}>
      <SectionHeading title="Inbox" badge={known.length > 0 ? `${waiting} waiting` : null} note="What waits for a decision" />
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} title={t.hint} className="rounded-[14px] border border-line px-4 py-3 no-underline hover:border-navy">
            <span className="block font-display text-[28px] font-semibold leading-none text-ink">{t.count === null ? "—" : t.count}</span>
            <span className="mt-1 block text-[13px] text-muted">{t.label}</span>
            {t.count === null ? <span className="block text-[12px] text-danger">Could not be counted just now.</span> : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The families opened lately, in this browser, with their household card line. */
function RecentFamilies({ recents }: { recents: RecentFamily[] }) {
  return (
    <section aria-label="Recent families" className="flex flex-col gap-3">
      <SectionHeading title="Recent families" note="Remembered in this browser; not shared between your devices" />
      {recents.length === 0 ? (
        <p className="m-0 rounded-[14px] border border-dashed border-line-input px-4 py-5 text-[13px] text-muted">Families you open show up here, so you can get back to them in one click.</p>
      ) : (
        <ul className="m-0 grid list-none grid-flow-col auto-cols-[minmax(240px,80%)] gap-3 overflow-x-auto p-0 pb-1 md:grid-flow-row md:auto-cols-auto md:grid-cols-2 md:overflow-visible xl:grid-cols-3">
          {recents.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className={`${CARD} block h-full px-4 py-3 no-underline hover:border-navy`}>
                <span className="block truncate text-[15px] font-bold text-ink">{r.title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted">{r.cardLine}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
