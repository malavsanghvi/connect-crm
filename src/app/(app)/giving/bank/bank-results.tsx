"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// Matching a line revalidates the page, which removes the line from the
// unmatched list. The outcome is kept here, above the list, so the treasurer
// still sees what happened (receipt, pledges closed, payer name learned).

export type BankOutcome = { id: string; title: string; lines: string[] };

const Ctx = createContext<(o: BankOutcome) => void>(() => {});

export function useReportOutcome() {
  return useContext(Ctx);
}

export function BankResultsProvider({ children }: { children: ReactNode }) {
  const [outcomes, setOutcomes] = useState<BankOutcome[]>([]);
  const report = useCallback((o: BankOutcome) => setOutcomes((cur) => [o, ...cur.filter((x) => x.id !== o.id)].slice(0, 8)), []);
  return (
    <Ctx.Provider value={report}>
      {outcomes.length > 0 ? (
        <section aria-label="Just reconciled" className="mb-5 rounded-xl border border-success/30 bg-success-50 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-success">Just reconciled</h2>
            <button type="button" onClick={() => setOutcomes([])} className="min-h-9 text-sm font-semibold text-success underline">
              Clear
            </button>
          </div>
          <ul className="mt-2 space-y-2 text-sm text-ink">
            {outcomes.map((o) => (
              <li key={o.id}>
                <p className="font-semibold">{o.title}</p>
                {o.lines.map((l, i) => (
                  <p key={i} className="text-muted">
                    {l}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {children}
    </Ctx.Provider>
  );
}
