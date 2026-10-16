import "server-only";

// Giving › Bank: the Reconcile preview and the Unbanked report (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 5, 0868).
// READ ONLY. It asks app.reconcile_statement / app.unbanked_payments_report, attaches each family's household card (a family is never
// shown by name alone), and hands the screen what it needs. Writing a row is the screen calling the existing actions.

import { householdCards } from "@/lib/data/lookups";
import { failure } from "@/lib/errors";
import { parseStatement, type StatementLine } from "@/lib/bank-reconcile/model";
import { parseUnbanked, type UnbankedRow } from "@/lib/bank-reconcile/unbanked";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import type { CrmSession } from "@/lib/session";

export type ReconcileModel =
  | {
      state: "ok";
      lines: StatementLine[];
      /** Household cards of every family named in the preview, by household id. */
      families: Record<string, Family>;
      /** For a "conflict" candidate: whether the row it points to is a waiting proof or a recorded payment. */
      refKinds: Record<string, "proof" | "payment">;
      /** The preview stopped at this many lines. */
      limit: number;
      problems: string[];
    }
  | { state: "no_access" }
  | { state: "error"; error: string };

export const RECONCILE_LIMIT = 300;

export async function loadReconcile(session: CrmSession, accountId: string | null): Promise<ReconcileModel> {
  const { db, center } = session;
  const r = await db.rpc("reconcile_statement", { p_center: center.id, ...(accountId ? { p_account: accountId } : {}), p_limit: RECONCILE_LIMIT });
  if (r.error) {
    if (r.error.code === "42501") return { state: "no_access" };
    return { state: "error", error: failure("Could not read the reconciliation preview", r.error).error };
  }
  const lines = parseStatement(r.data);
  if (!lines) {
    console.error("[giving-reconcile] reconcile_statement returned an unexpected shape:", r.data);
    return { state: "error", error: "Could not read the reconciliation preview — the database answered in a shape this screen does not understand (has the latest migration been applied?)." };
  }
  const problems: string[] = [];
  const householdIds = [...new Set(lines.flatMap((l) => l.candidates.map((c) => c.householdId)))];
  const conflictRefs = [...new Set(lines.flatMap((l) => l.candidates.filter((c) => c.kind === "conflict" && c.refId).map((c) => c.refId as string)))];
  const [cards, proofs, payments] = await Promise.all([
    householdCards(db, householdIds),
    conflictRefs.length > 0 ? db.from("payment_proofs").select("id").in("id", conflictRefs) : Promise.resolve(null),
    conflictRefs.length > 0 ? db.from("payments").select("id").in("id", conflictRefs) : Promise.resolve(null),
  ]);
  if (cards.error) problems.push(failure("Could not read some of the families' details; those rows show the name the database gave", cards.error).error);
  const families: Record<string, Family> = {};
  for (const [id, card] of cards.map) families[id] = familyFrom(card);
  const refKinds: Record<string, "proof" | "payment"> = {};
  if (proofs?.error) problems.push(failure("Could not tell which amount conflicts are payment confirmations", proofs.error).error);
  for (const p of proofs?.data ?? []) refKinds[p.id] = "proof";
  if (payments?.error) problems.push(failure("Could not tell which amount conflicts are payments", payments.error).error);
  for (const p of payments?.data ?? []) refKinds[p.id] ??= "payment";
  return { state: "ok", lines, families, refKinds, limit: RECONCILE_LIMIT, problems };
}

export type UnbankedModel =
  | { state: "ok"; rows: UnbankedRow[]; families: Record<string, Family>; problems: string[] }
  | { state: "no_access" }
  | { state: "error"; error: string };

export async function loadUnbanked(session: CrmSession): Promise<UnbankedModel> {
  const { db, center } = session;
  const r = await db.rpc("unbanked_payments_report", { p_center: center.id });
  if (r.error) {
    if (r.error.code === "42501") return { state: "no_access" };
    return { state: "error", error: failure("Could not read the payments not yet on the bank", r.error).error };
  }
  const rows = parseUnbanked(r.data);
  if (!rows) {
    console.error("[giving-reconcile] unbanked_payments_report returned an unexpected shape:", r.data);
    return { state: "error", error: "Could not read the payments not yet on the bank — the database answered in a shape this screen does not understand (has the latest migration been applied?)." };
  }
  const problems: string[] = [];
  const cards = await householdCards(db, rows.map((x) => x.householdId));
  if (cards.error) problems.push(failure("Could not read some of the families' details; those rows show the name the database gave", cards.error).error);
  const families: Record<string, Family> = {};
  for (const [id, card] of cards.map) families[id] = familyFrom(card);
  return { state: "ok", rows, families, problems };
}

/** How many payments are counted as paid but not on the bank, and how many are past their usual window (app.unbanked_counts). null when unreadable. */
export async function unbankedCount(session: CrmSession): Promise<{ total: number; pastWindow: number } | null> {
  const r = await session.db.rpc("unbanked_counts", { p_center: session.center.id });
  if (r.error) {
    console.error("[giving-reconcile] unbanked_counts failed:", r.error);
    return null;
  }
  const o = r.data as { total?: unknown; past_window?: unknown } | null;
  return { total: Number(o?.total) || 0, pastWindow: Number(o?.past_window) || 0 };
}
