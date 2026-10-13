// Giving's one tab row in the New look (docs/GIVING_REDESIGN.md section 4): Today, Pledges, Payments, Bank, Campaigns &
// opportunities, Statements, Insights, the kind's word for the counts (Cash, Offering, Collection, Bhandar), Books. Each tab points at a screen that exists today
// and shows only when the person can open it AND its module is on. Pure: the layout, Today and the tests read the same list.
//
// The add-on keys (section 11) are not in the module catalog until M2 lands; isModuleEnabled counts a key the community has
// not switched off as on, so every add-on tab shows until then. Recurring is a view of Payments (slice 3); Labh and Bolis are
// views of Campaigns & opportunities (slice 6, src/lib/giving-campaigns/views.ts).

import { campaignViews, campaignsTabLabel, shownViews } from "@/lib/giving-campaigns/views";
import type { KindProfile } from "@/lib/kind";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess, pathUnder, visibleNav, type ScopedContext } from "@/lib/permissions";
import { countsWord } from "@/lib/wording";

/** Giving's add-on modules (section 11.1), by what they hold. */
export const GIVING_ADDONS = {
  bank: "giving_bank",
  counts: "giving_counts",
  opportunities: "giving_opportunities",
  recurring: "giving_recurring",
  labh: "labh",
  statements: "giving_statements",
  insights: "giving_insights",
} as const;

export type GivingTabKey =
  | "today"
  | "pledges"
  | "payments"
  | "recurring"
  | "bank"
  | "campaigns"
  | "labh"
  | "bolis"
  | "statements"
  | "insights"
  | "counts"
  | "books";

export type GivingTab = {
  key: GivingTabKey;
  label: string;
  href: string;
  /** Addresses that light this tab (the longest match wins); empty for a tab that only jumps to a part of a page. */
  paths: string[];
};

export type TabContext = ScopedContext & { kind: KindProfile };

/** Today is open to anyone who works with payments, and to a second approver who holds only giving.approve (owner, 2026-10-12). */
export function canOpenToday(ctx: ScopedContext): boolean {
  return canAccess(ctx, "payments") || canAccess(ctx, "givingApprove");
}

/** The tab row for this person, in the plan's order. */
export function givingTabs(ctx: TabContext): GivingTab[] {
  const nav = visibleNav(ctx);
  const giving = nav.find((m) => m.key === "giving");
  const tab = (href: string) => giving?.tabs.find((t) => t.href === href);
  const on = (key: string) => isModuleEnabled(ctx, key);
  const out: GivingTab[] = [];

  if (canOpenToday(ctx)) out.push({ key: "today", label: "Today", href: "/giving", paths: ["/giving", "/giving/ask"] });
  if (tab("/giving/pledges")) out.push({ key: "pledges", label: "Pledges", href: "/giving/pledges", paths: ["/giving/pledges"] });
  if (tab("/giving/payments")) out.push({ key: "payments", label: "Payments", href: "/giving/payments", paths: ["/giving/payments", "/giving/recurring"] });
  if (giving && canAccess(ctx, "bank") && on(GIVING_ADDONS.bank)) {
    out.push({ key: "bank", label: "Bank", href: "/giving/payments/bank", paths: ["/giving/payments/bank", "/giving/bank"] });
  }
  // Campaigns & opportunities holds the Campaigns list, Opportunities, Bolis and Labh as views (slice 6): shown when any of
  // them is open to the person, opening on the first; Bolis and Labh keep their screens, which light this tab.
  const views = campaignViews(ctx);
  const firstView = shownViews(views)[0];
  if (giving && firstView) {
    out.push({
      key: "campaigns",
      label: campaignsTabLabel(views),
      href: firstView.href,
      paths: ["/giving/campaigns", "/giving/opportunities", "/giving/labh", "/bolis"],
    });
  }
  const statements = tab("/giving/statements");
  if (statements && on(GIVING_ADDONS.statements)) out.push({ key: "statements", label: "Statements", href: statements.href, paths: ["/giving/statements"] });
  // Insights (B98 slice 1): the community's own numbers, for the giving staff (giving.view or giving.manage).
  if (giving && canAccess(ctx, "paymentsAll") && on(GIVING_ADDONS.insights)) out.push({ key: "insights", label: "Insights", href: "/giving/insights", paths: ["/giving/insights"] });
  if (giving && canAccess(ctx, "counting") && on(GIVING_ADDONS.counts)) {
    // Their own tab since slice 5 (the address /giving/payments?view=counts sends here).
    out.push({ key: "counts", label: countsWord(ctx.kind), href: "/giving/counts", paths: ["/giving/counts"] });
  }
  const accounting = nav.find((m) => m.key === "accounting");
  const close = accounting?.tabs.find((t) => t.href === "/accounting/close");
  if (accounting) out.push({ key: "books", label: "Books", href: close ? close.href : accounting.href, paths: ["/accounting"] });
  return out;
}

/** The tab an address belongs to (longest path wins), or null for a page outside the row. */
export function activeGivingTab(tabs: readonly GivingTab[], pathname: string): GivingTabKey | null {
  let best: GivingTabKey | null = null;
  let bestLen = -1;
  for (const t of tabs) {
    for (const p of t.paths) {
      // Today owns /giving itself only, not every page under it.
      const hit = p === "/giving" ? pathname === "/giving" : pathUnder(pathname, p);
      if (hit && p.length > bestLen) {
        best = t.key;
        bestLen = p.length;
      }
    }
  }
  return best;
}
