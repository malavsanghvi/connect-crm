// Addresses the Pledges and Payments lists share. Pure.

/**
 * Record payment until slice 2's sheet is wired in: the New-look Payments tab shows today's Record payment form on top when the
 * address carries `record=1` (or a household, as every "Record payment" button on a family already sends).
 */
export function recordPaymentHref(householdId?: string | null): string {
  return householdId ? `/giving/payments?record=1&household=${householdId}` : "/giving/payments?record=1";
}

export function familyHref(householdId: string, tab: "pledges" | "payments"): string {
  return `/households/${householdId}?tab=${tab}`;
}
