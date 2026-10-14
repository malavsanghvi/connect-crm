import Link from "next/link";

import type { GapSection } from "@/lib/people-v2/model";

// A list of ADULTS who have a contact gap ("Adults with no email"): who they are, which family (the household card line, never a name
// alone) and what is on file. Rows open the family. A child has no email or mobile field, so a child is never on this list, whatever the
// address asks for. It only draws the model.

const COLS = "md:grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,2.3fr)_130px_minmax(0,1.4fr)_110px_44px] md:gap-3";

export function GapList({ section }: { section: GapSection }) {
  return (
    <section aria-label="Adults with a gap in their contact details" className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white px-3 pb-3 pt-2.5">
      <div className={`hidden rounded-field bg-canvas px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted ${COLS}`} aria-hidden="true">
        <span>Person</span>
        <span>Family</span>
        <span>Mobile</span>
        <span>Email</span>
        <span>App</span>
        <span className="text-right">Age</span>
      </div>
      {section.rows.length === 0 ? (
        <div className="px-2.5 py-8 text-center">
          <p className="m-0 font-display text-[18px] font-semibold text-ink">{section.emptyTitle}</p>
          <p className="m-0 mt-1 text-[13px] text-muted">{section.emptyHint}</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {section.rows.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                scroll={false}
                aria-label={`${r.name}, ${r.relationship}. Family ${r.family}${r.cardLine ? `, ${r.cardLine}` : ""}. Mobile ${r.mobile}. Email ${r.email}. ${r.app}. Age ${r.age}.`}
                className={`flex min-h-[56px] flex-col justify-center gap-1 rounded-field px-2.5 py-2 text-[13px] text-ink no-underline hover:bg-canvas md:items-start ${COLS}`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span dir="auto" className="truncate font-bold">
                    {r.name}
                  </span>
                  <span className="truncate text-[12px] text-muted">{r.relationship === "—" ? r.ids : `${r.relationship} · ${r.ids}`}</span>
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span dir="auto" className="truncate">
                    {r.family}
                  </span>
                  {r.cardLine ? <span className="text-[12px] leading-snug text-muted">{r.cardLine}</span> : null}
                </span>
                <span className="flex gap-1.5 md:block">
                  <span className="text-muted md:hidden">Mobile</span>
                  <span className={r.mobile === "—" ? "font-semibold text-[var(--v2-sun-ink)]" : undefined}>{r.mobile === "—" ? "None on file" : r.mobile}</span>
                </span>
                <span className="flex min-w-0 gap-1.5 md:block">
                  <span className="text-muted md:hidden">Email</span>
                  <span className={`truncate ${r.email === "—" ? "font-semibold text-[var(--v2-sun-ink)]" : ""}`}>{r.email === "—" ? "None on file" : r.email}</span>
                </span>
                <span className={r.app === "On the app" ? "text-[var(--v2-green)]" : "text-muted"}>{r.app}</span>
                <span className="md:text-right">
                  <span className="text-muted md:hidden">Age </span>
                  {r.age}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {section.paging.showing ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-0.5 pt-2.5 text-[13px] text-muted">
          <span>{section.paging.showing}. Rows open the family. Adults only: a child&apos;s record is never part of a list like this.</span>
          {section.paging.prevHref || section.paging.nextHref ? (
            <span className="flex gap-2">
              {section.paging.prevHref ? (
                <Link href={section.paging.prevHref} scroll={false} className="font-semibold text-navy no-underline hover:underline">
                  Previous
                </Link>
              ) : null}
              {section.paging.nextHref ? (
                <Link href={section.paging.nextHref} scroll={false} className="font-semibold text-navy no-underline hover:underline">
                  Next
                </Link>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
