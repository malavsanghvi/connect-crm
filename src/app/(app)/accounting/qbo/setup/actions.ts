"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { failure, type ActionResult } from "@/lib/errors";
import { QBO_PURPOSES } from "@/lib/labels";
import { authorizeUrl, intuitPortalConfig, redirectUri, signState } from "@/lib/qbo/oauth";
import { reasonProblem, TEST_POST_HOW_TO_VOID } from "@/lib/qbo/setup";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";
import { platformEnv } from "@/lib/platform-setup/server-config";

// Accounting › QuickBooks setup (plan §1.7). Every change goes through an RPC
// that checks the caller, the module switch and (connect, disconnect, approvals)
// a fresh 2FA check; a CCSTP refusal comes back as stepUp so the screen asks for
// the code and sends the same thing again.

const PATH = "/accounting/qbo/setup";
function refresh() {
  revalidatePath(PATH);
  revalidatePath("/accounting/qbo");
}
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const purposeLabel = (p: string) => QBO_PURPOSES.find((x) => x.purpose === p)?.label ?? p;

/** This portal's public origin (for the Intuit return address when INTUIT_REDIRECT_URI is not set). */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Start connecting: step-up + reason in the database, then the signed state and Intuit's address. */
export async function startQboConnectAction(_prev: ActionResult<{ url: string }> | null, fd: FormData): Promise<ActionResult<{ url: string }>> {
  const doing = "connect QuickBooks";
  const company = text(fd, "company") === "sandbox" ? "sandbox" : "real";
  const reason = text(fd, "reason");
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qbo", doing);
  if (!auth.ok) return auth;
  const env = await platformEnv();
  const cfg = intuitPortalConfig(env, company);
  if (!cfg.ok) {
    console.error(`[qbo] cannot start the Intuit sign-in: ${cfg.missing.join(", ")} not set on the portal server`);
    return { ok: false, error: cfg.message };
  }
  const redirect = redirectUri(env, await origin());
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("start_qbo_connect", {
    p_center: auth.session.center.id,
    p_company: company,
    p_redirect_uri: redirect,
    p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  const nonce = data && typeof data === "object" && !Array.isArray(data) ? String((data as Record<string, unknown>).nonce ?? "") : "";
  if (!/^[0-9a-f]{64}$/.test(nonce)) {
    console.error("[qbo] start_qbo_connect returned no nonce");
    return { ok: false, error: `Could not ${doing} — the sign-in could not be prepared. Try again.` };
  }
  const state = signState(cfg.stateSecret, auth.session.center.id, nonce, auth.session.userId);
  return { ok: true, message: "Opening Intuit…", data: { url: authorizeUrl(cfg, redirect, state) } };
}

export async function disconnectQboAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "disconnect QuickBooks";
  const reason = text(fd, "reason");
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qbo", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("disconnect_qbo", { p_center: auth.session.center.id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "QuickBooks is disconnected and its sign-in removed from the vault. Nothing posts until it is connected again." };
}

export async function saveQboSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "save the QuickBooks choices";
  const basis = text(fd, "basis");
  const posting = text(fd, "posting");
  const goLive = text(fd, "go_live_date");
  const reason = text(fd, "reason");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goLive)) return { ok: false, error: `Could not ${doing} — choose the go-live date.` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_qbo_settings", {
    p_center: auth.session.center.id,
    p_basis: basis,
    p_posting: posting,
    p_go_live_date: goLive,
    p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Saved. Only money received on or after the go-live date posts to QuickBooks." };
}

export async function pullQboListsAction(): Promise<ActionResult> {
  const doing = "pull the QuickBooks lists";
  const auth = await authorizeAction("qbo", doing);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("request_qbo_pull", { p_center: auth.session.center.id });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: `Pull queued (job #${data}). The chart of accounts and lists refresh within a minute; reload to see them.` };
}

export async function saveQboMappingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const purpose = text(fd, "purpose");
  const account = text(fd, "qbo_account_id");
  const label = purposeLabel(purpose);
  const doing = `map ${label}`;
  if (!account) return { ok: false, error: `Could not ${doing} — choose an account from the list.` };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const reason = `Chose the QuickBooks account for ${label}`;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("set_qbo_mapping", { p_center: auth.session.center.id, p_purpose: purpose, p_qbo_account_id: account, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  const name = data && typeof data === "object" && !Array.isArray(data) ? String((data as Record<string, unknown>).qbo_account_name ?? "") : "";
  return { ok: true, message: `${label} → ${name || "saved"}. Approve the mapping again before anything posts with it.` };
}

export async function saveFundClassAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const fund = text(fd, "fund_id");
  const cls = text(fd, "qbo_class_id");
  const doing = "save the fund's QuickBooks class";
  if (!isUuid(fund)) return { ok: false, error: `Could not ${doing} — the fund was not found.` };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const reason = cls ? "Chose the fund's QuickBooks class" : "Cleared the fund's QuickBooks class";
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_qbo_fund_class", { p_center: auth.session.center.id, p_fund: fund, p_qbo_class_id: cls, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Class saved. Approve the mapping again before anything posts with it." };
}

export async function approveQboMappingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "approve the QuickBooks mapping";
  const reason = text(fd, "reason");
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("approve_qbo_mapping", { p_center: auth.session.center.id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  const n = data && typeof data === "object" && !Array.isArray(data) ? Number((data as Record<string, unknown>).approved ?? 0) : 0;
  return { ok: true, message: `Mapping approved (${n} account${n === 1 ? "" : "s"}) · audit logged. Next: run the test post.` };
}

export async function runQboTestPostAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "run the QuickBooks test post";
  const reason = text(fd, "reason");
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("request_qbo_test_post", {
    p_center: auth.session.center.id,
    p_confirm_real: fd.get("confirm_real") === "on",
    p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  const real = fd.get("confirm_real") === "on";
  return {
    ok: true,
    message: real
      ? `Test post queued: it creates four real $1.00 entries in QuickBooks. When they are there, void them: ${TEST_POST_HOW_TO_VOID} The result appears here within a minute; reload to see it.`
      : "Test post queued. The result appears here within a minute; reload to see it.",
  };
}

export async function approveQboTestPostAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "approve the test post";
  const id = text(fd, "test_id");
  const reason = text(fd, "reason");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — the test post was not found.` };
  const bad = reasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("approve_qbo_test_post", { p_test: id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Test post approved · audit logged." };
}

export async function postQboNowAction(): Promise<ActionResult> {
  const doing = "post to QuickBooks now";
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("request_qbo_post", { p_center: auth.session.center.id });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: `Posting run queued (job #${data}).` };
}
