// Notices at the top of Home for the organization's owner: things the Weaver team did that the organization should know. Pure, so
// the Home page, Today and the tests share one rule (docs/PAYMENT_ADDONS.md §11.2, decision 12).
//
// The Chip In notice has no table behind it. The platform team's setting carries the time it last changed (chip_in_settings.updated_at,
// read by the owner through app.chip_in_summary), so the notice shows for CHIP_IN_NOTICE_DAYS after a change and then goes. It has
// no "read" mark: a notice the owner can dismiss, or a record of every change, would need a database table (a migration).

import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { suggestionsText, type ChipInSummary } from "@/lib/payments/chip-in-platform";

/** How long a change to the Chip In settings is mentioned on Home. */
export const CHIP_IN_NOTICE_DAYS = 14;

export type HomeNotice = {
  key: string;
  tone: "info" | "warning";
  title: string;
  /** Plain sentences, one paragraph each. */
  lines: string[];
};

const DAY_MS = 86_400_000;

/**
 * The notice for a recent change of the Chip In settings, or null: nothing is set, or it was last changed more than
 * CHIP_IN_NOTICE_DAYS ago. It states what members are (or are not) asked, in the owner's terms.
 */
export function chipInNotice(summary: ChipInSummary, now: Date, timeZone: string): HomeNotice | null {
  if (!summary.configured || !summary.updatedAt || summary.yearlyLimitCents === null) return null;
  const changed = new Date(summary.updatedAt).getTime();
  if (!Number.isFinite(changed) || now.getTime() - changed > CHIP_IN_NOTICE_DAYS * DAY_MS) return null;
  const limit = formatCents(summary.yearlyLimitCents, "USD");
  const amounts = summary.suggestedCents.length > 0 ? ` Suggested amounts: ${suggestionsText(summary.suggestedCents)}.` : "";
  const lines = summary.asking
    ? [
        `Your members are now asked for an optional Chip In to Weaver when they pay by card or bank debit, up to ${limit} a year each.${amounts}`,
        "It is added on top of what your organization charges and never taken out of it. It is a contribution to Weaver, not a gift to your organization, and a member can always choose no Chip In.",
      ]
    : [
        `Your members are not asked for a Chip In. The yearly limit per account is set to ${limit}.${amounts}`,
        "Nothing is added to any payment until Weaver's team switches it on, and you will see a notice here when it does.",
      ];
  return {
    key: "chip-in-settings",
    tone: "info",
    title: `Weaver's team changed your Chip In settings on ${formatDate(summary.updatedAt, timeZone)}`,
    lines,
  };
}
