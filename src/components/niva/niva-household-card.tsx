import type { ReactNode } from "react";

import { householdFacts, type HouseholdCardView } from "@/lib/assistant/result-view";

/**
 * A household as Niva shows it: never a name alone. It shows adults only (the command layer sends nothing else), the household
 * numbers, where they live, the last gift and open pledges in dollars.
 */
export function NivaHouseholdCard({ card, children }: { card: HouseholdCardView; children?: ReactNode }) {
  const numbers = [card.household_number ? `No. ${card.household_number}` : "No household number", card.org_household_id ? `Org ID ${card.org_household_id}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] text-ink">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="font-semibold">{card.household_name ?? "Unnamed household"}</p>
        <p className="font-mono text-[12px] text-muted">{numbers}</p>
      </div>
      <p className="mt-0.5">
        <span className="text-muted">Adults:</span> {card.adults.length > 0 ? card.adults.join(", ") : "—"}
      </p>
      {card.primary_adult ? (
        <p>
          <span className="text-muted">Main contact:</span> {card.primary_adult}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted">{householdFacts(card).join(" · ")}</p>
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}
