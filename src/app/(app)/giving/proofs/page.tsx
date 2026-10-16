import type { Metadata } from "next";

import { ProofsScreen } from "@/components/giving-proofs/proofs-screen";
import { loadProofsPage } from "@/lib/data/payment-proofs";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Payment confirmations" };

/**
 * Giving › Payment proofs: the proofs members sent for payments made another way, waiting for the treasury team
 * (migration 0866). Reading is for anyone who sees Payments; deciding needs the permission to record payments.
 */
export default async function GivingProofsPage() {
  const session = await getSession();
  const page = await loadProofsPage(session);
  return <ProofsScreen page={page} />;
}
