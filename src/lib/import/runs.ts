// Plain words for an import run's status, counts and reconciliation. Pure.

import type { Json } from "@/lib/database.types";

export type RunCounts = { created: number; updated: number; unchanged: number; skipped: number; failed: number; total: number };
export type PreviewCounts = { create: number; update: number; skip: number; needs_decision: number; error: number; total: number };

export type MoneyLine = { column: string; file_cents: number; db_cents: number; ok: boolean };
export type YearLine = { year: string; file_cents: number; db_cents: number; ok: boolean };
export type Reconciliation = {
  counts: { file_rows: number; created: number; updated: number; unchanged: number; skipped: number; failed: number };
  money: MoneyLine[];
  by_year: YearLine[];
  paid_mismatches: { row: number; pledge: string | null; file_cents: number; db_cents: number }[];
  ok: boolean;
  computed_at: string;
};

const LABELS: Record<string, string> = {
  pending: "Mapping",
  staged: "Checked",
  previewed: "Ready to import",
  committing: "Importing",
  committed: "Imported · reconcile it",
  reconciled: "Reconciled and signed off",
  undone: "Undone",
  cancelled: "Cancelled",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  rolled_back: "Rolled back",
};

export function runStatusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function runStatusTone(status: string, reconciliation?: Json | null): "ok" | "warn" | "bad" {
  if (status === "reconciled") return "ok";
  if (status === "failed") return "bad";
  if (status === "committed") {
    const ok = reconciliation && typeof reconciliation === "object" && !Array.isArray(reconciliation) ? (reconciliation as { ok?: boolean }).ok : undefined;
    return ok === false ? "bad" : "warn";
  }
  return "warn";
}

export function asReconciliation(v: Json | null | undefined): Reconciliation | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as unknown as Partial<Reconciliation>;
  if (!r.counts || !Array.isArray(r.money)) return null;
  return { by_year: [], paid_mismatches: [], ok: false, computed_at: "", ...r } as Reconciliation;
}

const MONEY_LABELS: Record<string, string> = {
  amount_cents: "Total amount",
  paid_so_far: "Total paid so far",
  allocations: "Total applied to pledges",
  goal_cents: "Total goal",
  price_cents: "Total of prices",
};

export function moneyLabel(column: string): string {
  return MONEY_LABELS[column] ?? column.replace(/_cents$/, "").replace(/_/g, " ");
}

/** Row statuses as the run page filters them. */
export const ROW_FILTERS = [
  { key: "all", label: "All rows" },
  { key: "create", label: "Will be added" },
  { key: "update", label: "Will update" },
  { key: "skip", label: "No change" },
  { key: "needs_decision", label: "Needs a decision" },
  { key: "error", label: "Errors" },
  { key: "created", label: "Added" },
  { key: "updated", label: "Updated" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
] as const;

const ROW_STATUS: Record<string, string> = {
  staged: "Waiting",
  created: "Added",
  updated: "Updated",
  unchanged: "No change",
  skipped: "Skipped",
  failed: "Failed",
  undone: "Removed by undo",
};
const ROW_ACTION: Record<string, string> = {
  create: "Will be added",
  update: "Will update",
  skip: "No change",
  needs_decision: "Needs a decision",
  error: "Error",
};

export function rowStateLabel(status: string, action: string | null): string {
  if (status === "staged") return action ? (ROW_ACTION[action] ?? action) : "Waiting";
  return ROW_STATUS[status] ?? status;
}

/** How a staged row met an existing record, in words. */
export function matchLabel(match: Json | null): string | null {
  if (!match || typeof match !== "object" || Array.isArray(match)) return null;
  const m = match as Record<string, Json>;
  const by = typeof m.by === "string" ? m.by.replace(/_/g, " ").replace(/\+/g, " and ") : "";
  if (m.id) return `Matches an existing record by ${by}`;
  if (m.same_file_row) return `Same record as row ${String(m.same_file_row)} of this file (by ${by})`;
  if (Array.isArray(m.ambiguous)) return `Matches ${m.ambiguous.length} existing records by ${by} — choose`;
  if (Array.isArray(m.lookalikes)) return `Only the name matches ${m.lookalikes.length} existing record${m.lookalikes.length === 1 ? "" : "s"}: never merged on a name — added and sent to merge review unless you skip it`;
  return null;
}
