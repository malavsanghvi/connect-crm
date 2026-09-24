"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction, dbWithReason } from "@/lib/session";
import { isStepUpError, secretNameProblem, secretValueProblem } from "@/lib/vault";

/** stepUp: the database asked for a fresh 2FA check (CCSTP); the screen verifies and retries. */
export type VaultResult = ActionResult & { stepUp?: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanReason(reason: string, doing: string): { ok: true; reason: string } | { ok: false; error: string } {
  const r = String(reason ?? "").trim();
  if (!r) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (r.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  return { ok: true, reason: r };
}

/**
 * Add, replace or rotate one secret of a connection through
 * app.set_integration_secret (owner or integrations.manage, a fresh 2FA check,
 * a reason; audited). The value goes to the database once and is never
 * logged, returned or stored anywhere else; the reply carries the last 4.
 */
export async function setSecretAction(connectionId: string, nameInput: string, value: string, reasonInput: string, mode: "add" | "replace" | "rotate"): Promise<VaultResult> {
  const name = String(nameInput ?? "").trim().toLowerCase();
  const doing = mode === "add" ? `save the secret "${name || "?"}"` : `${mode} the secret "${name}"`;
  if (!UUID_RE.test(connectionId)) return { ok: false, error: `Could not ${doing} — the connection was not recognised. Reload and try again.` };
  const nameProblem = secretNameProblem(name);
  if (nameProblem) return { ok: false, error: `Could not ${doing} — ${nameProblem}` };
  const valueProblem = secretValueProblem(String(value ?? ""));
  if (valueProblem) return { ok: false, error: `Could not ${doing} — ${valueProblem}` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await authorizeAction("integrations", doing);
  if (!auth.ok) return auth;

  const db = await dbWithReason(auth.session, reason.reason);
  const { data, error } = await db.rpc("set_integration_secret", {
    p_connection: connectionId,
    p_name: name,
    p_value: value,
    p_reason: reason.reason,
  });
  if (error) {
    if (isStepUpError(error)) return { ok: false, stepUp: true, error: `Could not ${doing} — this needs a fresh 2FA check.` };
    // The error never contains the value (the RPC's parameters are not echoed); failure() logs it.
    return failure(`Could not ${doing}`, error);
  }
  revalidatePath("/settings/integrations");
  const fp = data && typeof data === "object" && !Array.isArray(data) ? String((data as Record<string, unknown>).fingerprint ?? "") : "";
  return { ok: true, message: `${mode === "rotate" ? "Rotated" : mode === "replace" ? "Replaced" : "Saved"} "${name}" (ends ${fp}) · audit logged` };
}

/** Remove one secret (app.revoke_integration_secret: step-up, reason, audited; the vault entry is deleted). */
export async function revokeSecretAction(connectionId: string, nameInput: string, reasonInput: string): Promise<VaultResult> {
  const name = String(nameInput ?? "").trim().toLowerCase();
  const doing = `remove the secret "${name}"`;
  if (!UUID_RE.test(connectionId)) return { ok: false, error: `Could not ${doing} — the connection was not recognised. Reload and try again.` };
  const reason = cleanReason(reasonInput, doing);
  if (!reason.ok) return reason;
  const auth = await authorizeAction("integrations", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason.reason);
  const { error } = await db.rpc("revoke_integration_secret", { p_connection: connectionId, p_name: name, p_reason: reason.reason });
  if (error) {
    if (isStepUpError(error)) return { ok: false, stepUp: true, error: `Could not ${doing} — this needs a fresh 2FA check.` };
    return failure(`Could not ${doing}`, error);
  }
  revalidatePath("/settings/integrations");
  return { ok: true, message: `Removed "${name}" from the vault · audit logged` };
}

/** Queue a demo.ping job (app.enqueue_worker_test, settings.manage). */
export async function testBackgroundServiceAction(): Promise<ActionResult<{ jobId: number }>> {
  const doing = "queue a test job";
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("enqueue_worker_test", { p_center: auth.session.center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/settings/integrations");
  return { ok: true, message: `Test job #${data} queued. The background service picks it up within a few seconds.`, data: { jobId: Number(data) } };
}
