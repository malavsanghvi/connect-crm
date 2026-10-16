"use server";

import { revalidatePath } from "next/cache";

import { writeProofPolicy } from "@/lib/data/payment-proofs-policy";
import type { ActionResult } from "@/lib/errors";
import { rulesPatchFromForm } from "@/lib/payment-proofs/policy";
import { authorizeAction } from "@/lib/session";

/**
 * Settings › Payments › Payment proofs: which ways of paying need a proof, the usual days each takes to reach the bank, the amount
 * above which a second person must approve, the days to wait for a family's reply, and the two soft-credit switches. Written by
 * app.set_proof_policy (settings.manage), which checks every value and audits the change.
 */
export async function saveProofRulesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "Could not save the payment confirmation rules";
  const auth = await authorizeAction("centerSettings", "save the payment confirmation rules");
  if (!auth.ok) return auth;
  const parsed = rulesPatchFromForm(fd);
  if (!parsed.ok) return { ok: false, error: `${doing} — ${parsed.error}` };
  const res = await writeProofPolicy(auth.session, parsed.patch, "Payment confirmation rules changed", doing);
  if (!res.ok) return res;
  revalidatePath("/settings/payments");
  revalidatePath("/giving/proofs");
  return { ok: true, message: "Payment confirmation rules saved · audit logged" };
}
