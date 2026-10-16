"use server";

import { revalidatePath } from "next/cache";

import { readProofPolicy, writeProofPolicy } from "@/lib/data/payment-proofs-policy";
import { failure, type ActionResult } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import { isShortening, parseRetentionPreview, retentionPatchFromForm, retentionYearsProblem, type RetentionPreview } from "@/lib/payment-proofs/policy";
import { authorizeAction } from "@/lib/session";

/**
 * Settings › Storage › Payment proofs: how many years proofs are kept (3 to 25) and the legal hold. Shortening the years needs a
 * reason and a fresh 2FA code (the database raises SQLSTATE CCSTP; the screen asks for the code and sends this again).
 */
export async function saveProofRetentionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult & { stepUp?: boolean }> {
  const doing = "Could not save how long payment proofs are kept";
  const auth = await authorizeAction("centerSettings", "save how long payment proofs are kept");
  if (!auth.ok) return auth;
  const parsed = retentionPatchFromForm(fd);
  if (!parsed.ok) return { ok: false, error: `${doing} — ${parsed.error}` };
  const current = await readProofPolicy(auth.session);
  if (!current.ok) return { ok: false, error: `${doing} — ${current.error}` };
  const reason = String(fd.get("reason") ?? "").trim();
  if (isShortening(current.policy, parsed.patch) && reason.length < 5) {
    return { ok: false, error: `${doing} — say why you are shortening the years, in a few words. The reason is kept in the audit log.` };
  }
  const res = await writeProofPolicy(auth.session, parsed.patch, reason || "Payment proof retention changed", doing);
  if (!res.ok) return res;
  revalidatePath("/settings/storage");
  return {
    ok: true,
    message: `Payment proofs are kept ${res.policy.retentionYears} years${res.policy.legalHold ? ", and the legal hold is on" : ""} · audit logged`,
  };
}

export type PreviewResult = { ok: true; preview: RetentionPreview | null } | { ok: false; error: string };

/**
 * What shortening the years to `years` would make due (app.proof_retention_preview). A database without that function yet gives no
 * preview (preview: null), not an error; any other failure is said in words and logged.
 */
export async function previewProofRetentionAction(years: number): Promise<PreviewResult> {
  const doing = "Could not work out what shortening would remove";
  const auth = await authorizeAction("centerSettings", "preview shortening how long payment proofs are kept");
  if (!auth.ok) return auth;
  const bad = retentionYearsProblem(String(years));
  if (bad) return { ok: false, error: `${doing} — ${bad}` };
  const res = await untypedRpc(auth.session.db)("proof_retention_preview", { p_center: auth.session.center.id, p_years: years });
  if (res.error) {
    if (res.error.code === "PGRST202" || res.error.code === "42883") return { ok: true, preview: null };
    return failure(doing, res.error);
  }
  const preview = parseRetentionPreview(res.data);
  if (!preview) console.error("[settings/storage] unexpected answer from proof_retention_preview:", res.data);
  return { ok: true, preview };
}
