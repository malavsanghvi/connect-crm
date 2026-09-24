"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";
import { ENTITLEMENT_INFO, entitlementLabel, parseEntitlementInput } from "@/lib/tenancy";

async function platformOnly(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only the Community Connect team (platform admins) can do this.` };
  return { ok: true, session: state.session };
}

/**
 * Set or remove one entitlement override for a center (app.set_center_entitlement:
 * platform admins only, a reason required, audited). A blank value removes the
 * override so the environment's default applies again.
 */
export async function setEntitlementAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const center = String(formData.get("center") ?? "");
  const key = String(formData.get("key") ?? "");
  const label = entitlementLabel(key);
  const doing = `change "${label}"`;
  if (!isUuid(center) || !ENTITLEMENT_INFO[key]) return { ok: false, error: `Could not ${doing} — the form is out of date. Reload and try again.` };
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const parsed = parseEntitlementInput(key, String(formData.get("value") ?? ""));
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}.` };
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept with the limit and in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_center_entitlement", {
    p_center: center,
    p_key: key,
    // SQL null removes the override; JSON null means "no limit".
    p_value: (parsed.remove ? null : parsed.value) as never,
    p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(`/platform/centers/${center}`);
  return { ok: true, message: parsed.remove ? `${label}: back to the default · audit logged` : `${label} updated · audit logged` };
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Register an organization's own portal address (app.center_domains; platform admins only). */
export async function addDomainAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const center = String(formData.get("center") ?? "");
  const domain = String(formData.get("domain") ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (!isUuid(center)) return { ok: false, error: "Could not add the address — the form is out of date. Reload and try again." };
  if (!DOMAIN_RE.test(domain)) return { ok: false, error: 'Could not add the address — enter a web address such as "portal.jsh.org".' };
  const auth = await platformOnly("add the address");
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim() || `Portal address ${domain}`;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.from("center_domains").insert({ domain, center_id: center });
  if (error) {
    if (error.code === "23505") return { ok: false, error: `Could not add ${domain} — another community already uses that address.` };
    return failure(`Could not add ${domain}`, error);
  }
  revalidatePath(`/platform/centers/${center}`);
  return { ok: true, message: `${domain} added · point its DNS at the server to use it` };
}

export async function removeDomainAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const center = String(formData.get("center") ?? "");
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  if (!isUuid(center) || !domain) return { ok: false, error: "Could not remove the address — the form is out of date. Reload and try again." };
  const auth = await platformOnly(`remove ${domain}`);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, `Removed portal address ${domain}`);
  const { data, error } = await db.from("center_domains").delete().eq("domain", domain).eq("center_id", center).select("domain");
  if (error) return failure(`Could not remove ${domain}`, error);
  if (!data || data.length === 0) return { ok: false, error: `Could not remove ${domain} — it was already removed. Reload to see the current list.` };
  revalidatePath(`/platform/centers/${center}`);
  return { ok: true, message: `${domain} removed` };
}
