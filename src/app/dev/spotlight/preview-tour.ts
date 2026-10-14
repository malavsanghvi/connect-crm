// DEV PREVIEW ONLY (src/app/dev/spotlight): the real treasurer tour with its addresses pointed at the three sample pages, so the whole
// walk (Home, the navigation, Bank, QuickBooks sync) can be tried and checked without a session or a database.

import { TREASURER_BANK_MATCH } from "@/lib/spotlight/tours/treasurer-bank-match";
import type { TourDef } from "@/lib/spotlight/types";

export const PREVIEW_PAGES: Record<string, string> = {
  "/": "/dev/spotlight",
  "/giving/payments/bank": "/dev/spotlight/bank",
  "/accounting/qbo": "/dev/spotlight/books",
};

export function previewTour(): TourDef {
  return {
    ...TREASURER_BANK_MATCH,
    steps: TREASURER_BANK_MATCH.steps.map((s) => (s.href ? { ...s, href: PREVIEW_PAGES[s.href] ?? s.href } : s)),
  };
}
