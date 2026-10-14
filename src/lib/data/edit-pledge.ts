import "server-only";

import { must, rpcJson } from "@/lib/commands/catalog/db";
import { CommandError } from "@/lib/commands/types";
import { loadPledgeSheetOptions, householdAdults } from "@/lib/data/record-pledge";
import type { DeletedPledge, EditedPledge, PledgeEditChanges, PledgeEditState, PledgeLocks } from "@/lib/giving-actions/edit-pledge";
import type { PledgeSheetOptions } from "@/lib/giving-actions/record-pledge";
import type { CrmSession } from "@/lib/session";

// Editing and deleting a pledge, on the server (migration 0782). ONE way in: the Edit sheet's actions end in these, which call
// app.pledge_edit_state, app.edit_pledge and app.delete_pledge: giving.manage, Giving on, the pledge in this community, a reason
// written to the audit entry. What is locked, and why, is the database's own sentence (app._pledge_locks).

export type PledgeEditSheet = { state: PledgeEditState; options: PledgeSheetOptions };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

function parseLocks(v: unknown): PledgeLocks {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return { details: str(o.details), due: str(o.due), amount: str(o.amount), for: str(o.for), delete: str(o.delete), qbo: str(o.qbo) };
}

function parseState(j: unknown): PledgeEditState {
  const o = (typeof j === "object" && j !== null ? j : null) as Record<string, unknown> | null;
  const id = str(o?.pledge_id);
  const householdId = str(o?.household_id);
  const pledgedOn = str(o?.pledged_on);
  if (!o || !id || !householdId || !pledgedOn) {
    throw new CommandError("The pledge could not be read: the database did not say. Close the sheet and open it again.");
  }
  return {
    pledgeId: id,
    pledgeNumber: str(o.pledge_number),
    householdId,
    status: str(o.status) ?? "open",
    source: str(o.source) ?? "general",
    amountCents: num(o.amount_cents),
    paidCents: num(o.paid_cents),
    dueOn: str(o.due_on),
    pledgedOn,
    campaignId: str(o.campaign_id),
    fundId: str(o.fund_id),
    opportunityId: str(o.opportunity_id),
    dedication: str(o.dedication),
    recognitionName: str(o.recognition_name),
    anonymous: o.anonymous === true,
    pledgedByPersonId: str(o.pledged_by_person_id),
    locks: parseLocks(o.locks),
  };
}

async function readState(session: CrmSession, pledgeId: string): Promise<PledgeEditState> {
  const j = await rpcJson(session.db, "pledge_edit_state", { p_center: session.center.id, p_pledge: pledgeId }, "open the pledge");
  return parseState(j);
}

/** The pledge, what may change on it, and the choices the sheet offers (with the pledge's own campaign and fund always among them). */
export async function loadPledgeEditSheet(session: CrmSession, pledgeId: string): Promise<PledgeEditSheet> {
  const { db, center } = session;
  const state = await readState(session, pledgeId);
  const options = await loadPledgeSheetOptions(session, state.householdId);
  // An archived campaign, one that belongs to another screen, or a retired fund is not offered for a new pledge, but this pledge
  // may still be for it: it stays in the list so the sheet shows what the pledge is now.
  const missingCampaign = state.campaignId && !options.campaigns.some((c) => c.id === state.campaignId) ? state.campaignId : null;
  const missingFund = state.fundId && !options.funds.some((f) => f.id === state.fundId) ? state.fundId : null;
  const [camp, fund] = await Promise.all([
    missingCampaign ? db.from("campaigns").select("id, name, fund_id").eq("center_id", center.id).eq("id", missingCampaign).maybeSingle() : Promise.resolve(null),
    missingFund ? db.from("funds").select("id, name").eq("center_id", center.id).eq("id", missingFund).maybeSingle() : Promise.resolve(null),
  ]);
  const campRow = camp ? must(camp, "read the pledge's campaign") : null;
  const fundRow = fund ? must(fund, "read the pledge's fund") : null;
  const funds = fundRow ? [...options.funds, { id: fundRow.id, name: fundRow.name }] : options.funds;
  const fundName = new Map(funds.map((f) => [f.id, f.name]));
  const campaigns = campRow
    ? [...options.campaigns, { id: campRow.id, name: campRow.name, fundName: campRow.fund_id ? (fundName.get(campRow.fund_id) ?? null) : null }]
    : options.campaigns;
  return { state, options: { ...options, funds, campaigns } };
}

/** Change the pledge once; the database says what changed. The adult who pledged is an adult by the community's own age of majority. */
export async function editPledge(session: CrmSession, pledgeId: string, changes: PledgeEditChanges, reason: string): Promise<EditedPledge> {
  if (changes.pledged_by_person_id) {
    const state = await readState(session, pledgeId);
    const adults = await householdAdults(session, state.householdId);
    if (!adults.some((a) => a.id === changes.pledged_by_person_id)) {
      throw new CommandError("The person who pledged must be an adult of this household. Choose an adult, or leave it as the household.");
    }
  }
  const j = (await rpcJson(
    session.db,
    "edit_pledge",
    { p_center: session.center.id, p_pledge: pledgeId, p_changes: changes, p_reason: reason },
    "change the pledge",
  )) as Record<string, unknown> | null;
  const id = str(j?.pledge_id);
  if (!j || !id) throw new CommandError("The pledge may not have changed: the database did not say. Open the pledge again to check before trying again.");
  return {
    pledgeId: id,
    pledgeNumber: str(j.pledge_number),
    householdId: str(j.household_id) ?? "",
    changed: j.changed === true,
    fields: Array.isArray(j.fields) ? j.fields.filter((x): x is string => typeof x === "string") : [],
    amountCents: num(j.amount_cents),
    wasAmountCents: num(j.was_amount_cents),
    dueOn: str(j.due_on),
    status: str(j.status) ?? "open",
  };
}

/** Delete (cancel) the pledge once; the database refuses what must not go (payments applied, QuickBooks, another screen's pledge). */
export async function deletePledge(session: CrmSession, pledgeId: string, reason: string): Promise<DeletedPledge> {
  const j = (await rpcJson(session.db, "delete_pledge", { p_center: session.center.id, p_pledge: pledgeId, p_reason: reason }, "delete the pledge")) as Record<
    string,
    unknown
  > | null;
  const id = str(j?.pledge_id);
  if (!j || !id) throw new CommandError("The pledge may not have been deleted: the database did not say. Open the pledge again to check before trying again.");
  return { pledgeId: id, pledgeNumber: str(j.pledge_number), householdId: str(j.household_id) ?? "", amountCents: num(j.amount_cents) };
}
