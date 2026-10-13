// What a Giving list shows, said for its export (slice 9). Pure: the route, the dev preview and the tests build these from the
// address the list itself reads, so the file is exactly the list (src/lib/data/giving-lists.ts reads the same chips through
// paymentQuery and the pledge chip readers).

import { methodText, sourceText, type PaymentQuery } from "@/lib/giving-lists/payments";
import { BEHIND_BUCKETS, PLEDGE_CHIPS, type BehindBucketKey, type PledgeChipKey } from "@/lib/giving-lists/pledges";

import type { ExportFilter } from "./csv";

export function paymentExportFilter(q: PaymentQuery, search: string | null, locale: string): ExportFilter {
  const chips: ExportFilter["chips"] = {};
  if (q.view === "refunds") chips.view = { value: "refunds", label: "refund requests" };
  if (q.method) chips.method = { value: q.method.key, label: q.method.label(locale).toLowerCase() };
  if (q.source) chips.source = { value: q.source.key, label: q.source.label.toLowerCase() };
  if (q.year !== null) chips.year = { value: String(q.year), label: `received in ${q.year}` };
  return { chips, search: search && search.trim() ? search.trim() : null };
}

/** A behind bucket wins over the chip, as on the list (the bucket shows open pledges behind by that many days). */
export function pledgeExportFilter(chip: PledgeChipKey, bucket: BehindBucketKey | null, search: string | null): ExportFilter {
  const chips: ExportFilter["chips"] = {};
  const b = bucket ? BEHIND_BUCKETS.find((x) => x.key === bucket) : null;
  if (b) chips.age = { value: b.key, label: `behind by ${b.label}` };
  else chips.status = { value: chip, label: (PLEDGE_CHIPS.find((c) => c.key === chip)?.label ?? chip).toLowerCase() };
  return { chips, search: search && search.trim() ? search.trim() : null };
}

/** "Recorded by hand", "From the bank", "Online (Stripe)". */
export function sourceWord(provider: string | null): string {
  const s = sourceText(provider);
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function methodWord(locale: string): (method: string) => string {
  return (method) => methodText(method, locale);
}
