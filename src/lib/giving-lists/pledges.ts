// Giving › Pledges in the New look (docs/GIVING_REDESIGN.md section 4, slice 3). Pure: no React, no database.
//
// "Behind" is the rule of giving.pledges_behind (0656), so the Pledges tab, Today's "Pledges behind" row and Niva's answer agree:
// a pledge is behind from its due date, or from 30 days after it was pledged when it has no due date, while some of it is still
// open; its age falls in 1 to 30, 31 to 60, 61 to 90 or over 90 days. Each row acts in place through the same sheets as Today:
// Record payment, Write off…, Approve as second person (never one's own request), Complete the write-off, Open family.

import { addDays, dateInTz, daysBetween, formatDate } from "@/lib/dates";
import { familyRef, type Act, type Family } from "@/lib/giving-today/queue";
import { formatCents } from "@/lib/money";
import { isBankReconciled, softCreditWaitingCents, stillToPayCents } from "@/lib/pledge-balance";

import { familyHref, recordPaymentHref } from "./links";
import type { Chip, ListContext, ListRow, Tone } from "./types";

export const OPEN_STATUSES = ["open", "partially_paid"] as const;
export const CLOSED_STATUSES = ["paid", "written_off", "cancelled"] as const;
/** Soft credit: fully covered by claims nobody has verified yet. Not open (no reminder, no new money), not closed (not final). */
export const SOFT_CREDIT_STATUS = "soft_credit";

export function isOpenStatus(status: string): boolean {
  return status === "open" || status === "partially_paid";
}

// ---------------------------------------------------------------------------- Chips and aging

export type PledgeChipKey = "open" | "behind" | "waiting" | "soft" | "closed" | "all";

export const PLEDGE_CHIPS: readonly { key: PledgeChipKey; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "behind", label: "Behind" },
  { key: "waiting", label: "Waiting for approval" },
  { key: "soft", label: "Soft credit" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

/** Old `?status=` values from the classic Pledges page land on the right chip; the New look opens on Open. */
export function pledgeChipFromParam(value: string | undefined): PledgeChipKey {
  if (value === "behind" || value === "waiting" || value === "all") return value;
  if (value === "soft" || value === "soft_credit") return "soft";
  if (value === "closed" || value === "paid" || value === "written_off" || value === "cancelled") return "closed";
  return "open";
}

export const BEHIND_BUCKETS = [
  { key: "d1_30", label: "1 to 30 days", min: 1, max: 30 },
  { key: "d31_60", label: "31 to 60 days", min: 31, max: 60 },
  { key: "d61_90", label: "61 to 90 days", min: 61, max: 90 },
  { key: "d90_plus", label: "Over 90 days", min: 91, max: Number.POSITIVE_INFINITY },
] as const;

export type BehindBucketKey = (typeof BEHIND_BUCKETS)[number]["key"];

export function bucketFromParam(value: string | undefined): BehindBucketKey | null {
  return BEHIND_BUCKETS.find((b) => b.key === value)?.key ?? null;
}

export function behindBucket(days: number): BehindBucketKey | null {
  return BEHIND_BUCKETS.find((b) => days >= b.min && days <= b.max)?.key ?? null;
}

type Owing = { amountCents: number; paidCents: number; softCreditCents?: number; status: string; pledgedAt: string; dueOn: string | null };

/** What is still to pay: amount - paid - soft credit (the Open balance rule, owner 2026-10-15). */
export function owedCents(p: Pick<Owing, "amountCents" | "paidCents" | "softCreditCents">): number {
  return stillToPayCents({ amount_cents: p.amountCents, paid_cents: p.paidCents, soft_credit_cents: p.softCreditCents });
}

/** Days a pledge is behind (giving.pledges_behind, 0656); 0 when it is not behind, closed or paid up. */
export function behindDays(p: Owing, today: string, timeZone: string): number {
  if (!isOpenStatus(p.status) || owedCents(p) <= 0) return 0;
  const from = p.dueOn ?? addDays(dateInTz(p.pledgedAt, timeZone), 30);
  return Math.max(0, daysBetween(from, today));
}

/** An open pledge as the chips need it: one read of every open pledge of the community (under the search), a few columns each. */
export type OpenPledgeLite = Owing & { id: string; writeOffBy: string | null };

export type OpenSummary = {
  open: { count: number; cents: number };
  behind: { count: number; cents: number };
  waiting: number;
  buckets: Record<BehindBucketKey, { count: number; cents: number }>;
};

export function summarizeOpen(list: readonly OpenPledgeLite[], today: string, timeZone: string): OpenSummary {
  const buckets = Object.fromEntries(BEHIND_BUCKETS.map((b) => [b.key, { count: 0, cents: 0 }])) as OpenSummary["buckets"];
  const out: OpenSummary = { open: { count: 0, cents: 0 }, behind: { count: 0, cents: 0 }, waiting: 0, buckets };
  for (const p of list) {
    if (!isOpenStatus(p.status)) continue;
    const open = owedCents(p);
    out.open.count += 1;
    out.open.cents += open;
    if (p.writeOffBy) out.waiting += 1;
    const days = behindDays(p, today, timeZone);
    const b = behindBucket(days);
    if (b) {
      out.behind.count += 1;
      out.behind.cents += open;
      buckets[b].count += 1;
      buckets[b].cents += open;
    }
  }
  return out;
}

/** The open pledges a chip (and an aging bucket) shows, newest first, as the classic list orders them. */
export function selectOpen(
  list: readonly OpenPledgeLite[],
  chip: "open" | "behind" | "waiting",
  bucket: BehindBucketKey | null,
  today: string,
  timeZone: string,
): OpenPledgeLite[] {
  return list
    .filter((p) => {
      if (!isOpenStatus(p.status)) return false;
      const days = behindDays(p, today, timeZone);
      if (bucket) return behindBucket(days) === bucket;
      if (chip === "behind") return days > 0;
      if (chip === "waiting") return p.writeOffBy !== null;
      return true;
    })
    .sort((a, b) => (a.pledgedAt === b.pledgedAt ? (a.id < b.id ? 1 : -1) : a.pledgedAt < b.pledgedAt ? 1 : -1));
}

export function pledgeChips(
  summary: OpenSummary | null,
  closedCount: number | null,
  active: PledgeChipKey,
  bucket: BehindBucketKey | null,
  hrefFor: (chip: PledgeChipKey) => string,
  softCount: number | null = null,
): Chip[] {
  const count: Record<PledgeChipKey, number | null> = {
    open: summary?.open.count ?? null,
    behind: summary?.behind.count ?? null,
    waiting: summary?.waiting ?? null,
    soft: softCount,
    closed: closedCount,
    all: summary && closedCount !== null && softCount !== null ? summary.open.count + closedCount + softCount : null,
  };
  return PLEDGE_CHIPS.map((c) => ({ key: c.key, label: c.label, href: hrefFor(c.key), count: count[c.key], on: !bucket && c.key === active }));
}

export function bucketChips(
  summary: OpenSummary | null,
  bucket: BehindBucketKey | null,
  money: (cents: number) => string,
  hrefFor: (bucket: BehindBucketKey) => string,
): Chip[] {
  if (!summary) return [];
  return BEHIND_BUCKETS.map((b) => ({
    key: b.key,
    label: `${b.label} · ${money(summary.buckets[b.key].cents)}`,
    href: hrefFor(b.key),
    count: summary.buckets[b.key].count,
    on: bucket === b.key,
  }));
}

// ---------------------------------------------------------------------------- Rows

export type PledgeIn = {
  id: string;
  number: string | null;
  householdId: string;
  campaign: string | null;
  amountCents: number;
  paidCents: number;
  /** Claims waiting to be verified (soft credit); the part of the pledge that is covered but not yet paid. */
  softCreditCents?: number;
  status: string;
  /** Paid, and every payment on it matched to a bank line: "Bank reconciled" (a column, not a status). */
  reconciledAt?: string | null;
  pledgedAt: string;
  dueOn: string | null;
  /** The write-off request (two-person rule, 0016): who asked, who approved second, why, and when it last changed. */
  writeOffBy: string | null;
  writeOffByName: string | null;
  writeOffSecond: string | null;
  writeOffReason: string | null;
  writeOffSince: string | null;
  /** Written off in an old system and brought in (the name is all that came with it). */
  importedWriteOffBy: string | null;
  /** What a written-off pledge became in QuickBooks (0412). */
  posting: { tone: Tone; label: string } | null;
};

function statusOf(p: PledgeIn, days: number): { label: string; tone: Tone } {
  if (isOpenStatus(p.status) && p.writeOffBy) {
    return p.writeOffSecond ? { label: "Write-off approved by two", tone: "ok" } : { label: "Write-off asked", tone: "warn" };
  }
  if (p.status === "written_off") return { label: "Written off", tone: "muted" };
  if (p.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (p.status === SOFT_CREDIT_STATUS) return { label: "Soft credit", tone: "info" };
  if (p.status === "paid") return isBankReconciled({ status: p.status, reconciled_at: p.reconciledAt }) ? { label: "Bank reconciled", tone: "ok" } : { label: "Paid", tone: "ok" };
  if (days > 0) return { label: `${days} ${days === 1 ? "day" : "days"} behind`, tone: days > 90 ? "bad" : "warn" };
  return { label: p.status === "partially_paid" ? "Part paid" : "Open", tone: "info" };
}

export function pledgeRow(p: PledgeIn, family: Family | null, ctx: ListContext, found: string | null = null): ListRow {
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const open = isOpenStatus(p.status);
  const openCents = owedCents(p);
  const soft = softCreditWaitingCents({ amount_cents: p.amountCents, paid_cents: p.paidCents, soft_credit_cents: p.softCreditCents, status: p.status });
  const days = behindDays(p, ctx.today, ctx.timeZone);
  const ref = p.number ?? "the pledge";
  const fam = familyRef(family);
  const amt = money(openCents);
  const asked = p.writeOffBy === ctx.me ? "you" : (p.writeOffByName ?? "a colleague");

  const lines: string[] = [`${p.campaign ?? "No campaign"} · ${p.dueOn ? `due ${formatDate(p.dueOn, ctx.timeZone)}` : "no due date"}`];
  if (soft > 0) lines.push(`Soft credit ${money(soft)} waiting to be verified${open ? `; ${amt} is still to pay` : ""}`);
  if (p.status === "paid" && p.reconciledAt) lines.push("Every payment on it is matched to the bank");
  if (open && p.writeOffBy) {
    lines.push(`Write-off asked by ${asked}${p.writeOffSince ? ` on ${formatDate(p.writeOffSince, ctx.timeZone)}` : ""}`);
    lines.push(p.writeOffReason ? `Reason: “${p.writeOffReason}”` : "No reason was written down. Ask the person who requested it.");
  }
  if (p.status === "written_off") {
    if (p.writeOffReason) lines.push(`Reason: “${p.writeOffReason}”`);
    if (p.importedWriteOffBy) lines.push(`Written off by ${p.importedWriteOffBy} (brought in from the old system)`);
    if (p.posting) lines.push(p.posting.label);
  }

  const primary: Act[] = [];
  const menu: Act[] = [];
  let note: string | null = null;
  // Edit or delete (0782): giving.manage; a deleted (cancelled) pledge stays as it is. The sheet shows what the database locks and why.
  if (ctx.can.manage && p.status !== "cancelled") menu.push({ kind: "edit_pledge", id: p.id, reference: ref, label: "Edit pledge…" });
  if (open && ctx.can.record) menu.push({ kind: "record_payment", householdId: p.householdId, href: recordPaymentHref(p.householdId), label: "Record payment" });
  // Not while a write-off waits for approval (app.set_pledge_due_on refuses it too).
  if (open && ctx.can.manage && !p.writeOffBy) {
    menu.push({ kind: "change_due", id: p.id, reference: ref, dueOn: p.dueOn, pledgedOn: dateInTz(p.pledgedAt, ctx.timeZone), label: "Change due date…" });
  }
  if (open && !p.writeOffBy && ctx.can.manage && openCents > 0) {
    menu.push({ kind: "request_write_off", id: p.id, openCents, reference: ref, label: "Write off…" });
  }
  if (open && p.writeOffBy && !p.writeOffSecond) {
    if (p.writeOffBy !== ctx.me && ctx.can.approve) {
      primary.push({
        kind: "approve",
        table: "pledges",
        id: p.id,
        label: `Approve ${amt} write-off for ${fam}`,
        what: `You are the second approver. A treasurer then completes the write-off, and ${ref} stops counting as owed. This cannot be undone here.`,
        done: `Done: second approval recorded for the ${amt} write-off of ${ref} (${fam}).`,
      });
    } else {
      note =
        p.writeOffBy === ctx.me
          ? "You asked for this write-off, so a different person with approval rights approves it."
          : "Waiting for a second approver with approval rights.";
    }
    if (ctx.can.manage) menu.push({ kind: "withdraw_write_off", id: p.id, reference: ref, label: "Withdraw the write-off request" });
  }
  if (open && p.writeOffBy && p.writeOffSecond) {
    if (ctx.can.manage) {
      primary.push({
        kind: "complete_write_off",
        id: p.id,
        label: `Write off ${amt} for ${fam}`,
        what: `${ref} stops counting as owed, and the write-off goes to the books. This cannot be undone here.`,
      });
    } else {
      note = "Approved by two people. A treasurer completes the write-off.";
    }
  }
  // Print and Email (0791, 0792): the pledge as an invoice-style PDF, on paper or by email to the primary member (or any typed address). A deleted pledge has neither.
  if (ctx.can.print === true && p.status !== "cancelled") menu.push({ kind: "print_pledge", id: p.id, reference: ref, label: "Print…" });
  if (ctx.can.manage && p.status !== "cancelled") menu.push({ kind: "email_pledge", id: p.id, reference: ref, label: "Email…" });
  menu.push({ kind: "link", href: familyHref(p.householdId, "pledges"), label: "Open family" });

  return {
    id: p.id,
    reference: p.number ?? "—",
    family,
    title: open ? `Pledge ${ref} · ${amt} open of ${money(p.amountCents)}` : `Pledge ${ref} · ${money(p.amountCents)}`,
    lines,
    amount: open ? amt : money(p.amountCents),
    amountNote: open ? `open of ${money(p.amountCents)}` : p.status === "written_off" && p.paidCents > 0 ? `${money(p.paidCents)} was paid` : null,
    date: formatDate(p.pledgedAt, ctx.timeZone),
    status: statusOf(p, days),
    note,
    found,
    primary,
    menu,
    history: { table: "pledges", title: `Pledge ${p.number ?? ""}`.trim() },
  };
}
