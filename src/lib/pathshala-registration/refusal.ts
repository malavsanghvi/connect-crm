// A refused write on the Levels and Fees screens, as the form shows it next to what the person did:
// "Could not save the fees — <why>." The technical detail is logged on the server (docs/ARCHITECTURE.md "Errors");
// the reason is the function's own sentence when it gave one (§2.11), else the usual plain explanation.

import { explainError, failure, isStepUpError } from "@/lib/errors";

import { databaseSentence } from "./contract";
import { NEEDS_UPDATE } from "./db";

export type Refusal = { ok: false; error: string; stepUp?: boolean };

export function refusal(doing: string, res: { missing: boolean; error: unknown }): Refusal {
  if (res.missing) return { ok: false, error: `Could not ${doing} — ${NEEDS_UPDATE}` };
  // The database asked for a fresh 2FA check: the form opens the step-up modal and sends the same request again.
  if (isStepUpError(res.error)) return failure(`Could not ${doing}`, res.error);
  console.error(`[pathshala-registration] could not ${doing}:`, res.error);
  const why = databaseSentence(res.error) ?? explainError(res.error);
  return { ok: false, error: `Could not ${doing} — ${why}${/[.!?]$/.test(why) ? "" : "."}` };
}
