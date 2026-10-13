"use server";

import { revalidatePath } from "next/cache";

import { communityFormat } from "@/lib/community-format";
import { loadCountSheet, loadDepositChoices, type CountSheetData, type DepositChoices } from "@/lib/data/giving-counts";
import { formatDate } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { kindModuleLabel } from "@/lib/kind";
import { isModuleEnabled, moduleDef, moduleOffMessage, type ModuleKey } from "@/lib/modules";
import { formatCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

// Giving › the counts (docs/GIVING_REDESIGN.md slice 5). Reads for the two sheets, and the match and its undo, which go through
// app.link_count_to_bank_deposit and app.unlink_count_from_bank_deposit (0744): those decide; nothing here moves money.
// Starting a count and Mark deposited stay the existing counting actions (../payments/counting-actions.ts).

/** The sentence of a switched-off module, said before the database is asked (it would refuse with the same). */
function offSentence(session: CrmSession, modules: ModuleKey[]): string | null {
  const off = modules.find((m) => !isModuleEnabled(session, m));
  if (!off) return null;
  return moduleOffMessage(off, session.center.short_name || session.center.name, kindModuleLabel(session.kind, off, moduleDef(off).label));
}

function revalidate() {
  revalidatePath("/giving/counts");
  revalidatePath("/giving");
}

/** What Start a count needs when it opens: the adults who can count (the last counters first), recent events, notes and coins. */
export async function countSheetAction(): Promise<ActionResult<CountSheetData>> {
  const auth = await authorizeAction("countingRecord", "open Start a count");
  if (!auth.ok) return auth;
  const off = offSentence(auth.session, [GIVING_ADDONS.counts]);
  if (off) return { ok: false, error: `Could not open Start a count — ${off}` };
  const res = await loadCountSheet(auth.session);
  return res.ok ? { ok: true, data: res.data } : res;
}

/** The bank lines of exactly the counted amount, near the counting day, not matched to anything yet. */
export async function depositChoicesAction(countId: string): Promise<ActionResult<DepositChoices>> {
  const auth = await authorizeAction("bankConfirm", "load the bank deposits");
  if (!auth.ok) return auth;
  const off = offSentence(auth.session, [GIVING_ADDONS.counts, GIVING_ADDONS.bank]);
  if (off) return { ok: false, error: `Could not load the bank deposits — ${off}` };
  if (!isUuid(countId)) return { ok: false, error: "Could not load the bank deposits — the count was not found." };
  const res = await loadDepositChoices(auth.session, countId);
  return res.ok ? { ok: true, data: res.data } : res;
}

/** Match a count to the bank line the person picked (exact amount only; the database checks everything again). */
export async function matchCountDepositAction(countId: string, txnId: string): Promise<ActionResult> {
  const doing = "Could not match the count to its deposit";
  const auth = await authorizeAction("bankConfirm", "match the count to its deposit");
  if (!auth.ok) return auth;
  const off = offSentence(auth.session, [GIVING_ADDONS.counts, GIVING_ADDONS.bank]);
  if (off) return { ok: false, error: `${doing} — ${off}` };
  if (!isUuid(countId)) return { ok: false, error: `${doing} — the count was not found.` };
  if (!isUuid(txnId)) return { ok: false, error: `${doing} — pick the bank deposit first.` };
  const { data, error } = await auth.session.db.rpc("link_count_to_bank_deposit", { p_session: countId, p_txn: txnId });
  if (error) return failure(doing, error);
  revalidate();
  const d = (data ?? {}) as { amount_cents?: number; posted_on?: string };
  const fmt = communityFormat(auth.session.center);
  const what =
    typeof d.amount_cents === "number" && d.posted_on
      ? `the count of ${formatCents(d.amount_cents, fmt.currency, fmt.locale)} is matched to the ${formatDate(d.posted_on, auth.session.center.time_zone)} deposit`
      : "the count is matched to its deposit";
  return { ok: true, message: `${what[0].toUpperCase()}${what.slice(1)}. Audit logged.` };
}

/** A treasurer undoes a wrong match, with a reason kept in the audit trail. Refused in a locked month (the database says so). */
export async function unmatchCountDepositAction(countId: string, reason: string): Promise<ActionResult> {
  const doing = "Could not undo the deposit match";
  const auth = await authorizeAction("givingManage", "undo the deposit match");
  if (!auth.ok) return auth;
  const off = offSentence(auth.session, [GIVING_ADDONS.counts, GIVING_ADDONS.bank]);
  if (off) return { ok: false, error: `${doing} — ${off}` };
  if (!isUuid(countId)) return { ok: false, error: `${doing} — the count was not found.` };
  const why = reason.trim().slice(0, 500);
  if (!why) return { ok: false, error: `${doing} — say why it is being undone.` };
  const { data, error } = await auth.session.db.rpc("unlink_count_from_bank_deposit", { p_session: countId, p_reason: why });
  if (error) return failure(doing, error);
  revalidate();
  const reopened = Boolean((data as { line_reopened?: boolean } | null)?.line_reopened);
  return {
    ok: true,
    message: reopened
      ? "The count is waiting for its deposit again, and the bank line is open again. Audit logged with your reason."
      : "The count is waiting for its deposit again. The bank line stays matched to what was matched to it since. Audit logged with your reason.",
  };
}
