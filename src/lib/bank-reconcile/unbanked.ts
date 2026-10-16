// "Paid, not on the bank" (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5.8, scenario C26). Pure: no database, no React.
//
// app.unbanked_payments_report (0868) lists payments counted as paid that no bank line has banked, with how many days it has been and
// the usual window for their method. A payment past its window is the safety net behind "closed by soft credit with no bank
// reconciliation": it is flagged, never hidden, and the next step is said in words.

export type UnbankedRow = {
  paymentId: string;
  receipt: string | null;
  householdId: string;
  householdName: string | null;
  method: string;
  amountCents: number;
  verifiedOn: string;
  /** "proof" (a member's verified proof) or "recorded by hand". */
  source: string;
  days: number;
  window: number;
  pastWindow: boolean;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function int(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Read what unbanked_payments_report returned. null when it is not the shape this screen knows. */
export function parseUnbanked(data: unknown): UnbankedRow[] | null {
  if (!Array.isArray(data)) return null;
  const rows: UnbankedRow[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const paymentId = str(o.payment_id);
    const householdId = str(o.household_id);
    if (!paymentId || !householdId) return null;
    rows.push({
      paymentId,
      receipt: str(o.receipt_number),
      householdId,
      householdName: str(o.household_name),
      method: str(o.method) ?? "other",
      amountCents: int(o.amount_cents),
      verifiedOn: str(o.verified_on) ?? "",
      source: str(o.source) ?? "recorded by hand",
      days: int(o.days),
      window: int(o.window),
      pastWindow: o.past_window === true,
    });
  }
  return rows;
}

export function sourceWord(source: string): string {
  return source === "proof" ? "Member proof" : "Recorded by hand";
}

/** "35 / 30 · past", "7 / 7 · due today", "3 / 14". */
export function daysText(r: Pick<UnbankedRow, "days" | "window" | "pastWindow">): string {
  if (r.pastWindow) return `${r.days} / ${r.window} · past`;
  if (r.days >= r.window) return `${r.days} / ${r.window} · due today`;
  return `${r.days} / ${r.window}`;
}

/** The next step, by how the money was paid. Cash banks inside a deposit or an offering count; the others have a line of their own. */
export function nextStep(r: Pick<UnbankedRow, "method" | "pastWindow" | "days" | "window">): string {
  if (!r.pastWindow) {
    return r.days >= r.window ? "Check tomorrow" : "Still inside the usual window. Nothing to do yet.";
  }
  switch (r.method) {
    case "cash":
      return "Look in the next deposit or offering count";
    case "check":
      return "Ask the family whether the check was sent";
    case "zelle":
      return "Look for the Zelle on the statement, or ask the family to check";
    default:
      return "Look for it on the statement, or ask the family";
  }
}

/** One household's unbanked payments: the Paid, not on the bank tile of the household page. */
export function householdUnbanked(rows: readonly UnbankedRow[], householdId: string): { count: number; cents: number; oldestDays: number } {
  const mine = rows.filter((r) => r.householdId === householdId);
  return { count: mine.length, cents: mine.reduce((s, r) => s + r.amountCents, 0), oldestDays: mine.reduce((m, r) => Math.max(m, r.days), 0) };
}
