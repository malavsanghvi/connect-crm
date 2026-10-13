import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { devPreviewAllowed } from "@/lib/dev-preview";

import { DonationPreview, UploadPreview } from "./preview-client";

export const metadata: Metadata = { title: "Giving uploads · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * DEV ONLY. Giving › Pledges › Upload with invented data and no database: it opens on the review of a sample file (ready rows, a name
 * to pick, an ID two households share, a repeat, a child named as the pledger, an unknown fund). `?community=foodbank` is a food bank
 * in pounds that writes the day first, with a 14-day default; `?fresh=1` opens on choosing a file (any CSV is checked against the
 * invented households). `?kind=donations` is Giving › Payments › Upload (offline payments, what each pays, a Zelle the family
 * reported, a check already recorded, a card gift refused); with `&role=volunteer` a finance volunteer who records but does not apply.
 * Returns notFound() in production.
 */
export default async function GivingUploadPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const community = sp.community === "foodbank" ? "foodbank" : "temple";
  const donations = sp.kind === "donations";
  return (
    <main className="mx-auto max-w-[960px] px-4 py-6">
      <h1 className="m-0 mb-4 font-display text-[30px] font-semibold text-ink">{donations ? "Upload donations" : "Upload pledges"}</h1>
      {donations ? (
        <DonationPreview community={community} fresh={sp.fresh === "1"} volunteer={sp.role === "volunteer"} />
      ) : (
        <UploadPreview community={community} fresh={sp.fresh === "1"} />
      )}
    </main>
  );
}
