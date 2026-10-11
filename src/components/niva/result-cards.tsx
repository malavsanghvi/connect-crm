import Link from "next/link";

import { describeResult, isEmptyView, type ResultView } from "@/lib/assistant/result-view";

import { NivaHouseholdCard } from "./niva-household-card";

/** The cards for a command's result: household cards, a few facts and small tables. Used by the panel and the palette. */
export function ResultCards({ title, data, onNavigate }: { title: string; data: unknown; onNavigate?: () => void }) {
  return <ResultCardsView title={title} view={describeResult(data)} onNavigate={onNavigate} />;
}

export function ResultCardsView({ title, view, onNavigate }: { title: string; view: ResultView; onNavigate?: () => void }) {
  if (isEmptyView(view)) {
    return (
      <section aria-label={title} className="rounded-xl border border-line bg-ground px-3 py-2.5 text-[13px] text-muted">
        {title}: nothing to show.
      </section>
    );
  }
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 rounded-xl border border-line bg-ground p-3 text-[13px] text-ink">
      <h4 className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted">{title}</h4>
      {view.notes.map((n) => (
        <p key={n} className="text-muted">
          {n}
        </p>
      ))}
      {view.facts.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {view.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted">{f.label}</dt>
              <dd className="font-semibold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {view.households.length > 0 ? (
        <ul className="flex list-none flex-col gap-2 p-0">
          {view.households.map((h) => (
            <li key={h.card.household_id}>
              <NivaHouseholdCard card={h.card}>
                {h.facts.length > 0 ? (
                  <p className="text-xs text-ink-2">
                    {h.facts.map((f, i) => (
                      <span key={f.label}>
                        {i > 0 ? " · " : ""}
                        <span className="text-muted">{f.label}:</span> <span className="font-semibold tabular-nums">{f.value}</span>
                      </span>
                    ))}
                  </p>
                ) : null}
              </NivaHouseholdCard>
            </li>
          ))}
        </ul>
      ) : null}
      {view.tables.map((t) => (
        <div key={t.title} className="min-w-0">
          {view.tables.length > 1 || t.title !== "Results" ? <p className="mb-1 font-semibold text-ink-2">{t.title}</p> : null}
          <div className="overflow-x-auto rounded-lg border border-line bg-white">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="bg-canvas text-muted">
                  {t.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-2.5 py-1.5 font-semibold">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line-soft align-top">
                    {t.columns.map((c, ci) => (
                      <td key={c.key} className="px-2.5 py-1.5 tabular-nums">
                        {r.cells[c.key]}
                        {ci === 0 && r.links.length > 0 ? (
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            {r.links.map((l) => (
                              <Link key={l.href + l.label} href={l.href} onClick={onNavigate} className="crm-link font-semibold">
                                {l.label}
                              </Link>
                            ))}
                          </span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.more > 0 ? <p className="mt-1 text-xs text-muted">and {t.more} more</p> : null}
        </div>
      ))}
    </section>
  );
}
