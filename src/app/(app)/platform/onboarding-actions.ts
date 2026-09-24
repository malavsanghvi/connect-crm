"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { dbWithReason, loadSession, type CrmSession } from "@/lib/session";

// Community Connect console (ONBOARDING_PLAN §6): Requests, Sandbox codes,
// Go-live approvals, Support access. Every write goes through an o-platform RPC
// that checks platform-admin rights again and audits with the reason.

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Community Connect platform admins can do this.` };
  return { ok: true, session: state.session };
}

let warnedNoEmail = false;
/** The contract's degradation: log once on the server when platform email is not set up. */
function noteEmailStatus(status: string | null | undefined) {
  if (status === "not_set_up" && !warnedNoEmail) {
    warnedNoEmail = true;
    console.error("[platform] app.enqueue_message is not available: platform emails (sandbox codes, decisions) are not being sent. The console shows the text to send by hand.");
  } else if (status?.startsWith("failed")) {
    console.error(`[platform] a platform email was not queued: ${status}`);
  }
}

export type DecisionResult = { status: string; code?: string; expiresAt?: string; emailStatus?: string };

/** Requests: approve (issues and shows the sandbox code once), decline (reason emailed) or ask for more information. */
export async function decideRequestAction(_prev: ActionResult<DecisionResult> | null, fd: FormData): Promise<ActionResult<DecisionResult>> {
  const decision = String(fd.get("decision") ?? "");
  const doing = decision === "approve" ? "approve the request" : decision === "decline" ? "decline the request" : "ask for more information";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("request") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  if (!["approve", "decline", "more_info"].includes(decision)) return { ok: false, error: `Could not ${doing} — choose approve, decline or more information.` };
  const note = String(fd.get("note") ?? "").trim();
  if (decision !== "approve" && !note) {
    return { ok: false, error: decision === "decline" ? "Could not decline — give the reason; the contact receives it." : "Could not send — write the question for the contact." };
  }
  if (note.length > 1000) return { ok: false, error: `Could not ${doing} — keep the note under 1,000 characters.` };
  const db = note ? await dbWithReason(auth.session, note) : auth.session.db;
  const { data, error } = await db.rpc("decide_access_request", { p_request: id, p_decision: decision, p_note: note || undefined });
  if (error) return failure(`Could not ${doing}`, error);
  const r = (data ?? {}) as { status?: string; code?: string; expires_at?: string; email_status?: string };
  noteEmailStatus(r.email_status);
  // After an approval the list is NOT refreshed here: the new code is on screen
  // once, in the drawer, and refreshing would close it. "Done" refreshes.
  if (decision !== "approve") revalidatePath("/platform/requests");
  const message =
    decision === "approve" ? "Approved · sandbox code issued · audit logged" : decision === "decline" ? "Declined · audit logged" : "Question recorded · audit logged";
  return { ok: true, message, data: { status: r.status ?? decision, code: r.code, expiresAt: r.expires_at, emailStatus: r.email_status } };
}

/** Sandbox codes: re-issue (the open code stops working) — returns the new code once. */
export async function reissueCodeAction(_prev: ActionResult<DecisionResult> | null, fd: FormData): Promise<ActionResult<DecisionResult>> {
  const doing = "re-issue the code";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("request") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — give a reason (it goes in the audit log).` };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("issue_sandbox_code", { p_request: id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { ok: false, error: `Could not ${doing} — the database returned no code. Reload and check the list.` };
  noteEmailStatus(row.email_status);
  // Not refreshed here, so the drawer showing the new code stays open ("Done" refreshes).
  return { ok: true, message: "New code issued · the earlier one no longer works", data: { status: "issued", code: row.code, expiresAt: row.expires_at, emailStatus: row.email_status } };
}

export async function revokeCodeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "revoke the code";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("code") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — give a reason (it goes in the audit log).` };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("revoke_sandbox_code", { p_id: id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/codes");
  return { ok: true, message: "Code revoked · audit logged" };
}

/** Go-live approvals: two different platform admins approve; either can send it back with a note. */
export async function decideGoliveAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const approve = fd.get("decision") === "approve";
  const doing = approve ? "approve go-live" : "send the go-live request back";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("request") ?? "");
  const note = String(fd.get("note") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  if (!approve && !note) return { ok: false, error: "Could not send it back — say what must change; the organization sees it." };
  const db = note ? await dbWithReason(auth.session, note) : auth.session.db;
  if (approve) {
    const { data, error } = await db.rpc("approve_golive", { p_request: id, p_note: note || undefined });
    if (error) return failure(`Could not ${doing}`, error);
    revalidatePath("/platform/go-live");
    revalidatePath("/platform/pipeline");
    return { ok: true, message: data === "approved" ? "Second approval recorded · go-live approved" : "First approval recorded · a second, different admin must approve" };
  }
  const { error } = await db.rpc("reject_golive", { p_request: id, p_note: note });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/go-live");
  return { ok: true, message: "Sent back with your note · audit logged" };
}

/** Support access: the grantee may end a grant early. */
export async function endSupportGrantAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "end the support access";
  const auth = await platformSession(doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("grant") ?? "");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — reload the page and try again.` };
  const { error } = await auth.session.db.rpc("revoke_support_access", { p_grant: id, p_reason: "Ended by the Community Connect team member" });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/platform/support-access");
  return { ok: true, message: "Support access ended · audit logged" };
}
