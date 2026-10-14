"use server";

import { failure, type ActionResult } from "@/lib/errors";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

export type GrantSuggestion = { family: Family; reason: string; ambiguous: boolean };

/**
 * Read only: the families suggested for a fund grant or matching gift from the bank (app.suggest_bank_matches), asked for when its
 * sheet opens on Payments › Grants to match, so a page of grants does not ask the database once per line. Matching it is the
 * existing confirmBankMatchAction.
 */
export async function grantSuggestionsAction(txnId: string): Promise<ActionResult<GrantSuggestion[]>> {
  const auth = await authorizeAction("bankConfirm", "load the suggested families");
  if (!auth.ok) return auth;
  if (!isUuid(txnId)) return { ok: false, error: "Could not load the suggested families: the bank line was not found." };
  const r = await auth.session.db.rpc("suggest_bank_matches", { p_txn: txnId });
  if (r.error) return failure("Could not load the suggested families", r.error);
  return {
    ok: true,
    data: (r.data ?? []).map((s) => ({
      family: familyFrom({ ...s, primary_member: s.primary_member ?? null }),
      reason: s.reason ?? "",
      ambiguous: Boolean(s.ambiguous),
    })),
  };
}
