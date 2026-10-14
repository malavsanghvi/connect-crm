import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BankTab } from "@/components/giving-bank/bank-tab";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { sampleBankModel } from "@/lib/giving-bank/fixtures";

export const metadata: Metadata = { title: "Spotlight · Bank · Dev preview" };

/**
 * DEV ONLY. Giving › Bank (New look) with invented data, as the treasurer sees it: the same component the portal draws, so the tour's
 * keys (the views, a line, its household, Confirm match) are on real elements. The buttons call the real Server Actions, which refuse
 * without a session. Returns notFound() in production.
 */
export default function SpotlightBankPreview() {
  if (!devPreviewAllowed()) notFound();
  const model = sampleBankModel({ community: "club", role: "treasurer" });
  return <BankTab model={model} importer={<p className="m-0 text-[14px] text-muted">The statement importer appears here.</p>} />;
}
