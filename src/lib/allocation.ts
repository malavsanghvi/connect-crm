// Client-side PREVIEW of how a payment would settle pledges.
//
// app.allocate_payment() is not callable by clients (0011 revokes it), so the
// console mirrors its ordering rule to show the user what will happen:
//   * earliest open pledge first (pledged_at), overpayment rolls to the next;
//   * a partial payment keeps the pledge open;
//   * when pledges are named, only those are used, in the order named;
//   * whatever cannot be placed stays unallocated on the payment.

export type AllocatablePledge = {
  id: string;
  amount_cents: number;
  paid_cents: number;
  pledged_at: string;
  status?: string;
};

export type AllocationLine = {
  pledge_id: string;
  amount_cents: number;
  open_before_cents: number;
  open_after_cents: number;
  closes: boolean;
};

export type AllocationPreview = {
  lines: AllocationLine[];
  allocated_cents: number;
  unallocated_cents: number;
};

const OPEN_STATUSES = new Set(["open", "partially_paid"]);

export function openCents(p: Pick<AllocatablePledge, "amount_cents" | "paid_cents">): number {
  return Math.max(0, p.amount_cents - p.paid_cents);
}

/** Pledges in the order allocate_payment() would visit them. */
export function orderForAllocation(
  pledges: AllocatablePledge[],
  chosenIds?: readonly string[] | null,
): AllocatablePledge[] {
  const eligible = pledges.filter((p) => p.status === undefined || OPEN_STATUSES.has(p.status));
  if (chosenIds && chosenIds.length > 0) {
    const pos = new Map(chosenIds.map((id, i) => [id, i]));
    return eligible
      .filter((p) => pos.has(p.id))
      .sort((a, b) => pos.get(a.id)! - pos.get(b.id)! || cmpPledgedAt(a, b));
  }
  return [...eligible].sort(cmpPledgedAt);
}

function cmpPledgedAt(a: AllocatablePledge, b: AllocatablePledge): number {
  const d = new Date(a.pledged_at).getTime() - new Date(b.pledged_at).getTime();
  return d !== 0 ? d : a.id.localeCompare(b.id);
}

export function previewAllocation(
  amountCents: number,
  pledges: AllocatablePledge[],
  chosenIds?: readonly string[] | null,
): AllocationPreview {
  let remaining = Math.max(0, Math.trunc(amountCents));
  const lines: AllocationLine[] = [];
  for (const p of orderForAllocation(pledges, chosenIds)) {
    if (remaining <= 0) break;
    const open = openCents(p);
    const take = Math.min(open, remaining);
    if (take <= 0) continue;
    lines.push({
      pledge_id: p.id,
      amount_cents: take,
      open_before_cents: open,
      open_after_cents: open - take,
      closes: take === open,
    });
    remaining -= take;
  }
  const allocated = lines.reduce((s, l) => s + l.amount_cents, 0);
  return { lines, allocated_cents: allocated, unallocated_cents: Math.max(0, Math.trunc(amountCents)) - allocated };
}
