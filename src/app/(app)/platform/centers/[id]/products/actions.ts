"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession } from "@/lib/session";

export type ProductSwitchResult = { enabled: boolean; emailed: boolean; emailStatus: string | null; requestDone: boolean };

/**
 * Turn one product on or off for one community (app.marketplace_set_product, 0753): platform admins only, a reason, a module the
 * product needs must be on first, then 0740's app.set_module_grant (a fresh 2FA check, audited); an open request is marked done
 * and the community's owner and whoever asked are emailed. The screen checks the authenticator code first (the step-up flow's
 * own verifyStepUpAction), so the database finds a fresh check when this runs. The form says which way to go, so pressing it
 * twice ends in the state the person asked for (the database says "nothing to change" the second time).
 */
export async function setProductAction(
  centerId: string,
  product: string,
  name: string,
  turnOn: boolean,
  reasonInput: string,
): Promise<ActionResult<ProductSwitchResult>> {
  const label = String(name ?? "").trim() || product;
  const doing = `turn ${turnOn ? "on" : "off"} ${label}`;
  if (!isUuid(centerId) || !/^[a-z][a-z0-9_]{1,39}$/.test(product)) {
    return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  }
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only the Weaver team (platform admins) can do this.` };
  const reason = String(reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: "Add a reason first. It is saved in the audit log." };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };

  const db = await dbWithReason(state.session, reason);
  const { data, error } = await db.rpc("marketplace_set_product", { p_center: centerId, p_product: product, p_on: turnOn, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  const r = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  revalidatePath(`/platform/centers/${centerId}/products`);
  revalidatePath(`/platform/centers/${centerId}`);
  revalidatePath("/platform");
  return {
    ok: true,
    data: {
      enabled: r.enabled === true,
      emailed: r.emailed === true,
      emailStatus: typeof r.email_status === "string" ? r.email_status : null,
      requestDone: r.request_done === true,
    },
  };
}
