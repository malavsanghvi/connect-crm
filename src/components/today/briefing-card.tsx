import Link from "next/link";

import { Card, EmptyState } from "@/components/ui";
import { briefingSentence, type BriefingItem } from "@/lib/routines/briefing";

const TONE_VALUE = { quiet: "text-faint", attention: "text-navy", alert: "text-danger" } as const;

/**
 * "This morning": a few facts, each a number and a link to the place that deals with it. The numbers are the portal's own
 * counters, read when the page loaded. No model writes anything here, so the same facts read the same way every day.
 */
export function BriefingCard({ items }: { items: BriefingItem[] }) {
  return (
    <Card span={5} title="This morning" description="Counted when this page opened">
      {items.length === 0 ? (
        <EmptyState title="Nothing to count for your role yet">The numbers here follow what your role can see.</EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((i) => (
            <li key={i.key} className="border-b border-line-soft last:border-b-0">
              <Link href={i.href} className="flex items-center gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-highlight" aria-label={briefingSentence(i)}>
                <span className={`w-14 shrink-0 text-right font-display text-[28px] font-semibold leading-none ${i.value === null ? "text-danger" : TONE_VALUE[i.tone]}`}>
                  {i.value === null ? "?" : i.value.toLocaleString("en-US")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-snug text-ink">{i.label}</span>
                  {i.error ? (
                    <span role="alert" className="block text-[13px] text-danger">
                      Could not count this — {i.error.replace(/[.\s]+$/, "")}. Reload to try again.
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
