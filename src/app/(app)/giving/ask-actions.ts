"use server";

import type { PaymentDraftData } from "@/lib/commands/catalog/giving-draft-payment";
import { runScreenCommand } from "@/lib/commands/screen";
import type { ActionResult } from "@/lib/errors";
import type { DraftRequest } from "@/lib/giving-workspace/view";

/**
 * The Giving page's confirmation card: giving.draft_payment, which SAVES NOTHING. It checks the payment with the Record payment
 * screen's own rules, looks up the household's open pledges and says which ones it would close. Recording happens on the
 * Record payment screen (or, where the community switched it on, through the confirm-level command's own card).
 */
export async function draftPaymentAction(req: DraftRequest): Promise<ActionResult<PaymentDraftData>> {
  return runScreenCommand<PaymentDraftData>("giving.draft_payment", req, "prepare the payment");
}
