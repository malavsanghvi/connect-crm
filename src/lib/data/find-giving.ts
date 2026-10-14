import "server-only";

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { communityFormat } from "@/lib/community-format";
import { designationNames, loadPledgeDesignations } from "@/lib/data/record-pledge";
import { searchHouseholds } from "@/lib/data/search";
import { todayInTz } from "@/lib/dates";
import { familyHref } from "@/lib/find/rows";
import {
  buildGivingLane,
  givingHousehold,
  type BankHit,
  type CampaignHit,
  type FindScope,
  type GivingFound,
  type GivingIntent,
  type GivingLane,
  type PaymentHit,
  type PledgeHit,
} from "@/lib/find/giving";
import type { FindRow } from "@/lib/find/types";
import type { GivingHousehold } from "@/lib/giving-actions/family-giving";
import { splitPledgeWords, type PledgeDesignation } from "@/lib/giving-actions/record-pledge";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { safeFilterText } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

// The Giving lane's lookup for the signed-in person (docs/GIVING_REDESIGN.md section 4). READ ONLY: it changes nothing, and every
// row is read with the person's own database access, so row level security decides what exists for them (a finance volunteer sees
// the payments they recorded, as on Payments). Families come back as adult-only household cards, never a name alone. Each part
// fails on its own: what did load is shown with one plain sentence about what did not.

const FAMILY_LIMIT = 5;
const PAYMENT_LIMIT = 6;
const PLEDGE_LIMIT = 6;
const BANK_LIMIT = 4;
const CAMPAIGN_LIMIT = 3;

/** `%` and `_` are wildcards in ILIKE: a receipt number is matched as it is written. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export type GivingFindResult = { lane: GivingLane; families: FindRow[]; problem: string | null };

type PaymentRow = { id: string; receipt_number: string | null; amount_cents: number; refunded_cents: number | null; method: string; status: string; received_on: string | null; household_id: string | null };
type PledgeRow = { id: string; pledge_number: string | null; amount_cents: number; paid_cents: number; status: string; campaign_id: string | null; household_id: string | null };

const PAYMENT_COLUMNS = "id, receipt_number, amount_cents, refunded_cents, method, status, received_on, household_id";
const PLEDGE_COLUMNS = "id, pledge_number, amount_cents, paid_cents, status, campaign_id, household_id";

/**
 * Look up what a Giving intent needs and turn it into the lane's rows. `people` is false for someone who cannot open People (a
 * finance volunteer): the families the words match then come from the Record payment household search (their own permission).
 */
export async function findGiving(
  session: CrmSession,
  intent: GivingIntent,
  { scope, people }: { scope: FindScope; people: boolean },
): Promise<GivingFindResult> {
  const { db, center } = session;
  const fmt = communityFormat(center);
  const today = todayInTz(center.time_zone);
  const majority = communityMajority(center);
  const canRecord = canAccess(session, "recordPayment");
  const seesPayments = canAccess(session, "payments");
  const seesPledges = canAccess(session, "pledges");
  const seesBank = (canAccess(session, "bank") || canAccess(session, "bankConfirm")) && isModuleEnabled(session, GIVING_ADDONS.bank);
  const seesCampaigns = canAccess(session, "campaigns");
  let failed = false;
  const note = (what: string, error: unknown) => {
    console.error(`[find-giving] ${what} failed:`, error);
    failed = true;
  };

  // "pledge 500 patel building fund": the words that name a fund, campaign or opportunity are taken out first; the rest is who.
  const canRecordPledge = canAccess(session, "recordPledge");
  let pledge: { designation: PledgeDesignation | null; familyWords: string | null } | null = null;
  if (intent.kind === "pledge" && canRecordPledge) {
    try {
      pledge = splitPledgeWords(intent.who, designationNames(await loadPledgeDesignations(session)));
    } catch (error) {
      note("reading the funds and campaigns", error);
      pledge = { designation: null, familyWords: intent.who };
    }
  }

  // Who a sentence is about: looked up the way Record payment's own household search does it, then read as adult-only cards.
  const familyWords =
    intent.kind === "record" && canRecord
      ? intent.who
      : pledge
        ? pledge.familyWords
        : intent.kind === "lookup" && !people && intent.words && canRecord
          ? intent.words
          : null;

  const token = intent.kind === "refund" || intent.kind === "write_off" ? intent.token : intent.kind === "lookup" ? intent.code : null;
  const numbered = intent.kind === "lookup" ? intent.numbered : null;
  const wantPayments = seesPayments && (intent.kind === "refund" || intent.kind === "lookup");
  const wantPledges = seesPledges && (intent.kind === "write_off" || intent.kind === "lookup");

  const payments = async (): Promise<PaymentRow[]> => {
    if (!wantPayments) return [];
    const base = () => db.from("payments").select(PAYMENT_COLUMNS).eq("center_id", center.id);
    let q;
    if (token) q = base().ilike("receipt_number", likeLiteral(token));
    else if (numbered?.field === "receipt") q = base().ilike("receipt_number", `%${likeLiteral(numbered.value)}`);
    else if (intent.kind === "lookup" && intent.cents !== null) {
      q = base().eq("amount_cents", intent.cents);
      if (intent.date) q = q.eq("received_on", intent.date);
    } else return [];
    const res = await q.order("received_on", { ascending: false }).limit(PAYMENT_LIMIT);
    if (res.error) {
      note("reading the payments", res.error);
      return [];
    }
    return (res.data ?? []) as PaymentRow[];
  };

  const pledges = async (): Promise<PledgeRow[]> => {
    if (!wantPledges) return [];
    const base = () => db.from("pledges").select(PLEDGE_COLUMNS).eq("center_id", center.id);
    let q;
    if (token) q = base().ilike("pledge_number", likeLiteral(token));
    else if (numbered?.field === "pledge") q = base().ilike("pledge_number", `%${likeLiteral(numbered.value)}`);
    else return [];
    const res = await q.order("pledged_at", { ascending: false }).limit(PLEDGE_LIMIT);
    if (res.error) {
      note("reading the pledges", res.error);
      return [];
    }
    return (res.data ?? []) as PledgeRow[];
  };

  const bank = async (): Promise<BankHit[]> => {
    if (!seesBank || intent.kind !== "lookup" || (intent.cents === null && !intent.words)) return [];
    const base = () => db.from("bank_transactions").select("id, posted_on, amount_cents, description, payer_name, status").eq("center_id", center.id);
    const q =
      intent.cents !== null
        ? intent.date
          ? base().eq("amount_cents", intent.cents).eq("posted_on", intent.date)
          : base().eq("amount_cents", intent.cents)
        : base().or(`description.ilike.%${safeWords(intent.words ?? "")}%,payer_name.ilike.%${safeWords(intent.words ?? "")}%`);
    const res = await q.order("posted_on", { ascending: false }).limit(BANK_LIMIT);
    if (res.error) {
      note("reading the bank lines", res.error);
      return [];
    }
    return (res.data ?? []).map((b) => ({ id: b.id, postedOn: b.posted_on, amountCents: b.amount_cents, description: b.description, payerName: b.payer_name, status: b.status }));
  };

  const campaigns = async (): Promise<CampaignHit[]> => {
    if (!seesCampaigns || intent.kind !== "lookup" || !intent.words || scope !== "giving") return [];
    const words = safeWords(intent.words);
    if (words.length < 2) return [];
    const res = await db.from("campaigns").select("id, name, status, goal_cents").eq("center_id", center.id).ilike("name", `%${words}%`).limit(CAMPAIGN_LIMIT);
    if (res.error) {
      note("reading the campaigns", res.error);
      return [];
    }
    return (res.data ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status, goalCents: c.goal_cents }));
  };

  const familyIds = async (): Promise<{ ids: string[]; more: boolean }> => {
    if (!familyWords) return { ids: [], more: false };
    try {
      const found = await searchHouseholds(db, center.id, familyWords, { limit: 40 });
      if (found.error) note("looking up the families", found.error);
      return { ids: found.householdIds.slice(0, FAMILY_LIMIT), more: found.householdIds.length > FAMILY_LIMIT };
    } catch (error) {
      note("looking up the families", error);
      return { ids: [], more: false };
    }
  };

  const [payRows, pledgeRows, bankHits, campaignHits, fam] = await Promise.all([payments(), pledges(), bank(), campaigns(), familyIds()]);

  // Campaign names for the pledges, and one read of every card the rows need.
  const campaignIds = [...new Set(pledgeRows.map((p) => p.campaign_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (campaignIds.length > 0) {
    const res = await db.from("campaigns").select("id, name").in("id", campaignIds);
    if (res.error) note("reading the campaign names", res.error);
    for (const c of res.data ?? []) names.set(c.id, c.name);
  }
  const cardIds = [...new Set([...fam.ids, ...payRows.map((p) => p.household_id), ...pledgeRows.map((p) => p.household_id)].filter((x): x is string => !!x))];
  const cards = new Map<string, GivingHousehold>();
  if (cardIds.length > 0) {
    try {
      const res = await adultHouseholdCards(db, cardIds, { today, currency: center.currency, majority });
      for (const c of res.cards) cards.set(c.household_id, givingHousehold(c));
    } catch (error) {
      note("reading the household cards", error);
    }
  }

  const found: GivingFound = {
    families: fam.ids.map((id) => cards.get(id)).filter((f): f is GivingHousehold => !!f),
    moreFamilies: fam.more,
    payments: payRows.map(
      (p): PaymentHit => ({
        id: p.id,
        receipt: p.receipt_number,
        amountCents: p.amount_cents,
        refundedCents: p.refunded_cents ?? 0,
        method: p.method,
        status: p.status,
        receivedOn: p.received_on,
        householdId: p.household_id,
      }),
    ),
    pledges: pledgeRows.map(
      (p): PledgeHit => ({
        id: p.id,
        number: p.pledge_number,
        campaign: p.campaign_id ? (names.get(p.campaign_id) ?? null) : null,
        amountCents: p.amount_cents,
        paidCents: p.paid_cents,
        status: p.status,
        householdId: p.household_id,
      }),
    ),
    bank: bankHits,
    campaigns: campaignHits,
    cards,
    ...(pledge ? { designation: pledge.designation, pledgeWho: pledge.familyWords } : {}),
  };

  const createsCampaigns = canAccess(session, "campaignsManage");
  const lane = buildGivingLane(intent, found, {
    currency: fmt.currency,
    locale: fmt.locale,
    timeZone: center.time_zone,
    canRecord,
    canRecordPledge,
    canCreate: { campaign: createsCampaigns, opportunity: createsCampaigns && isModuleEnabled(session, GIVING_ADDONS.opportunities) },
    // "export payments 2026" (slice 9): the list opens with its Export sheet; data.export, and the list's add-on on.
    canExport: canAccess(session, "givingExport"),
    exportBlocked: {
      bank_lines: isModuleEnabled(session, GIVING_ADDONS.bank) ? undefined : "Bank reconciliation is switched off for this community, so there are no bank lines to export.",
      year_end_totals: isModuleEnabled(session, GIVING_ADDONS.statements) ? undefined : "Statements are switched off for this community, so there are no year-end totals to export.",
    },
  });
  // Someone who cannot open People still finds a family by name in Giving (its giving opens in place, never its page).
  const families: FindRow[] =
    intent.kind === "lookup" && !people
      ? found.families.map((f) => ({ kind: "family", id: f.id, title: f.name, cardLine: f.cardLine, why: { code: "name", label: "Name" }, href: familyHref(f.id), score: 50 }))
      : [];
  return { lane, families, problem: failed ? "Some Giving matches could not be looked up just now, so this list may be missing a few. Try again." : null };
}

/** Words for an ILIKE inside a PostgREST `or(...)`: the characters that would break the filter (or act as wildcards) are dropped. */
function safeWords(text: string): string {
  return safeFilterText(text.replace(/[_.']/g, " ")).slice(0, 60);
}
