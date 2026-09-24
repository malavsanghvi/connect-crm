"use server";

import { revalidatePath } from "next/cache";

import type { HouseholdCardData } from "@/components/household-card";
import { householdCards } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { failure, type ActionResult } from "@/lib/errors";
import { bulkPick, parseThreshold } from "@/lib/qbo-match";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Accounting › QuickBooks › Donor matching (o-qbo-match). Every decision goes
// through the 0242/0243 RPCs, which check accounting.manage and the module
// switch again; the reason travels as x-audit-reason and as the RPC argument.

const PATH = "/accounting/qbo/matching";

function refresh() {
  revalidatePath(PATH);
}

function reasonOf(fd: FormData): string {
  return String(fd.get("reason") ?? "").trim();
}

const QBO_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export async function pullNowAction(): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "pull from QuickBooks");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("qbo_request_pull", { p_center: auth.session.center.id });
  if (error) return failure("Could not start the QuickBooks pull", error);
  refresh();
  return { ok: true, message: `Pull queued (job ${data}). The background service reads QuickBooks and refreshes the suggestions; reload in a minute.` };
}

export async function suggestAgainAction(): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "find matches again");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("qbo_suggest_matches", { p_center: auth.session.center.id });
  if (error) return failure("Could not find matches", error);
  refresh();
  const r = (data ?? {}) as { customers?: number; suggestions?: number; ambiguous?: number; no_candidate?: number };
  return {
    ok: true,
    message: `Looked at ${r.customers ?? 0} QuickBooks customers: ${r.suggestions ?? 0} suggestions, ${r.ambiguous ?? 0} too close to call, ${r.no_candidate ?? 0} with no candidate.`,
  };
}

export async function askAiAction(): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "ask AI for suggestions");
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("qbo_request_ai", { p_center: auth.session.center.id });
  if (error) return failure("Could not ask for AI suggestions", error);
  refresh();
  return { ok: true, message: "AI suggestions requested for the customers the rules could not settle. They appear under Suggested, marked AI." };
}

export async function approveMatchAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "approve the match");
  if (!auth.ok) return auth;
  const id = String(fd.get("id") ?? "");
  const reason = reasonOf(fd);
  if (!isUuid(id)) return { ok: false, error: "Could not approve — the match was not found." };
  if (!reason) return { ok: false, error: "Could not approve — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("approve_qbo_matches", { p_ids: [id], p_reason: reason });
  if (error) return failure("Could not approve the match", error);
  refresh();
  const queued = (data as { bring_in_queued?: number } | null)?.bring_in_queued ?? 0;
  return {
    ok: true,
    message: queued ? "Approved. Its QuickBooks history is being brought in to the household." : "Approved. The background service is not set up, so its history will come in once it runs.",
  };
}

export async function bulkApproveAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "approve matches");
  if (!auth.ok) return auth;
  const threshold = parseThreshold(fd.get("threshold"));
  const reason = reasonOf(fd);
  if (threshold === null) return { ok: false, error: "Could not approve — the confidence must be a number from 50 to 100." };
  if (!reason) return { ok: false, error: "Could not approve — give a reason (it is kept in the audit log)." };
  const { db, center } = auth.session;
  const { data: rows, error: readError } = await db
    .from("qbo_customer_matches")
    .select("id, qbo_customer_id, confidence")
    .eq("center_id", center.id)
    .eq("status", "suggested")
    .limit(5000);
  if (readError) return failure("Could not read the suggestions", readError);
  const ids = bulkPick(rows ?? [], threshold);
  if (ids.length === 0) return { ok: false, error: `No suggestion is at ${Math.round(threshold * 100)}% or more and clearly ahead of the next one.` };
  const wdb = await dbWithReason(auth.session, reason);
  let approved = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await wdb.rpc("approve_qbo_matches", { p_ids: ids.slice(i, i + 500), p_reason: reason });
    if (error) {
      refresh();
      return failure(approved ? `Approved ${approved}, then could not approve the rest` : "Could not approve the matches", error);
    }
    approved += (data as { approved?: number } | null)?.approved ?? 0;
  }
  refresh();
  return { ok: true, message: `Approved ${approved} match${approved === 1 ? "" : "es"} at ${Math.round(threshold * 100)}% or more. Their history is being brought in.` };
}

export async function rejectMatchAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "reject the match");
  if (!auth.ok) return auth;
  const id = String(fd.get("id") ?? "");
  const reason = reasonOf(fd);
  if (!isUuid(id)) return { ok: false, error: "Could not reject — the match was not found." };
  if (!reason) return { ok: false, error: "Could not reject — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("reject_qbo_match", { p_id: id, p_reason: reason });
  if (error) return failure("Could not reject the match", error);
  refresh();
  return { ok: true, message: "Rejected. It will not be suggested again; the customer stays under Not mapped yet until it is mapped." };
}

export async function mapCustomerAction(input: { qboId: string; householdId: string; personId: string | null; reason: string }): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "map the QuickBooks customer");
  if (!auth.ok) return auth;
  const reason = String(input.reason ?? "").trim();
  if (!QBO_ID.test(String(input.qboId ?? ""))) return { ok: false, error: "Could not map — the QuickBooks customer was not found." };
  if (!isUuid(input.householdId)) return { ok: false, error: "Could not map — choose the household first." };
  if (input.personId && !isUuid(input.personId)) return { ok: false, error: "Could not map — that person was not found." };
  if (!reason) return { ok: false, error: "Could not map — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("map_qbo_customer", {
    p_center: auth.session.center.id,
    p_qbo_customer: input.qboId,
    p_household: input.householdId,
    p_person: input.personId ?? undefined,
    p_reason: reason,
  });
  if (error) return failure("Could not map the QuickBooks customer", error);
  refresh();
  const r = (data ?? {}) as { remapped?: boolean; records_moved?: number };
  return {
    ok: true,
    message: r.remapped
      ? `Remapped. ${r.records_moved ?? 0} record${r.records_moved === 1 ? "" : "s"} already brought in moved to the new household.`
      : "Mapped. Its QuickBooks history is being brought in to the household.",
  };
}

export async function unmapAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "undo the mapping");
  if (!auth.ok) return auth;
  const qbo = String(fd.get("qbo") ?? "");
  const reason = reasonOf(fd);
  if (!QBO_ID.test(qbo)) return { ok: false, error: "Could not undo — the QuickBooks customer was not found." };
  if (!reason) return { ok: false, error: "Could not undo — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("unmap_qbo_customer", { p_center: auth.session.center.id, p_qbo_customer: qbo, p_reason: reason });
  if (error) return failure("Could not undo the mapping", error);
  refresh();
  return { ok: true, message: "Mapping undone. The customer is back under Not mapped yet." };
}

export async function createHouseholdAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "create the household");
  if (!auth.ok) return auth;
  const qbo = String(fd.get("qbo") ?? "");
  const reason = reasonOf(fd);
  if (!QBO_ID.test(qbo)) return { ok: false, error: "Could not create the household — the QuickBooks customer was not found." };
  if (!reason) return { ok: false, error: "Could not create the household — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("create_household_from_qbo", { p_center: auth.session.center.id, p_qbo_customer: qbo, p_reason: reason });
  if (error) return failure("Could not create the household", error);
  refresh();
  revalidatePath("/households");
  return { ok: true, message: "Household created with its primary member, and mapped. Its QuickBooks history is being brought in." };
}

export async function retryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "try again");
  if (!auth.ok) return auth;
  const qbo = String(fd.get("qbo") ?? "");
  if (qbo && !QBO_ID.test(qbo)) return { ok: false, error: "Could not try again — the QuickBooks customer was not found." };
  const { data, error } = await auth.session.db.rpc("qbo_retry_bring_in", { p_center: auth.session.center.id, p_qbo_customer: qbo || undefined });
  if (error) return failure("Could not try again", error);
  refresh();
  return { ok: true, message: data ? `Queued again for ${data} customer${data === 1 ? "" : "s"}.` : "Nothing was waiting for a mapped customer." };
}

export async function saveSettingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboMatchManage", "save the matching settings");
  if (!auth.ok) return auth;
  const level = String(fd.get("level") ?? "");
  const years = Number(String(fd.get("history_years") ?? "").trim());
  const reason = reasonOf(fd);
  if (!["family", "person", "mixed"].includes(level)) return { ok: false, error: "Could not save — choose how QuickBooks customers are kept." };
  if (!Number.isInteger(years) || years < 1 || years > 25) return { ok: false, error: "Could not save — history is 1 to 25 years." };
  if (!reason) return { ok: false, error: "Could not save — give a reason (it is kept in the audit log)." };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_qbo_match_settings", { p_center: auth.session.center.id, p_level: level, p_history_years: years, p_reason: reason });
  if (error) return failure("Could not save the matching settings", error);
  refresh();
  return { ok: true, message: "Saved. New suggestions use this level; the next pull uses the history window." };
}

export type FinderResult = { cards: HouseholdCardData[]; hits: never[]; more: boolean };

/** The household picker's search, gated on accounting.manage (the picker never picks by name alone: it shows cards). */
export async function findHouseholdsForQboAction(query: string): Promise<ActionResult<FinderResult>> {
  const auth = await authorizeAction("qboMatchManage", "search households");
  if (!auth.ok) return auth;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name, a member or household ID." };
  if (q.length > 120) return { ok: false, error: "That search is too long." };
  const { db, center } = auth.session;
  const found = await searchHouseholds(db, center.id, q, { limit: 60 });
  if (found.error && found.householdIds.length === 0) return failure("Could not search households", found.error);
  const ids = found.householdIds.slice(0, 12);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0) return failure("Could not load the household details", cards.error);
  return { ok: true, data: { cards: ids.map((id) => cards.map.get(id)).filter((c): c is HouseholdCardData => !!c), hits: [], more: found.householdIds.length > 12 } };
}

export type MemberOption = { id: string; name: string; primary: boolean };

/** The household's current members, for a person-level mapping. */
export async function householdMembersAction(householdId: string): Promise<ActionResult<MemberOption[]>> {
  const auth = await authorizeAction("qboMatchManage", "load the household's members");
  if (!auth.ok) return auth;
  if (!isUuid(householdId)) return { ok: false, error: "Could not load the members — the household was not found." };
  const { db } = auth.session;
  const { data: links, error } = await db.from("household_members").select("person_id, is_primary").eq("household_id", householdId).is("left_at", null);
  if (error) return failure("Could not load the household's members", error);
  const ids = (links ?? []).map((l) => l.person_id);
  if (ids.length === 0) return { ok: true, data: [] };
  const { data: people, error: pErr } = await db.from("people").select("id, first_name, last_name, preferred_name").in("id", ids);
  if (pErr) return failure("Could not load the household's members", pErr);
  const primary = new Set((links ?? []).filter((l) => l.is_primary).map((l) => l.person_id));
  return {
    ok: true,
    data: (people ?? [])
      .map((p) => ({ id: p.id, name: `${p.preferred_name || p.first_name} ${p.last_name}`, primary: primary.has(p.id) }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)),
  };
}

/** One suggestion's Approve / Reject buttons share a form (the pressed button sends decision). */
export async function decideMatchAction(prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return String(fd.get("decision") ?? "approve") === "reject" ? rejectMatchAction(prev, fd) : approveMatchAction(prev, fd);
}
