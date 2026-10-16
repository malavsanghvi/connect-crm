// The Bank tab's Reconcile and Unbanked views (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5, 0868). Pure: no database, no React.
//
// app.reconcile_statement returns every unmatched incoming line with its best candidates, strongest first, each with its tier
// (A certain, B likely, C possible, D needs a look), reasons, and the exact consequence in words. NOTHING is written by reading it.
// This file reads that answer, groups the lines for the preview, and says which existing action each candidate maps to:
//   payment      attach_bank_line_to_payment        (no pledge changes)
//   proof        approve_payment_proof + bank line  (approve and reconcile in one step; nothing is created twice)
//   zelle_report confirm_bank_match with the report (the existing confirm flow)
//   new_money    confirm_bank_match                 (the existing confirm flow; only pledges not already covered)
//   lookalike    attach to the payment (or approve the proof) it looks like, or a typed reason that it is a separate gift (CCDUP)
//   conflict     the amount differs: record the bank's amount (a proof) with a reason, or leave the line

import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

export type Tier = "A" | "B" | "C" | "D";
export type CandidateKind = "payment" | "proof" | "zelle_report" | "conflict" | "lookalike" | "new_money";

export type Candidate = {
  tier: Tier;
  kind: CandidateKind;
  /** The payment, proof or Zelle report it points to; null for new money and lookalikes. */
  refId: string | null;
  householdId: string;
  householdName: string | null;
  label: string;
  reasons: string[];
  /** "If you apply: ..." */
  consequence: string;
  blocked: boolean;
};

export type StatementLine = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  channel: string | null;
  reference: string | null;
  payerName: string | null;
  candidates: Candidate[];
};

const TIERS: readonly string[] = ["A", "B", "C", "D"];
const KINDS: readonly string[] = ["payment", "proof", "zelle_report", "conflict", "lookalike", "new_money"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Read what reconcile_statement returned. null when it is not the shape this screen knows (the caller says so; it never shows an empty preview). */
export function parseStatement(data: unknown): StatementLine[] | null {
  if (!Array.isArray(data)) return null;
  const lines: StatementLine[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const t = o.txn as Record<string, unknown> | null | undefined;
    if (!t || typeof t !== "object") return null;
    const id = str(t.id);
    const postedOn = str(t.posted_on);
    const amount = typeof t.amount_cents === "number" ? t.amount_cents : Number(t.amount_cents);
    if (!id || !postedOn || !Number.isFinite(amount)) return null;
    const cands = o.candidates === undefined || o.candidates === null ? [] : o.candidates;
    if (!Array.isArray(cands)) return null;
    const candidates: Candidate[] = [];
    for (const c of cands) {
      if (!c || typeof c !== "object") return null;
      const co = c as Record<string, unknown>;
      const tier = typeof co.tier === "string" && TIERS.includes(co.tier) ? (co.tier as Tier) : null;
      const kind = typeof co.kind === "string" && KINDS.includes(co.kind) ? (co.kind as CandidateKind) : null;
      const householdId = str(co.household_id);
      if (!tier || !kind || !householdId) return null;
      candidates.push({
        tier,
        kind,
        refId: str(co.ref_id),
        householdId,
        householdName: str(co.household_name),
        label: str(co.label) ?? "",
        reasons: Array.isArray(co.reasons) ? co.reasons.filter((r): r is string => typeof r === "string") : [],
        consequence: str(co.consequence) ?? "",
        blocked: co.blocked === true,
      });
    }
    lines.push({
      id,
      postedOn,
      amountCents: amount,
      description: str(t.description) ?? "",
      channel: str(t.channel),
      reference: str(t.reference),
      payerName: str(t.payer_name),
      candidates,
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------- Groups

export type GroupKey = "certain" | "likely" | "possible" | "conflict" | "already" | "money" | "review";

export const GROUPS: readonly { key: GroupKey; title: string; desc: string }[] = [
  {
    key: "certain",
    title: "Certain",
    desc: "Exact amount, a matching reference or known payer name, inside the window, one candidate. May be applied together; each row is checked again as it is applied.",
  },
  { key: "likely", title: "Likely", desc: "Exact amount and window, one candidate, but the family or reference is inferred. One click each." },
  { key: "possible", title: "Possible", desc: "Several candidates, or weak identity. Never a default: you choose." },
  { key: "conflict", title: "Conflict", desc: "Same family and method, but the amount differs." },
  {
    key: "already",
    title: "Already accounted for",
    desc: "This money looks like a payment or proof already counted. Creating a second payment is blocked unless you say why it is a different gift.",
  },
  {
    key: "money",
    title: "New money",
    desc: "Nothing recorded or waiting explains this. Only now may it close pledges, and only pledges not already covered.",
  },
  { key: "review", title: "Needs review", desc: "No family or payment could be found for these lines. Match them by hand in Gifts to match." },
];

/** The group a line is shown in: by its best (first) candidate. A line with no candidate needs review. */
export function groupOf(line: StatementLine): GroupKey {
  const best = line.candidates[0];
  if (!best) return "review";
  if (best.kind === "conflict") return "conflict";
  if (best.kind === "lookalike") return "already";
  if (best.kind === "new_money") return "money";
  return best.tier === "A" ? "certain" : best.tier === "B" ? "likely" : "possible";
}

export type LineGroup = { key: GroupKey; title: string; desc: string; lines: StatementLine[]; batch: boolean };

/** The preview, grouped. Empty groups are left out; the order is the order above. */
export function groupLines(lines: readonly StatementLine[]): LineGroup[] {
  const by = new Map<GroupKey, StatementLine[]>();
  for (const l of lines) {
    const k = groupOf(l);
    by.set(k, [...(by.get(k) ?? []), l]);
  }
  return GROUPS.filter((g) => (by.get(g.key) ?? []).length > 0).map((g) => ({ ...g, lines: by.get(g.key) ?? [], batch: g.key === "certain" }));
}

/** The kinds a Tier A batch may apply: money that is already explained, never new money. */
const BATCH_KINDS: readonly CandidateKind[] = ["payment", "proof", "zelle_report"];

/**
 * A row may join the "Apply the Certain rows" batch only when its best candidate is Tier A, explains the money already (a recorded
 * payment, a waiting proof, a member's Zelle report), is not blocked, and is the ONLY Tier A candidate on the line.
 */
export function isBatchEligible(line: StatementLine): boolean {
  const best = line.candidates[0];
  if (!best || best.tier !== "A" || best.blocked || !BATCH_KINDS.includes(best.kind)) return false;
  return line.candidates.filter((c) => c.tier === "A").length === 1;
}

// ---------------------------------------------------------------------------- What a candidate does

const KIND_WORD: Record<CandidateKind, string> = {
  payment: "Banks a payment already recorded",
  proof: "Settles a waiting proof",
  zelle_report: "Matches a member's Zelle report",
  conflict: "The amount differs",
  lookalike: "Lookalike: blocked",
  new_money: "New money",
};

export function kindWord(kind: CandidateKind): string {
  return KIND_WORD[kind];
}

export const TIER_WORD: Record<Tier, string> = { A: "Certain", B: "Likely", C: "Possible", D: "Needs a look" };

/** What a candidate's button does. `conflict` needs to know whether the thing it points to is a proof or a payment (`resolved`). */
export type RowAction =
  | { type: "attach"; paymentId: string; label: string }
  | { type: "approve"; proofId: string; label: string }
  | { type: "confirm"; householdId: string; reportId: string | null; label: string }
  | { type: "lookalike"; householdId: string }
  | { type: "conflict_proof"; proofId: string; label: string }
  | { type: "conflict_payment" }
  | { type: "none"; why: string };

export function rowAction(c: Candidate, resolved: "proof" | "payment" | null, line: Pick<StatementLine, "amountCents">, currency: string, locale?: string): RowAction {
  switch (c.kind) {
    case "payment":
      return c.refId ? { type: "attach", paymentId: c.refId, label: "Attach to this payment" } : { type: "none", why: "The payment was not named." };
    case "proof":
      return c.refId ? { type: "approve", proofId: c.refId, label: "Approve and reconcile" } : { type: "none", why: "The proof was not named." };
    case "zelle_report":
      return { type: "confirm", householdId: c.householdId, reportId: c.refId, label: "Confirm" };
    case "new_money":
      return { type: "confirm", householdId: c.householdId, reportId: null, label: "Confirm" };
    case "lookalike":
      return { type: "lookalike", householdId: c.householdId };
    case "conflict":
      if (resolved === "proof" && c.refId) return { type: "conflict_proof", proofId: c.refId, label: `Approve at ${formatCents(line.amountCents, currency, locale)} and reconcile` };
      if (resolved === "payment") return { type: "conflict_payment" };
      return { type: "none", why: "Could not tell whether this is a payment or a proof. Open the family to look." };
  }
}

/** "Oct 14 · CHECK 1048 DEPOSITED" */
export function lineHeading(l: Pick<StatementLine, "postedOn" | "description">, timeZone: string): string {
  return `${formatDate(l.postedOn, timeZone)} · ${l.description}`;
}

// ---------------------------------------------------------------------------- The batch

export type BatchOutcome = { lineId: string; ok: boolean; message: string };

/** One line per row, in the order they ran: what the person sees after "Apply the ticked Certain rows". */
export function batchSummary(outcomes: readonly BatchOutcome[]): { done: number; failed: number; text: string } {
  const done = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - done;
  const text =
    outcomes.length === 0
      ? "No rows were ticked."
      : failed === 0
        ? `All ${done} row${done === 1 ? "" : "s"} applied.`
        : `${done} applied, ${failed} did not go through. Each row below says what happened; nothing was retried.`;
  return { done, failed, text };
}
