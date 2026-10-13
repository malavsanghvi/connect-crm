// DEV PREVIEW AND TESTS ONLY (src/app/dev/giving-today): invented sample data for a neutral community club, so Giving › Today
// can be drawn, screenshotted and tested without a database. Every name, number and amount is made up. The rows are built by
// the same pure core the real page uses (buildQueue), and the approval rows are filtered by Home's own rule (visibleTaskSources),
// so a role sees here exactly what it would see on the real page.

import type { GivingTodayModel } from "@/lib/data/giving-today";
import { NEUTRAL_KIND, type KindProfile } from "@/lib/kind";
import type { PermissionContext } from "@/lib/permissions";
import { canAccess } from "@/lib/permissions";
import { makeTask, visibleTaskSources, type GivingTaskDetail, type HomeTask } from "@/lib/tasks";
import { word } from "@/lib/wording";

import { buildQueue, type Family, type TodayCan, type TodayInput } from "./queue";
import { givingTabs } from "./tabs";

export const TODAY_COMMUNITY = "Lakeside Community Club";
export const TODAY_DATE = "2026-10-12";
const CURRENCY = "USD";
const LABELS = { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" };

const fam = (id: string, name: string, number: string, orgId: string, primary: string, city: string): Family => ({ id, name, number, orgId, primary, city });

export const TODAY_FAMILIES = {
  adeyemi: fam("1a2b3c4d-0000-4000-8000-000000000127", "Adeyemi household", "0127", "LCC-H-1127", "Tola Adeyemi", "Lakeside"),
  okafor: fam("6f1d2c3b-4a5e-4f60-8a71-9b8c7d6e5f40", "Chidi & María Okafor Household", "0212", "LCC-H-2041", "Chidi Okafor", "Lakeside"),
  okafor2: fam("0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d", "Okafor family", "0388", "LCC-H-2216", "Ngozi Okafor", "Brookfield"),
  lindqvist: fam("1a2b3c4d-0000-4000-8000-000000000305", "Lindqvist household", "0305", "LCC-H-1305", "Grace Lindqvist", "Lakeside"),
  nguyen: fam("1a2b3c4d-0000-4000-8000-000000000441", "Nguyen household", "0441", "LCC-H-1441", "Linh Nguyen", "Millbrook"),
  fernandez: fam("1a2b3c4d-0000-4000-8000-000000000662", "Fernández Ruiz household", "0662", "LCC-H-1662", "Lucía Fernández Ruiz", "Lakeside"),
  kim: fam("1a2b3c4d-0000-4000-8000-000000000388", "Kim household", "0398", "LCC-H-1398", "Daniel Kim", "Brookfield"),
} as const;

const F = TODAY_FAMILIES;

export type TodayRole = "treasurer" | "approver" | "volunteer";
const id = (n: number) => `9e8d7c6b-0000-4000-8000-${String(n).padStart(12, "0")}`;

function detail(d: Partial<GivingTaskDetail> & Pick<GivingTaskDetail, "kind" | "stage" | "id">): GivingTaskDetail {
  return { householdId: null, amountCents: null, reference: null, reason: null, askedBy: null, mine: false, since: null, provider: null, count: 1, ...d };
}

/** Home's task list as the database would give it, before Home's own permission rule picks what a role sees. */
function allTasks(role: TodayRole): HomeTask[] {
  return [
    makeTask("refund", id(1), "Approve refund R-2026-0398 · $40.00 · Adeyemi household", "Paid twice at the autumn fair · requested by Sam Carter", [], undefined,
      detail({ kind: "refund", stage: "second", id: id(1), householdId: F.adeyemi.id, amountCents: 4_000, reference: "R-2026-0398", reason: "Paid twice at the autumn fair", askedBy: "Sam Carter", since: "2026-10-09T15:00:00Z", provider: "offline" })),
    makeTask("refund", id(2), "Approve refund made in Stripe · $25.00 · Kim household", "Refunded outside Weaver", [], undefined,
      detail({ kind: "flagged_refund", stage: "first", id: id(2), householdId: F.kim.id, amountCents: 2_500, reference: "R-2026-0377", provider: "stripe", since: "2026-10-08" })),
    makeTask("writeoff", id(3), "Approve write-off PL-0388 · $150.00 open · Okafor family", "Moved away · requested by you", [], undefined,
      detail({ kind: "write_off", stage: "second", id: id(3), householdId: F.okafor2.id, amountCents: 15_000, reference: "PL-0388", reason: "Moved away in August", askedBy: "Grace Lindqvist", mine: role === "treasurer", since: "2026-10-10T12:00:00Z" })),
    makeTask("writeoff", id(4), "Complete write-off PL-0412 · $120.00 · Nguyen household", "Both approvals are in", [], undefined,
      detail({ kind: "write_off", stage: "complete", id: id(4), householdId: F.nguyen.id, amountCents: 12_000, reference: "PL-0412", reason: "Hardship", askedBy: "Sam Carter", since: "2026-10-07T09:00:00Z" })),
    makeTask("credit", id(5), "Credit to handle · $30.00 · Lindqvist household", "The family cancelled a paid RSVP pledge", [], undefined,
      detail({ kind: "credit", stage: "handle", id: id(5), householdId: F.lindqvist.id, amountCents: 3_000, since: "2026-10-06T10:00:00Z" })),
    makeTask("deposits", "all", "9 bank lines to match", "Money in without a matched gift · 1 check or cash deposit", [{ label: "Open", href: "/giving/bank" }], undefined,
      detail({ kind: "bank_lines", stage: "open", id: "all", count: 9, deposits: 1 })),
    makeTask("deposits", "zelle-unmatched", "1 Zelle report not seen at the bank", "Reported by members more than 10 days ago", [{ label: "Open", href: "/giving/payments/bank?view=zelle" }], undefined,
      detail({ kind: "zelle_unseen", stage: "open", id: "all", count: 1 })),
    makeTask("quickbooks", "failed", "2 QuickBooks postings failed", "Fix them on the sync tab before the month is locked", [{ label: "Open", href: "/accounting/qbo?status=failed" }]),
  ];
}

export const ROLE_PERMISSIONS: Record<TodayRole, string[]> = {
  treasurer: ["giving.view", "giving.manage", "giving.record_offline", "accounting.close", "accounting.manage"],
  approver: ["giving.approve"],
  volunteer: ["giving.record_offline"],
};

export function sampleTodayInput(ctx: PermissionContext & { modulesOff?: readonly string[] }, role: TodayRole = "treasurer"): TodayInput {
  const visible = new Set(visibleTaskSources(ctx).map((s) => s.key));
  const tasks = allTasks(role).filter((t) => visible.has(t.source));
  const seesBank = canAccess(ctx, "bank") || canAccess(ctx, "bankConfirm");
  const seesPledges = canAccess(ctx, "pledges");
  return {
    tasks,
    taskFailures: [],
    families: Object.fromEntries(Object.values(F).map((f) => [f.id, f])),
    bank: seesBank
      ? {
          state: "ok",
          data: {
            totals: { lines: 9, deposits: 1, zelleUnseen: 1 },
            problems: [],
            exact: [
              { reportId: id(20), bankTransactionId: id(21), amountCents: 10_000, sentOn: "2026-10-05", postedOn: "2026-10-06", confirmation: "ZL83920", payerName: "LINH NGUYEN", family: F.nguyen },
              { reportId: id(22), bankTransactionId: id(23), amountCents: 5_000, sentOn: "2026-10-06", postedOn: "2026-10-07", confirmation: "ZL84411", payerName: "D KIM", family: F.kim },
            ],
            gifts: [
              {
                id: id(30),
                postedOn: "2026-10-03",
                amountCents: 12_000,
                description: "ACH CREDIT ADEYEMI T",
                payerName: "ADEYEMI T",
                originatorKind: null,
                suggestionError: null,
                suggestions: [{ family: F.adeyemi, reason: "Payer name learned from 3 earlier gifts", ambiguous: false, reportId: null }],
              },
              {
                id: id(31),
                postedOn: "2026-10-04",
                amountCents: 25_000,
                description: "ONLINE TRANSFER OKAFOR",
                payerName: "OKAFOR",
                originatorKind: null,
                suggestionError: null,
                suggestions: [
                  { family: F.okafor, reason: "Surname matches; an open pledge of $250.00", ambiguous: true, reportId: null },
                  { family: F.okafor2, reason: "Surname matches", ambiguous: true, reportId: null },
                ],
              },
            ],
            deposits: [
              {
                id: id(40),
                postedOn: "2026-10-06",
                amountCents: 31_000,
                description: "DEPOSIT 0418",
                exact: true,
                error: null,
                candidates: [
                  { paymentId: id(41), receipt: "R-2026-0401", method: "Check", amountCents: 10_000, receivedOn: "2026-10-05", checkNumber: "1021", family: F.lindqvist, householdName: null },
                  { paymentId: id(42), receipt: "R-2026-0402", method: "Check", amountCents: 15_000, receivedOn: "2026-10-05", checkNumber: "3310", family: F.fernandez, householdName: null },
                  { paymentId: id(43), receipt: "R-2026-0403", method: "Cash", amountCents: 6_000, receivedOn: "2026-10-05", checkNumber: null, family: null, householdName: "Kim household" },
                ],
              },
            ],
          },
        }
      : null,
    behind: seesPledges
      ? {
          state: "ok",
          data: {
            householdsBehind: 3,
            totalOpenCents: 61_000,
            showing: [
              { family: F.fernandez, pledges: 2, openCents: 36_000, oldestDays: 74 },
              { family: F.okafor2, pledges: 1, openCents: 15_000, oldestDays: 51 },
              { family: F.kim, pledges: 1, openCents: 10_000, oldestDays: 12 },
            ],
          },
        }
      : null,
    apply: seesPledges && canAccess(ctx, "paymentsAll")
      ? {
          state: "ok",
          data: { list: [{ paymentId: id(50), receipt: "R-2026-0409", receivedOn: "2026-10-08", amountCents: 5_000, unappliedCents: 5_000, method: "Cash", family: F.lindqvist }], more: 0 },
        }
      : null,
    counts: canAccess(ctx, "counting")
      ? { state: "ok", data: [{ id: id(60), countedOn: "2026-10-05", totalCents: 41_250, bags: ["118", "119"], counters: ["Sam Carter", "Linh Nguyen"] }] }
      : null,
    close: canAccess(ctx, "close")
      ? {
          state: "ok",
          data: {
            month: "2026-10-01",
            label: "October 2026",
            locked: false,
            done: ["All QuickBooks exceptions cleared"],
            blockers: [
              { item: "Payment payouts matched to bank deposits", why: "Mark done", key: "payouts_matched" },
              { item: "Pledge statements generated", why: "Mark done", key: "statements_generated" },
            ],
          },
        }
      : null,
  };
}

export function sampleTodayModel(role: TodayRole = "treasurer", opts: { kind?: KindProfile; show?: string } = {}): GivingTodayModel {
  const kind = opts.kind ?? NEUTRAL_KIND;
  const ctx = { permissions: ROLE_PERMISSIONS[role], isPlatformAdmin: false, modulesOff: ["bolis"], kind };
  const can: TodayCan = {
    approve: canAccess(ctx, "givingApprove"),
    manage: canAccess(ctx, "givingManage"),
    bankConfirm: canAccess(ctx, "bankConfirm"),
    allocate: canAccess(ctx, "allocatePayment"),
    countRecord: canAccess(ctx, "countingRecord"),
    closeManage: canAccess(ctx, "closeManage"),
  };
  const countsWord = word(kind, "offering_counts");
  const input = sampleTodayInput(ctx, role);
  const queue = buildQueue(input, {
    can,
    currency: CURRENCY,
    locale: "en-US",
    timeZone: "America/Chicago",
    today: TODAY_DATE,
    labels: LABELS,
    countsWord,
    zelleWord: "Zelle",
    visible: {
      approvals: can.approve || can.manage,
      bank: input.bank !== null,
      pledges: input.behind !== null,
      counts: input.counts !== null,
      books: input.close !== null,
    },
  });
  const tile = (k: string) => queue.tiles.find((t) => t.key === k)?.count;
  const seesPayments = canAccess(ctx, "payments");
  return {
    title: "Giving",
    communityName: TODAY_COMMUNITY,
    today: TODAY_DATE,
    timeZone: "America/Chicago",
    currency: CURRENCY,
    locale: "en-US",
    labels: LABELS,
    tabs: givingTabs(ctx),
    tabCounts: { bank: tile("bank"), pledges: tile("pledges"), counts: tile("counts"), books: tile("books") },
    queue,
    can: { ...can, record: canAccess(ctx, "recordPayment") },
    countsWord,
    roleNote:
      role === "approver"
        ? "You are the second approver. You can approve what someone else asked for; never your own request."
        : role === "volunteer"
          ? "Limited view: you see what you can act on. Approvals, write-offs and applying payments are for the treasurer and the second approver."
          : null,
    month: {
      label: "October 2026",
      recorded: seesPayments ? { state: "ok", data: { cents: 842_000, onlyMine: !canAccess(ctx, "paymentsAll"), truncated: false } } : { state: "no_access" },
      open: canAccess(ctx, "pledges")
        ? { state: "ok", data: { pledged_cents: 9_600_000, paid_cents: 6_455_000, open_cents: 3_145_000, households: 118, pledges: 131, truncated: false } }
        : { state: "no_access" },
      matched: canAccess(ctx, "bank") ? { state: "ok", data: { matched: 31, total: 40 } } : { state: "no_access" },
    },
    recent: seesPayments ? { state: "ok", data: [F.adeyemi, F.lindqvist, F.nguyen, F.fernandez] } : { state: "no_access" },
    initialTile: opts.show && queue.tiles.some((t) => t.key === opts.show) ? (opts.show as GivingTodayModel["initialTile"]) : "all",
  };
}
