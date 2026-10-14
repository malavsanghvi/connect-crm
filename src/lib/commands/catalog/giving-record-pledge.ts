// giving.record_pledge: record a pledge by hand for a household (docs/GIVING_REDESIGN.md slice 7; NEEDS OWNER OK). A money record,
// built but OFF for every door (Niva, the ⌘K palette) until an owner switches `assistant.tools.giving.record_pledge` on for the
// community (requiresOwnerSwitch), like the three commands that move money. The portal's own Record pledge sheet does not go through
// this command: it records through recordPledgeAction, and both end in the same function (src/lib/data/record-pledge.ts ->
// app.record_manual_pledge, 0745).
//
// What makes it safe to switch on: it never runs from the call itself (runCommand records a proposal with the household card, the
// amount, what it is for and who pledged; the person presses the button); the confirmed proposal is the key, so one confirmation
// records once; giving.manage only; the person who pledged is an adult of the household; the reason is written to the audit entry.

import { todayInTz } from "@/lib/dates";
import { loadPledgeDesignations, householdAdults, recordManualPledge } from "@/lib/data/record-pledge";
import { checkPledge, PLEDGE_NO_UNDO, type CheckedPledge, type RecordedPledge } from "@/lib/giving-actions/record-pledge";
import { householdRef } from "@/lib/giving-actions/record-sheet";
import { formatCents } from "@/lib/money";

import { defineCommand } from "../define";
import { assistantToolSetting } from "../enabled";
import { revalidateAfterCommand } from "../revalidate";
import { f, object, type Infer } from "../schema";
import { CommandError, type CommandContext, type CommandPreview } from "../types";

import { dollars } from "./giving-fields";
import { requireOwnHousehold } from "./giving-guard";
import { adultHouseholdCards } from "./household";
import { communityMajority } from "../child-filter";

const KEY = "giving.record_pledge";

const input = object({
  household_id: f.uuid("The household that pledged (its id, from people.search). Never guessed from a name: the person must have chosen it by its card."),
  amount: dollars("The amount pledged in the community's currency, like 500 or 500.00. Whole units and hundredths only."),
  reason: f.string('Why it is recorded by hand, in a few words ("Pledged in person", "Pledge card"). It shows in the family\'s History.', { min: 3, max: 500 }),
  fund_id: f.optional(f.uuid("The fund it is for, if the person named one.")),
  campaign_id: f.optional(f.uuid("The campaign it is for, if the person named one (its fund comes with it).")),
  opportunity_id: f.optional(f.uuid("The opportunity it is for, if the person named one (its campaign comes with it).")),
  due_on: f.optional(f.date("When it is due, like 2026-12-31. Leave out when none was said.")),
  pledged_by_person_id: f.optional(f.uuid("The adult of the household who pledged, if the person named one. Never a child.")),
  dedication: f.optional(f.string("A dedication, if one was given.", { min: 1, max: 200 })),
});
export type RecordPledgeCommandInput = Infer<typeof input>;

function checked(ctx: CommandContext, inp: RecordPledgeCommandInput): CheckedPledge {
  const set = [inp.fund_id, inp.campaign_id, inp.opportunity_id].filter(Boolean);
  if (set.length > 1) throw new CommandError("Name one of a fund, a campaign or an opportunity, not more than one.");
  const designation = inp.opportunity_id ? `opportunity:${inp.opportunity_id}` : inp.campaign_id ? `campaign:${inp.campaign_id}` : inp.fund_id ? `fund:${inp.fund_id}` : "";
  const c = checkPledge(
    {
      householdId: inp.household_id,
      amount: inp.amount,
      designation,
      dueOn: inp.due_on ?? null,
      pledgedBy: inp.pledged_by_person_id ?? null,
      dedication: inp.dedication ?? null,
      reason: inp.reason,
    },
    todayInTz(ctx.session.center.time_zone, ctx.now?.()),
  );
  if (!c.ok) throw new CommandError(c.error);
  return c.value;
}

export const recordPledge = defineCommand<RecordPledgeCommandInput, RecordedPledge>({
  key: KEY,
  title: "Record a pledge",
  description:
    "Record a pledge (a promise to give) that a household made in person, by phone or on a pledge card, with the amount, what it is for (a fund, a campaign or an opportunity, or nothing for a general pledge), " +
    "an optional due date, the adult who pledged and a short reason that shows in the family's History. No money moves: the pledge shows as owed until it is paid. " +
    "This asks the person to confirm first, showing the household card; nothing is saved until they press the button, and one confirmation records it once. " +
    "It needs the household's id (find it with people.search; never guess from a name). Never name a child as the person who pledged.",
  level: "confirm",
  permission: "recordPledge",
  module: "giving",
  enabledByDefault: false,
  requiresOwnerSwitch: true,
  covers: ["src/app/(app)/giving/pledges/record-pledge-actions.ts#recordPledgeAction"],
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = checked(ctx, inp);
    const { db, center } = ctx.session;
    await requireOwnHousehold(ctx, p.householdId);
    const today = todayInTz(center.time_zone, ctx.now?.());
    const [cards, designations, adults] = await Promise.all([
      adultHouseholdCards(db, [p.householdId], { today, currency: center.currency, majority: communityMajority(center) }),
      loadPledgeDesignations(ctx.session),
      p.pledgedBy ? householdAdults(ctx.session, p.householdId) : Promise.resolve([]),
    ]);
    const card = cards.cards[0];
    if (!card) throw new CommandError("That household was not found, or you can't record pledges for it.");
    const pledger = p.pledgedBy ? adults.find((a) => a.id === p.pledgedBy) : null;
    if (p.pledgedBy && !pledger) throw new CommandError("The person who pledged must be an adult of this household. Choose an adult, or record the pledge for the household.");
    const forWhat = p.opportunityId
      ? designations.opportunities.find((o) => o.id === p.opportunityId)?.name
      : p.campaignId
        ? designations.campaigns.find((c) => c.id === p.campaignId)?.name
        : p.fundId
          ? designations.funds.find((x) => x.id === p.fundId)?.name
          : "General (no fund chosen)";
    if (!forWhat) throw new CommandError("That fund, campaign or opportunity is not one a pledge can be recorded to here.");
    const money = formatCents(p.amountCents, center.currency);
    return {
      summary: `Record a ${money} pledge for ${householdRef({ name: card.household_name ?? "", number: card.household_number })}.`,
      lines: [
        { label: "Amount", value: money },
        { label: "For", value: forWhat },
        { label: "Pledged by", value: pledger ? pledger.name : "The household" },
        ...(p.dueOn ? [{ label: "Due", value: p.dueOn }] : []),
        ...(p.dedication ? [{ label: "Dedication", value: p.dedication }] : []),
        { label: "Reason (shown in History)", value: p.reason },
      ],
      households: [card],
      warnings: [PLEDGE_NO_UNDO],
    };
  },
  confirmText: (_input, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    // Only for a confirmed proposal, with the owner's switch on: that id is what keeps one confirmation from recording it twice.
    if (assistantToolSetting(ctx.session.center.rules, KEY) !== true) {
      throw new CommandError(`Recording a pledge from here is not switched on for ${ctx.session.center.name}, so nothing was done. It can be done on the family's page.`);
    }
    if (!ctx.proposalId) throw new CommandError("A pledge is only recorded from here after it is confirmed on its card. Nothing was done.");
    const p = checked(ctx, inp);
    await requireOwnHousehold(ctx, p.householdId);
    const recorded = await recordManualPledge(ctx.session, p, `proposal:${ctx.proposalId}`);
    revalidateAfterCommand(["/giving", "/giving/pledges", `/households/${p.householdId}`]);
    const money = formatCents(recorded.amountCents, ctx.session.center.currency);
    return {
      ok: true,
      data: recorded,
      message: recorded.replayed
        ? `This pledge was already recorded (${recorded.pledgeNumber ?? "number pending"}). Nothing was added.`
        : `Recorded a ${money} pledge — ${recorded.pledgeNumber ?? "number pending"}. No money moved.`,
    };
  },
});
