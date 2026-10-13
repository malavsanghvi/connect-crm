import type { ReactNode } from "react";

import { DefinitionList, InfoBox } from "@/components/ui";
import {
  deadlineText,
  giftTypesText,
  moneyText,
  orgKindsText,
  portalLabel,
  ratioText,
  religiousSentence,
  sourceLabel,
  type ProgramRow,
} from "@/lib/matching/directory";

type Facts = Omit<ProgramRow, "id" | "status" | "merged_into" | "status_reason" | "updated_at" | "verified_submission_id" | "last_verified_on" | "verified_by_kind">;

function ExternalLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="crm-link break-all">
      {children}
    </a>
  );
}

/**
 * An employer program's facts, as members and staff read them: what it matches, who qualifies (whether religious
 * organizations do is said first and plainly, so members know before they ask), where to ask and by when.
 */
export function ProgramFacts({ facts, names }: { facts: Facts; names: string[] }) {
  const f = facts;
  const items: { label: string; value: ReactNode }[] = [];
  items.push({ label: "Other names", value: names.length ? <span dir="auto">{names.join(" · ")}</span> : "None given" });
  items.push({ label: "Country", value: f.country ?? "Any (the same everywhere)" });
  items.push({ label: "What it does", value: [f.gift_match ? "Matches gifts" : null, f.volunteer_grant ? "Pays grants for volunteer hours" : null].filter(Boolean).join(" · ") });
  if (f.gift_match) {
    items.push({ label: "Match ratio", value: ratioText(f.match_ratio_bp) });
    items.push({ label: "Smallest gift matched", value: f.min_gift_cents === null ? "Any amount" : moneyText(f.min_gift_cents, f.currency) });
    items.push({ label: "Most matched per gift", value: moneyText(f.max_gift_cents, f.currency) });
    items.push({ label: "Most matched per year", value: moneyText(f.max_year_cents, f.currency) });
    items.push({ label: "Gifts it matches", value: giftTypesText(f.gift_types) });
  }
  items.push({ label: "Kinds of organization", value: orgKindsText(f.org_kinds) });
  items.push({ label: "Where to ask", value: <ExternalLink href={f.portal_url}>{portalLabel(f.portal)}</ExternalLink> });
  items.push({ label: "Deadline", value: f.deadline_note ? `${deadlineText(f)}. ${f.deadline_note}` : deadlineText(f) });
  if (f.volunteer_grant) {
    items.push({ label: "Volunteer grant per hour", value: moneyText(f.volunteer_cents_per_hour, f.currency) });
    items.push({ label: "Fewest hours before it pays", value: f.volunteer_min_hours === null ? "Not known yet" : `${f.volunteer_min_hours} hours` });
    items.push({ label: "Most volunteer grant per year", value: moneyText(f.volunteer_max_year_cents, f.currency) });
    if (f.volunteer_note) items.push({ label: "About volunteer grants", value: f.volunteer_note });
  }
  items.push({ label: "Where the facts come from", value: <ExternalLink href={f.source_url}>{sourceLabel(f.source)}</ExternalLink> });
  return (
    <div className="flex flex-col gap-3" data-testid="program-facts">
      <InfoBox>
        <p className="m-0 text-[14px] font-semibold text-ink" data-testid="religious-rule">
          {religiousSentence(f.religious_orgs)}
        </p>
        {f.eligibility_note ? <p className="m-0 mt-1 whitespace-pre-line text-[13.5px] text-ink">{f.eligibility_note}</p> : null}
      </InfoBox>
      <DefinitionList items={items} />
      {f.notes ? <p className="m-0 whitespace-pre-line text-[13.5px] text-ink">{f.notes}</p> : null}
    </div>
  );
}
