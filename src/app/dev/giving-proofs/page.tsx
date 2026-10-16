import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { ProofsScreen } from "@/components/giving-proofs/proofs-screen";
import { ToastProvider } from "@/components/toast";
import { StepUpProvider } from "@/components/step-up";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { sampleProofCards } from "@/lib/payment-proofs/fixtures";

export const metadata: Metadata = { title: "Payment proofs · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * DEV ONLY. Giving › Payment proofs with invented proofs, drawn without a database or a session. `?as=empty` shows the empty queue,
 * `?as=viewer` a person who may look but not decide, `?as=error` a failed read. Deciding needs a database, so the buttons answer with
 * their real error here. Returns notFound() in production.
 */
export default async function GivingProofsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const as = typeof sp.as === "string" ? sp.as : "";
  const base = {
    can: { decide: as !== "viewer", approve: true, bank: true },
    fmt: { currency: "USD", locale: "en-US" },
    timeZone: "America/Chicago",
    labels: { orgMemberLabel: "Member ID", orgHouseholdLabel: "Club household ID" },
    today: "2026-10-15",
    notices: [],
  };
  const page =
    as === "error"
      ? ({ state: "error", error: "Could not load the payment proofs — the database could not be reached — check the connection and try again." } as const)
      : ({ state: "ok", cards: as === "empty" ? [] : sampleProofCards(), ...base } as const);
  return (
    <PreviewShell community="Riverbend Community Center" workspaces={[]}>
      <StepUpProvider>
        <ToastProvider>
          <ProofsScreen page={page} />
        </ToastProvider>
      </StepUpProvider>
    </PreviewShell>
  );
}
