import { isModuleEnabled } from "@/lib/modules";
import { reportReads } from "@/lib/reports/load";
import type { PeriodFigures } from "@/lib/reports/parse";
import { compareMonths, pctChange } from "@/lib/reports/periods";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { changeWords, got, mayAccess, moneyOf, notShown, todayOf } from "./shared";

export type CompareRow = {
  what: string;
  this_month: string;
  last_month: string;
  /** The difference as a signed whole number (cents for money). */
  difference: number;
  change_percent: number | null;
  change: string | null;
};

export type CompareMonthsData = {
  month: string;
  compared_with: string;
  /** True when the month is still going: it is compared with the same days of last month. */
  month_in_progress: boolean;
  this_month: { from: string; to: string };
  last_month: { from: string; to: string };
  rows: CompareRow[];
  /** The whole of last month, when this month is still going. */
  last_month_in_full: { from: string; to: string; rows: { what: string; value: string }[] } | null;
  not_shown: { area: string; reason: string }[];
};

const input = object({
  month: f.optional(f.string("The month to look at, like 2026-10. Leave out for this month so far.", { min: 7, max: 7 })),
});

type Line = { what: string; kind: "money" | "count"; pick: (p: PeriodFigures) => number };

/** The same figures for two months side by side. */
export const compareMonthsCommand = defineCommand<Infer<typeof input>, CompareMonthsData>({
  key: "reports.compare_months",
  title: "Compare this month with last month",
  description:
    "Put two months side by side: money received, payments, new households, memberships started, applications received, event check-ins and store sales. " +
    "Leave the month out for this month so far, which is compared with the same days of last month; or name a finished month like 2026-09 to compare it with the month before. " +
    "Use it for 'how did this month compare with last month?'. The sums are done by the database and are exact. Areas the person's role cannot see are left out and listed in not_shown. " +
    "Counts and sums only: no person or household is named. Read only.",
  level: "read",
  permission: "reports",
  module: "reports",
  input,
  async execute(ctx, { month }) {
    const { db, center } = ctx.session;
    const cmp = compareMonths(todayOf(ctx), month);
    if (!cmp.ok) throw new CommandError(cmp.error);
    const money = moneyOf(ctx);
    const seesGiving = mayAccess(ctx, "paymentsAll");
    const seesPeople = mayAccess(ctx, "memberships");
    const seesEvents = mayAccess(ctx, "events") && isModuleEnabled(ctx.session, "events");
    const seesStore = mayAccess(ctx, "store") && isModuleEnabled(ctx.session, "store");

    const lines: Line[] = [
      ...(seesGiving
        ? ([
            { what: "Money received, net of refunds", kind: "money", pick: (p) => p.giving.netCents },
            { what: "Payments received", kind: "count", pick: (p) => p.giving.payments },
          ] as Line[])
        : []),
      ...(seesPeople
        ? ([
            { what: "New households", kind: "count", pick: (p) => p.newHouseholds },
            { what: "Memberships started", kind: "count", pick: (p) => p.membershipsStarted },
            { what: "Membership applications received", kind: "count", pick: (p) => p.applicationsReceived },
          ] as Line[])
        : []),
      ...(seesEvents ? ([{ what: "Event check-ins", kind: "count", pick: (p) => p.checkIns }] as Line[]) : []),
      ...(seesStore
        ? ([
            { what: "Store sales", kind: "money", pick: (p) => p.store.salesCents },
            { what: "Store orders", kind: "count", pick: (p) => p.store.orders },
          ] as Line[])
        : []),
    ];
    const show = (kind: Line["kind"], n: number) => (kind === "money" ? money(n) : n.toLocaleString("en-US"));

    const [now, before, full] = await Promise.all([
      reportReads.periodFigures(db, center.id, cmp.current.from, cmp.current.to),
      reportReads.periodFigures(db, center.id, cmp.previous.from, cmp.previous.to),
      cmp.partial ? reportReads.periodFigures(db, center.id, cmp.previousFull.from, cmp.previousFull.to) : null,
    ]);
    const a = got(now, "read this month's figures");
    const b = got(before, "read last month's figures");
    const c = full ? got(full, "read the whole of last month's figures") : null;

    const rows: CompareRow[] = lines.map((l) => {
      const x = l.pick(a);
      const y = l.pick(b);
      const change = pctChange(x, y);
      return { what: l.what, this_month: show(l.kind, x), last_month: show(l.kind, y), difference: x - y, change_percent: change, change: changeWords(change) };
    });
    const data: CompareMonthsData = {
      month: cmp.current.label,
      compared_with: cmp.previous.label,
      month_in_progress: cmp.partial,
      this_month: { from: cmp.current.from, to: cmp.current.to },
      last_month: { from: cmp.previous.from, to: cmp.previous.to },
      rows,
      last_month_in_full: c ? { from: cmp.previousFull.from, to: cmp.previousFull.to, rows: lines.map((l) => ({ what: l.what, value: show(l.kind, l.pick(c)) })) } : null,
      not_shown: [
        !seesGiving ? notShown("Giving") : null,
        !seesPeople ? notShown("Households, memberships and applications") : null,
        !seesEvents ? notShown("Event check-ins") : null,
        !seesStore ? notShown("Store sales") : null,
      ].flatMap((x) => (x ? [x] : [])),
    };
    const lead = rows[0];
    return {
      ok: true,
      data,
      message: lead
        ? `${cmp.current.label}${cmp.partial ? " so far" : ""} against ${cmp.previous.label}${cmp.partial ? " (same days)" : ""}: ${lead.what.toLowerCase()} ${lead.this_month} against ${lead.last_month}.`
        : "There is nothing to compare for the areas this role can see.",
    };
  },
});
