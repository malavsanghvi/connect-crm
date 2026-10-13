"use server";

import { revalidatePath } from "next/cache";

import { assistantRulesPatch } from "@/lib/assistant/settings";
import { confirmToolChoices } from "@/lib/assistant/choices";
import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import { failure, type ActionResult } from "@/lib/errors";
import { parseKindPreview, type KindPreview } from "@/lib/kind-change";
import { moduleLabelFor } from "@/lib/modules";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";
import { ENTITLEMENT_INFO, entitlementLabel, parseEntitlementInput } from "@/lib/tenancy";

async function platformOnly(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only the Weaver team (platform admins) can do this.` };
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

// ── Kind of organization ─────────────────────────────────────────────────────

/**
 * What changing the organization's kind would do, in plain English (app.category_change_preview, platform
 * admins). Changes nothing; the confirm step shows it first.
 */
export async function previewKindChangeAction(centerId: string, kind: string): Promise<ActionResult<KindPreview>> {
  const doing = "preview the change";
  if (!isUuid(centerId) || !kind) return { ok: false, error: `Could not ${doing} — choose the new kind of organization first.` };
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("category_change_preview", { p_center: centerId, p_category: kind });
  if (error) return failure(`Could not ${doing}`, error);
  const preview = parseKindPreview(data);
  if (!preview) return { ok: false, error: `Could not ${doing} — the database answered in a form this page does not understand. Reload and try again.` };
  return { ok: true, data: preview };
}

/**
 * Change the organization's kind (app.set_center_category: platform admins, a reason, a fresh 2FA check; audited;
 * the owner is emailed). Modules the new kind does not have are hidden at once, their data kept; changing back
 * restores everything. The portal asks for the 2FA code when the database refuses without it (CCSTP) and retries.
 */
export async function changeKindAction(centerId: string, kind: string, reasonInput: string): Promise<ActionResult<KindPreview>> {
  const doing = "change the kind of organization";
  if (!isUuid(centerId) || !kind) return { ok: false, error: `Could not ${doing} — choose the new kind of organization first.` };
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const reason = String(reasonInput ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason goes in the audit log and in the email to the owner.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("set_center_category", { p_center: centerId, p_category: kind, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  const done = parseKindPreview(data);
  revalidatePath(`/platform/centers/${centerId}`);
  revalidatePath("/platform");
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `Kind of organization changed to ${done?.to.label ?? "the new kind"} · audit logged`,
    data: done ?? undefined,
  };
}

// ── Modules: what Weaver enables for this community (0740) ────────────────────

/**
 * Enable or disable one module for one community (app.set_module_grant: platform admins only, a reason, a fresh 2FA check;
 * audited). Enabling switches it on at once unless the community paused it; disabling hides it and its records (nothing is
 * deleted) until it is enabled again. The form asks for the 2FA code when the database refuses without it (CCSTP) and retries.
 * The form says which way to go (granted = "true" or "false"), so pressing it twice ends in the state the person asked for.
 */
export async function setModuleGrantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const center = String(formData.get("center") ?? "");
  const moduleKey = String(formData.get("module") ?? "");
  const way = String(formData.get("granted") ?? "");
  const label = String(formData.get("label") ?? "").trim() || moduleLabelFor(moduleKey);
  const granted = way === "true";
  const doing = `${granted ? "enable" : "disable"} ${label}`;
  if (!isUuid(center) || !/^[a-z][a-z0-9_]{0,63}$/.test(moduleKey) || (way !== "true" && way !== "false")) {
    return { ok: false, error: `Could not ${doing} — the form is out of date. Reload and try again.` };
  }
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("set_module_grant", { p_center: center, p_module: moduleKey, p_granted: granted, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  const result = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as { paused?: unknown; enabled?: unknown };
  revalidatePath(`/platform/centers/${center}`);
  revalidatePath("/", "layout");
  const message = !granted
    ? `${label} disabled · its records are kept and hidden until it is enabled again · audit logged`
    : result.enabled === true
      ? `${label} enabled and on · audit logged`
      : result.paused === true
        ? `${label} enabled · the community has it paused, so it stays off until they switch it on · audit logged`
        : `${label} enabled · it stays off until the modules it needs are on · audit logged`;
  return { ok: true, message };
}

// ── Record how this community uses Weaver ────────────────────────────────────

/**
 * Switch activity recording on or off for one community (app.set_activity_recording: platform admins only). Off is always
 * allowed; on only while the community's administrator has agreed (the database says "The community's administrator has not
 * agreed yet." otherwise, and the card does not offer the button). A reason is required and travels with the change into the
 * audit log. The form says which way to go (enable = "true" or "false"), so pressing it twice, or after somebody else changed
 * it, ends in the state the person asked for.
 */
export async function setActivityRecordingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const doing = "change activity recording";
  const center = String(formData.get("center") ?? "");
  const enable = formData.get("enable");
  if (!isUuid(center) || (enable !== "true" && enable !== "false")) {
    return { ok: false, error: `Could not ${doing} — the form is out of date. Reload and try again.` };
  }
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why, for example who agreed and when. The reason is kept in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const on = enable === "true";
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_activity_recording", { p_center: center, p_enabled: on });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(`/platform/centers/${center}`);
  revalidatePath("/settings/automation");
  return { ok: true, message: `Recording is now ${on ? "on" : "off"} for this community · audit logged` };
}

// ── Niva for admins ──────────────────────────────────────────────────────────

/**
 * Switch Niva for admins on or off for one community, and choose which write actions Niva may prepare there (the confirm-level
 * commands; each is off until switched on, and a person still presses a button to confirm). Platform admins only, a reason is
 * required and kept in the audit log; saved into the community's rules (assistant.enabled, assistant.tools) with the same version
 * check as every rules save.
 */
export async function saveAssistantAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const doing = "save the Niva for admins settings";
  const center = String(formData.get("center") ?? "");
  if (!isUuid(center)) return { ok: false, error: `Could not ${doing} — the form is out of date. Reload and try again.` };
  const auth = await platformOnly(doing);
  if (!auth.ok) return auth;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: `Could not ${doing} — say why. The reason is kept in the audit log.` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const expected = expectedVersion(formData.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };

  const chosen = new Set(formData.getAll("tool").map((v) => String(v)));
  const tools: Record<string, boolean> = {};
  for (const choice of confirmToolChoices(undefined)) tools[choice.key] = chosen.has(choice.key);
  const enabled = formData.get("enabled") === "on";

  const db = await dbWithReason(auth.session, reason);
  const result = await writeCenterRules({ ...auth.session, db }, { mode: "patch", rules: assistantRulesPatch({ enabled, tools }) }, expected, "Niva for admins settings", (version) => {
    const allowed = Object.values(tools).filter(Boolean).length;
    return `Niva for admins is now ${enabled ? "on" : "off"} for this community${enabled ? ` · ${allowed} write action${allowed === 1 ? "" : "s"} allowed` : ""} · rules version ${version} · audit logged`;
  }, { centerId: center });
  if (result.ok) revalidatePath(`/platform/centers/${center}`);
  return result;
}
