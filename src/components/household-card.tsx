import type { ReactNode } from "react";

import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

// The disambiguation card from app.household_card(). Names and household
// names are often near-identical ("Rahul Shah", "Rahul & Mira Shah
// Household", "Shah family"), so a household is never shown — or picked, or
// confirmed — by name alone. Every field can be null.

export type HouseholdCardData = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  members: string | null;
  primary_member: string | null;
  /** Absent when the source (e.g. suggest_bank_matches) does not return it. */
  primary_org_member_id?: string | null;
  zone: string | null;
  city: string | null;
  last_gift_on: string | null;
  open_pledge_cents: number | null;
};

export type CardLabels = { orgMemberLabel: string; orgHouseholdLabel: string };

export function HouseholdCard({
  card,
  labels,
  timeZone,
  currency = "USD",
  showBalance = true,
  href,
  children,
  tone = "plain",
}: {
  card: HouseholdCardData;
  labels: CardLabels;
  timeZone: string;
  currency?: string;
  showBalance?: boolean;
  href?: string;
  children?: ReactNode;
  tone?: "plain" | "selected" | "warning";
}) {
  const border =
    tone === "selected" ? "border-navy ring-2 ring-navy/20" : tone === "warning" ? "border-saffron/60" : "border-line";
  const name = card.household_name ?? "Unnamed household";
  return (
    <div className={`rounded-lg border ${border} bg-white px-4 py-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-semibold text-ink">
          {href ? (
            <a href={href} className="crm-link" target="_blank" rel="noreferrer">
              {name}
            </a>
          ) : (
            name
          )}
        </p>
        <p className="font-mono text-[0.8125rem] text-muted">
          {card.household_number ?? "no Connect number"}
          {" · "}
          {labels.orgHouseholdLabel} {card.org_household_id ?? "—"}
        </p>
      </div>
      <p className="mt-1 text-sm text-ink">
        <span className="text-muted">Primary:</span> {card.primary_member ?? "—"}
        {card.primary_member && card.primary_org_member_id !== undefined ? (
          <span className="text-muted">
            {" "}
            ({labels.orgMemberLabel} {card.primary_org_member_id ?? "—"})
          </span>
        ) : null}
      </p>
      <p className="text-sm text-ink">
        <span className="text-muted">Members:</span> {card.members ?? "—"}
      </p>
      <p className="mt-1 text-xs text-muted">
        {[card.zone ? `${card.zone} zone` : "No zone", card.city ?? "No city", `Last gift ${card.last_gift_on ? formatDate(card.last_gift_on, timeZone) : "never"}`]
          .concat(showBalance && card.open_pledge_cents !== null ? [`Open pledges ${formatCents(card.open_pledge_cents, currency)}`] : [])
          .join(" · ")}
      </p>
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
