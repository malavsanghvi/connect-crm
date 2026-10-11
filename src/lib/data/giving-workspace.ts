import "server-only";

// The Giving workspace page (New look): what its side lists show, read through the EXISTING Giving read commands (the same
// `execute` the screens, ⌘K and Niva use), plus one sum of the open pledges. Each part loads on its own: one that fails says so
// next to it, one the person may not see says "You don't have access to this area", and the rest of the page still works.

import type { CardLabels } from "@/components/household-card";
import { suggestionWords } from "@/lib/assistant/context";
import { identifierRules } from "@/lib/center-rules";
import type { UnmatchedBankData } from "@/lib/commands/catalog/giving-bank-lines";
import type { SecondApproverData, WaitingApproval } from "@/lib/commands/catalog/giving-second-approver";
import type { ZelleWaitingData } from "@/lib/commands/catalog/giving-zelle-waiting";
import type { CloseBlockersData } from "@/lib/commands/catalog/month-close-blockers";
import { assistantToolSetting } from "@/lib/commands/enabled";
import { runScreenCommand } from "@/lib/commands/screen";
import { communityFormat, moneyExample } from "@/lib/community-format";
import { fetchAll } from "@/lib/data/fetch-all";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import {
  approvalsRow,
  bankRow,
  closeView,
  zelleRow,
  type CloseView,
  type Part,
  type PledgeTotals,
  type WaitingRow,
} from "@/lib/giving-workspace/view";
import { pluginName } from "@/lib/kind-samples";
import { isModuleEnabled } from "@/lib/modules";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { workspaceLabel } from "@/lib/workspaces";

export type GivingView = { key: string; label: string; href: string };
export type GivingPrompt = { text: string; href: string | null; comingNext?: boolean };

export type GivingWorkspaceModel = {
  /** The workspace's word in this organization ("Giving", or the kind's own). */
  title: string;
  communityName: string;
  personName: string | null;
  today: string;
  timeZone: string;
  currency: string;
  locale: string;
  labels: CardLabels;
  /** The board's views: this page first, then the existing screens the person can open. */
  views: GivingView[];
  canRecord: boolean;
  /** The community ticked giving.record_payment (off by default): the card may confirm through Niva's ProposalCard. */
  recordByCard: boolean;
  examples: { ask: string; change: string };
  pledges: Part<PledgeTotals>;
  close: Part<CloseView>;
  waiting: { bank: Part<WaitingRow>; zelle: Part<WaitingRow> | null; approvals: Part<{ row: WaitingRow; items: WaitingApproval[] }> };
  prompts: GivingPrompt[];
};

export const RECORD_PAYMENT_COMMAND = "giving.record_payment";

async function fromCommand<T, V>(key: string, input: unknown, doing: string, view: (d: T) => V): Promise<Part<V>> {
  const res = await runScreenCommand<T>(key, input, doing);
  if (!res.ok) return { state: "error", error: res.error };
  if (res.data === undefined) return { state: "error", error: `Could not ${doing} — nothing came back.` };
  return { state: "ok", data: view(res.data) };
}

async function loadPledgeTotals(session: CrmSession): Promise<Part<PledgeTotals>> {
  if (!canAccess(session, "pledges")) return { state: "no_access" };
  const { db, center } = session;
  const { data, error, truncated } = await fetchAll<{ household_id: string; amount_cents: number; paid_cents: number }>((from, to) =>
    db.from("pledges").select("household_id, amount_cents, paid_cents").eq("center_id", center.id).in("status", ["open", "partially_paid"]).order("id").range(from, to),
  );
  if (error) return { state: "error", error: failure("Could not add up the open pledges", error).error };
  let pledged = 0;
  let paid = 0;
  const households = new Set<string>();
  for (const p of data) {
    pledged += p.amount_cents;
    paid += p.paid_cents;
    households.add(p.household_id);
  }
  return { state: "ok", data: { pledged_cents: pledged, paid_cents: paid, open_cents: pledged - paid, households: households.size, pledges: data.length, truncated } };
}

/** Everything the Giving page needs except the conversation itself (that runs in the browser through Server Actions). */
export async function loadGivingWorkspace(session: CrmSession): Promise<GivingWorkspaceModel> {
  const { center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  const seesBank = canAccess(session, "bank");
  const seesClose = canAccess(session, "close");
  const accountingOn = isModuleEnabled(session, "accounting");
  const seesApprovals = canAccess(session, "approvals") && can(session, ["giving.view", "giving.manage", "giving.approve"]);

  const [plugins, pledges, close, bank, approvals] = await Promise.all([
    enabledPaymentPlugins(session),
    loadPledgeTotals(session),
    !seesClose
      ? Promise.resolve<Part<CloseView>>({ state: "no_access" })
      : !accountingOn
        ? Promise.resolve<Part<CloseView>>({ state: "off" })
        : fromCommand<CloseBlockersData, CloseView>("accounting.month_close_blockers", {}, "read the month-end checklist", closeView),
    seesBank ? fromCommand<UnmatchedBankData, WaitingRow>("giving.bank_lines_unmatched", { limit: 3 }, "read the bank lines", bankRow) : Promise.resolve<Part<WaitingRow>>({ state: "no_access" }),
    seesApprovals
      ? fromCommand<SecondApproverData, { row: WaitingRow; items: WaitingApproval[] }>("giving.waiting_for_second_approver", { kind: "all" }, "read what is waiting for a second approver", (d) => ({
          row: approvalsRow(d),
          items: d.items.slice(0, 2),
        }))
      : Promise.resolve<Part<{ row: WaitingRow; items: WaitingApproval[] }>>({ state: "no_access" }),
  ]);

  // Zelle is shown only where the community has switched that payment way on.
  const zelleOn = Array.isArray(plugins) && plugins.includes("zelle");
  const zelleWord = pluginName("zelle");
  const zelle = zelleOn && seesBank ? await fromCommand<ZelleWaitingData, WaitingRow>("giving.zelle_waiting", { limit: 3 }, "read the Zelle reports", (d) => zelleRow(d, zelleWord)) : null;

  const words = suggestionWords({ kind: session.kind, currency: fmt.currency, locale: fmt.locale, paymentPlugins: plugins });
  const prompts: GivingPrompt[] = [
    ...(seesBank ? [{ text: "Which bank lines are still unmatched?", href: "/giving/payments/bank" }] : []),
    ...(seesBank && zelleOn ? [{ text: `Which ${zelleWord} reports are waiting for the bank?`, href: "/giving/payments/bank?view=zelle" }] : []),
    ...(canAccess(session, "pledges") ? [{ text: `Who is behind on ${words.pledges}?`, href: "/giving/pledges" }] : []),
    ...(seesClose && accountingOn ? [{ text: "What is blocking month-end close?", href: "/accounting/close" }] : []),
    // On the board; there is no command for it yet.
    { text: "What do I need to send for year-end statements?", href: null, comingNext: true },
  ];

  const views: GivingView[] = [
    { key: "conversation", label: "Conversation", href: "/giving" },
    ...(canAccess(session, "payments") ? [{ key: "payments", label: "Payments", href: "/giving/payments" }] : []),
    ...(canAccess(session, "pledges") ? [{ key: "pledges", label: "Pledges", href: "/giving/pledges" }] : []),
    ...(seesBank ? [{ key: "bank", label: "Bank", href: "/giving/payments/bank" }] : []),
    ...(seesClose && accountingOn ? [{ key: "books", label: "Books", href: "/accounting/close" }] : []),
  ];

  const canRecord = canAccess(session, "recordPayment");
  const amount = moneyExample(25_000, fmt);
  return {
    title: workspaceLabel("giving", session.kind),
    communityName: center.name,
    personName: session.person?.name ?? null,
    today: todayInTz(center.time_zone),
    timeZone: center.time_zone,
    currency: fmt.currency,
    locale: fmt.locale,
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    views,
    canRecord,
    recordByCard: canRecord && assistantToolSetting(center.rules, RECORD_PAYMENT_COMMAND) === true,
    examples: {
      ask: `Record a ${amount} check from household 1042, received yesterday`,
      change: `“make it ${moneyExample(30_000, fmt)}”, “it was cash”, “received yesterday”`,
    },
    pledges,
    close,
    waiting: { bank, zelle, approvals },
    prompts,
  };
}
