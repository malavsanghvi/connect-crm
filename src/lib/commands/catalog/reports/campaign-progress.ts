import { reportReads } from "@/lib/reports/load";
import { outstandingCents } from "@/lib/reports/parse";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { fiscalYear, got, moneyOf, plural } from "./shared";

export type CampaignProgressData = {
  year: number;
  campaigns: {
    campaign: string;
    pledges: number;
    pledged_cents: number;
    pledged: string;
    paid_cents: number;
    paid: string;
    written_off_cents: number;
    written_off: string;
    outstanding_cents: number;
    outstanding: string;
  }[];
  total: { pledges: number; pledged: string; paid: string; written_off: string; outstanding: string };
  /** Every pledge still open, whenever it was made. */
  open_now: { pledges: number; amount_cents: number; amount: string };
  basis: string;
};

const input = object({
  year: f.optional(f.integer("The year the pledges were made, like 2026. Leave out for this year. A community whose financial year starts in another month gets that financial year, named by the year it starts in.", { min: 1991, max: 2100 })),
});

/** Pledges made in a year by campaign: pledged, paid, written off and still owed. */
export const campaignProgress = defineCommand<Infer<typeof input>, CampaignProgressData>({
  key: "reports.campaign_progress",
  title: "Show how each campaign is doing",
  description:
    "For one year, each campaign with its pledges: how many, how much was pledged, how much has been paid, how much was written off and how much is still owed, largest first; pledges with no campaign are a line of their own. " +
    "Also the total still open across all years. Use it for 'how is the annual appeal doing?' and 'how much is still owed on pledges?'. " +
    "Cancelled pledges are left out. The sums are done by the database and are exact. Counts and sums only: no household is named. Use giving.pledges_behind for who is late. Read only.",
  level: "read",
  permission: "paymentsAll",
  module: "reports",
  input,
  async execute(ctx, { year }) {
    const { w, note } = await fiscalYear(ctx, year);
    const money = moneyOf(ctx);
    const s = got(await reportReads.pledges(ctx.session.db, ctx.session.center.id, w.from, w.yearEnd), "read the pledges");
    const data: CampaignProgressData = {
      year: w.year,
      campaigns: s.campaigns.map((c) => ({
        campaign: c.campaign ?? "No campaign",
        pledges: c.pledges,
        pledged_cents: c.pledgedCents,
        pledged: money(c.pledgedCents),
        paid_cents: c.paidCents,
        paid: money(c.paidCents),
        written_off_cents: c.writtenOffCents,
        written_off: money(c.writtenOffCents),
        outstanding_cents: outstandingCents(c),
        outstanding: money(outstandingCents(c)),
      })),
      total: {
        pledges: s.totals.pledges,
        pledged: money(s.totals.pledgedCents),
        paid: money(s.totals.paidCents),
        written_off: money(s.totals.writtenOffCents),
        outstanding: money(outstandingCents(s.totals)),
      },
      open_now: { pledges: s.openNow.pledges, amount_cents: s.openNow.openCents, amount: money(s.openNow.openCents) },
      basis: `Pledges made in ${w.label}${w.label === String(w.year) ? "" : ", the community's financial year"}, cancelled ones left out. "Still owed" is pledged, less paid, less written off.${note ? ` ${note}.` : ""}`,
    };
    return {
      ok: true,
      data,
      message: s.campaigns.length === 0 ? `No pledges were made in ${w.label}.` : `${plural(s.totals.pledges, "pledge")} in ${w.label}: ${data.total.pledged} pledged, ${data.total.paid} paid.`,
    };
  },
});
