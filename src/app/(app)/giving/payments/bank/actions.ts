"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { bankTransactionInsert } from "@/lib/db-inserts";
import { explainError, failure, type ActionResult } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

function refresh() {
  revalidatePath("/giving/payments/bank");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
export type ImportLine = {
  row: number;
  posted_on: string;
  amount_cents: number;
  description: string;
  bank_type: string | null;
  bank_details: string | null;
  check_or_slip: string | null;
  raw: Record<string, string>;
};

export type ImportResult = { total: number; inserted: number; duplicates: number; failed: { row: number; reason: string }[] };

const MAX_LINES = 5000;

function validLine(l: ImportLine): string | null {
  if (!l || typeof l !== "object") return "not a statement line";
  if (typeof l.posted_on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(l.posted_on)) return "the date is not valid";
  if (!Number.isSafeInteger(l.amount_cents) || l.amount_cents === 0) return "the amount is not valid";
  if (typeof l.description !== "string" || !l.description.trim()) return "the description is blank";
  if (l.description.length > 1000) return "the description is too long";
  for (const v of [l.bank_type, l.bank_details, l.check_or_slip]) {
    if (v !== null && (typeof v !== "string" || v.length > 100)) return "a Chase column is too long";
  }
  if (!l.raw || typeof l.raw !== "object" || Array.isArray(l.raw)) return "the original row is missing";
  return null;
}

export async function importBankLinesAction(input: {
  bankAccountId: string;
  fileName: string;
  lines: ImportLine[];
}): Promise<ActionResult<ImportResult>> {
  const auth = await authorizeAction("bankImport", "import the statement");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(input.bankAccountId)) return { ok: false, error: "Could not import the statement — choose the bank account first." };
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length === 0) return { ok: false, error: "Could not import the statement — there are no lines to import." };
  if (lines.length > MAX_LINES) {
    return { ok: false, error: `Could not import the statement — it has ${lines.length} lines; split it into files of at most ${MAX_LINES}.` };
  }
  const failed: { row: number; reason: string }[] = [];
  const good = lines.filter((l) => {
    const problem = validLine(l);
    if (problem) failed.push({ row: Number(l?.row) || 0, reason: problem });
    return !problem;
  });
  if (good.length === 0) return { ok: false, error: "Could not import the statement — none of the lines are valid." };

  const account = await db.from("bank_accounts").select("id").eq("id", input.bankAccountId).eq("center_id", center.id).maybeSingle();
  if (account.error) return failure("Could not import the statement", account.error);
  if (!account.data) return { ok: false, error: "Could not import the statement — that bank account was not found." };

  const dates = good.map((l) => l.posted_on).sort();
  const imp = await db
    .from("bank_statement_imports")
    .insert({
      center_id: center.id,
      bank_account_id: input.bankAccountId,
      file_path: String(input.fileName ?? "").slice(0, 200) || null,
      period_start: dates[0],
      period_end: dates[dates.length - 1],
      rows_total: lines.length,
      imported_by: userId,
    })
    .select("id")
    .single();
  if (imp.error) return failure("Could not import the statement", imp.error);
  const importId = imp.data.id;

  const toRow = (l: ImportLine) =>
    bankTransactionInsert({
      center_id: center.id,
      bank_account_id: input.bankAccountId,
      import_id: importId,
      posted_on: l.posted_on,
      amount_cents: l.amount_cents,
      description: l.description.trim(),
      bank_type: l.bank_type,
      bank_details: l.bank_details,
      check_or_slip: l.check_or_slip,
      raw: l.raw as Json,
    });

  // Fast path: everything is new.
  const bulk = await db.from("bank_transactions").insert(good.map(toRow));
  if (!bulk.error) {
    refresh();
    return {
      ok: true,
      message: `Imported ${good.length} new line${good.length === 1 ? "" : "s"}.`,
      data: { total: lines.length, inserted: good.length, duplicates: 0, failed },
    };
  }
  if (bulk.error.code !== "23505") return failure("Could not import the statement", bulk.error);

  // Some lines were imported before (same fingerprint): insert one by one and count them.
  let inserted = 0;
  let duplicates = 0;
  for (const l of good) {
    const r = await db.from("bank_transactions").insert(toRow(l));
    if (!r.error) inserted += 1;
    else if (r.error.code === "23505") duplicates += 1;
    else {
      console.error("[bank import] line failed:", l.row, r.error);
      failed.push({ row: l.row, reason: explainError(r.error) });
    }
  }
  refresh();
  const parts = [`Imported ${inserted} new line${inserted === 1 ? "" : "s"}`];
  if (duplicates > 0) parts.push(`${duplicates} already imported`);
  if (failed.length > 0) parts.push(`${failed.length} could not be imported`);
  return { ok: true, message: `${parts.join("; ")}.`, data: { total: lines.length, inserted, duplicates, failed } };
}

// ---------------------------------------------------------------------------
// Gifts: one bank line = one gift from one household
// ---------------------------------------------------------------------------
export type ConfirmResult = {
  txnId: string;
  householdName: string;
  receiptNumber: string | null;
  amountCents: number;
  applied: { pledge_number: string | null; amount_cents: number }[];
  learnedPayer: { value: string; times: number } | null;
};

export async function confirmBankMatchAction(input: {
  txnId: string;
  householdId: string;
  pledgeIds: string[] | null;
  learnPayer: boolean;
}): Promise<ActionResult<ConfirmResult>> {
  const auth = await authorizeAction("bankConfirm", "confirm the match");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  if (!isUuid(input.txnId) || !isUuid(input.householdId)) return { ok: false, error: "Could not confirm the match — choose a household first." };
  const pledgeIds = input.pledgeIds && input.pledgeIds.length > 0 ? input.pledgeIds.filter(isUuid) : null;

  const txn = await db.from("bank_transactions").select("id, payer_normalized, amount_cents").eq("id", input.txnId).maybeSingle();
  if (txn.error) return failure("Could not confirm the match", txn.error);
  if (!txn.data) return { ok: false, error: "Could not confirm the match — the bank line was not found." };

  const rpc = await db.rpc("confirm_bank_match", {
    p_txn: input.txnId,
    p_household: input.householdId,
    ...(pledgeIds ? { p_pledge_ids: pledgeIds } : {}),
    p_learn_payer: Boolean(input.learnPayer),
  });
  if (rpc.error) return failure("Could not confirm the match", rpc.error);
  const paymentId = rpc.data;

  // Report what happened: receipt, allocation, learned payer name.
  const [pay, allocs, hh, learned] = await Promise.all([
    db.from("payments").select("receipt_number, amount_cents").eq("id", paymentId).maybeSingle(),
    db.from("payment_allocations").select("pledge_id, amount_cents").eq("payment_id", paymentId),
    // household_card is readable with giving.record_offline too (households RLS is not).
    db.rpc("household_card", { p_household: input.householdId }),
    txn.data.payer_normalized
      ? db
          .from("external_ids")
          .select("value, times_matched")
          .eq("center_id", center.id)
          .eq("household_id", input.householdId)
          .eq("kind", "bank_payer")
          .eq("normalized", txn.data.payer_normalized)
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const pledgeNumbers = new Map<string, string | null>();
  const allocRows = allocs.data ?? [];
  if (allocRows.length > 0) {
    const pl = await db.from("pledges").select("id, pledge_number").in("id", allocRows.map((a) => a.pledge_id));
    for (const p of pl.data ?? []) pledgeNumbers.set(p.id, p.pledge_number);
  }
  const learnedRow = input.learnPayer ? (learned.data ?? [])[0] : undefined;
  const card = hh.data?.[0];
  const householdName = card ? `${card.household_name}${card.household_number ? ` (${card.household_number})` : ""}` : "the household";
  refresh();
  return {
    ok: true,
    message: `Matched ${formatCents(txn.data.amount_cents, center.currency)} to ${householdName}.`,
    data: {
      txnId: input.txnId,
      householdName,
      receiptNumber: pay.data?.receipt_number ?? null,
      amountCents: pay.data?.amount_cents ?? txn.data.amount_cents,
      applied: allocRows.map((a) => ({ pledge_number: pledgeNumbers.get(a.pledge_id) ?? null, amount_cents: a.amount_cents })),
      learnedPayer: learnedRow ? { value: learnedRow.value, times: learnedRow.times_matched } : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Batch deposits: one bank line = several recorded check / cash payments
// ---------------------------------------------------------------------------
export async function matchDepositAction(input: { txnId: string; paymentIds: string[] }): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeAction("bankConfirm", "match the deposit");
  if (!auth.ok) return auth;
  const ids = (input.paymentIds ?? []).filter(isUuid);
  if (!isUuid(input.txnId)) return { ok: false, error: "Could not match the deposit — the bank line was not found." };
  if (ids.length === 0) return { ok: false, error: "Could not match the deposit — tick the payments that make up this deposit." };
  const { data, error } = await auth.session.db.rpc("match_deposit", { p_txn: input.txnId, p_payment_ids: ids });
  if (error) {
    const m = /chosen payments total (-?\d+) but the deposit is (-?\d+)/.exec(error.message ?? "");
    if (m) {
      const cur = auth.session.center.currency;
      return {
        ok: false,
        error: `Could not match the deposit — the ticked payments total ${formatCents(Number(m[1]), cur)} but the deposit is ${formatCents(Number(m[2]), cur)}. They must add up exactly.`,
      };
    }
    return failure("Could not match the deposit", error);
  }
  refresh();
  return { ok: true, message: `Deposit matched to ${data} recorded payment${data === 1 ? "" : "s"} and queued for QuickBooks as one deposit.`, data: { count: data } };
}

// ---------------------------------------------------------------------------
// Ignore / restore
// ---------------------------------------------------------------------------
export async function ignoreBankLineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("bankIgnore", "ignore the bank line");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!isUuid(id)) return { ok: false, error: "Could not ignore the line — it was not found." };
  const { data, error } = await auth.session.db
    .from("bank_transactions")
    .update({ status: "ignored", notes: note || null, matched_by: auth.session.userId, matched_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["unmatched", "suggested"])
    .select("id");
  if (error) return failure("Could not ignore the bank line", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not ignore the line — it is already matched or ignored." };
  refresh();
  return { ok: true, message: "Line ignored. You can restore it from the Ignored tab." };
}

export async function restoreBankLineAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("bankIgnore", "restore the bank line");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not restore the line — it was not found." };
  const { data, error } = await auth.session.db
    .from("bank_transactions")
    .update({ status: "unmatched", matched_by: null, matched_at: null })
    .eq("id", id)
    .eq("status", "ignored")
    .select("id");
  if (error) return failure("Could not restore the bank line", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not restore the line — it is not ignored any more." };
  refresh();
  return { ok: true, message: "Line restored to the unmatched list." };
}

// ---------------------------------------------------------------------------
// Bank accounts
// ---------------------------------------------------------------------------
export async function createBankAccountAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("qboManage", "add the bank account");
  if (!auth.ok) return auth;
  const name = String(formData.get("name") ?? "").trim();
  const institution = String(formData.get("institution") ?? "").trim();
  const last4 = String(formData.get("last4") ?? "").trim();
  const format = String(formData.get("statement_format") ?? "generic_csv");
  if (!name) return { ok: false, error: "Could not add the bank account — give it a name, e.g. Chase operating ··4608." };
  if (last4 && !/^\d{4}$/.test(last4)) return { ok: false, error: "Could not add the bank account — the last 4 digits must be 4 numbers." };
  if (!["generic_csv", "chase_csv"].includes(format)) return { ok: false, error: "Could not add the bank account — choose the statement format." };
  const { error } = await auth.session.db.from("bank_accounts").insert({
    center_id: auth.session.center.id,
    name: name.slice(0, 120),
    institution: institution.slice(0, 80) || null,
    last4: last4 || null,
    statement_format: format,
  });
  if (error) return failure("Could not add the bank account", error);
  refresh();
  return { ok: true, message: `Added ${name}.` };
}
