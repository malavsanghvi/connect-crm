import { isModuleEnabled } from "@/lib/modules";
import type { CrmSession } from "@/lib/session";

/**
 * After a Niva source is published, Niva tries its unanswered questions again (app.niva_retry_unanswered, 0572: content.manage; it
 * adds no question, so the monthly limit is untouched). `retried` is null when the Niva module is switched off: members cannot ask
 * then, so there is nothing to try. A publish asks for the function's default (NIVA_AUTO_RETRY_LIMIT): each question may ask the
 * model again. Used by the publish command and by the screen actions that publish a whole imported page or ask to try again.
 */
export async function retryNivaQuestions(
  session: CrmSession,
  centerId: string,
  limit: number,
): Promise<{ ok: true; retried: number | null } | { ok: false; error: unknown }> {
  if (!isModuleEnabled(session, "niva")) return { ok: true, retried: null };
  const { data, error } = await session.db.rpc("niva_retry_unanswered", { p_center: centerId, p_limit: limit });
  if (error) return { ok: false, error };
  return { ok: true, retried: typeof data === "number" ? data : 0 };
}
