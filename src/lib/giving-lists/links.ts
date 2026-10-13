// Addresses the Pledges and Payments lists share. Pure.

/**
 * Where Record payment goes when the sheet cannot open in place (slice 2's sheet opens from the button wherever the New-look shell is
 * mounted): the Payments tab shows today's Record payment form on top when the address carries `record=1` (or a household).
 */
export function recordPaymentHref(householdId?: string | null): string {
  return householdId ? `/giving/payments?record=1&household=${householdId}` : "/giving/payments?record=1";
}

export function familyHref(householdId: string, tab: "pledges" | "payments"): string {
  return `/households/${householdId}?tab=${tab}`;
}
