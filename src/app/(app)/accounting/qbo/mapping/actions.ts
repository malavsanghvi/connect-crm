"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import { can } from "@/lib/permissions";
import { changeInputProblem, decisionReasonProblem } from "@/lib/qbo/mapping";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, authorizeActionWhere, dbWithReason } from "@/lib/session";

// Accounting › Account mapping (migration 0606, docs/FUND_ACCOUNT_MAPPING_GAPS.md). Every rule is in the database: who may
// ask (the owner or accounting.manage), who may confirm (a DIFFERENT person with giving.approve, never a platform admin),
// the fresh 2FA check and the reason each gives, what counts as a usable account. These actions check the input, call the
// function and put the outcome in plain English next to what was clicked; a refusal is shown as it is (a CCSTP refusal
// opens the 2FA check and sends the same thing again), and the technical detail is logged.

const PATHS = ["/accounting/qbo/mapping", "/accounting/qbo/setup", "/accounting/qbo", "/"];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Choose (before the mapping is in use: saved at once, one person) or ask to change (once it is in use: a second person
 * confirms) the account of a fund or role, the class of a fund, or the QuickBooks account of a bank account.
 * Form fields: subject (role | fund_class | bank_account), target (role key, fund id or bank account id), to (the
 * QuickBooks id; empty = no class / the main bank account), label (what it is, for the message), in_use, reason.
 */
export async function requestMappingChangeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const subject = text(fd, "subject");
  const target = text(fd, "target");
  const to = text(fd, "to");
  const label = text(fd, "label") || "the account";
  const inUse = text(fd, "in_use") === "1";
  const doing = inUse ? `ask to change ${label}` : `choose ${label}`;
  const typed = text(fd, "reason");
  const bad = changeInputProblem({ subject, target, to, reason: typed, inUse }, doing);
  if (bad) return { ok: false, error: bad };
  if (subject !== "role" && !isUuid(target)) return { ok: false, error: `Could not ${doing} — it was not found. Reload the page.` };
  const auth = await authorizeAction("qboManage", doing);
  if (!auth.ok) return auth;
  const reason = typed || `Chose ${label} during setup`;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await untypedRpc(db)("request_account_mapping_change", {
    p_center: auth.session.center.id, p_subject: subject, p_target: target, p_to: to || null, p_reason: reason,
  });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  const r = obj(data);
  if (r.status === "pending") {
    return { ok: true, message: "Asked. A different person with giving.approve has to confirm it; until then postings keep using the current account." };
  }
  const name = typeof r.to_name === "string" && r.to_name ? r.to_name : subject === "fund_class" ? "no class" : subject === "bank_account" ? "the main bank account" : "saved";
  return { ok: true, message: `${label} → ${name}. Approve the mapping again before anything posts with it.` };
}

/** The second person confirms (it applies to postings sent from now on) or turns it down. Never the person who asked. */
export async function decideMappingChangeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "request_id");
  const yes = text(fd, "approve") === "1";
  const doing = yes ? "confirm the change" : "turn the change down";
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — that request was not found. Reload the page.` };
  const reason = text(fd, "reason");
  const bad = decisionReasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeAction("givingApprove", doing);
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await untypedRpc(db)("decide_account_mapping_change", { p_request: id, p_approve: yes, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  if (!yes) return { ok: true, message: "Turned down. Nothing was changed, and the person who asked can see why." };
  const requeued = Number(obj(data).requeued ?? 0);
  return {
    ok: true,
    message:
      "Confirmed. Postings sent from now on use it; entries already posted keep their accounts."
      + (requeued > 0 ? ` ${requeued} posting${requeued === 1 ? " that was" : "s that were"} waiting for it went back in the queue.` : ""),
  };
}

/** Withdraw a request that is still waiting (the person who asked, or anyone who may ask or confirm). */
export async function cancelMappingChangeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "request_id");
  const doing = "withdraw the request";
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — that request was not found. Reload the page.` };
  const reason = text(fd, "reason");
  const bad = decisionReasonProblem(reason, doing);
  if (bad) return { ok: false, error: bad };
  const auth = await authorizeActionWhere((s) => can(s, ["accounting.manage", "giving.approve"]), doing, "accounting.manage or giving.approve");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await untypedRpc(db)("cancel_account_mapping_change", { p_request: id, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Withdrawn. Nothing was changed." };
}
