import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, BlockGrid, Card, ChipLinks, EmptyState, KpiGrid, NoAccess, PageHeader, Pagination, QueryError, Stat, StatusText, buttonClass } from "@/components/ui";
import type { Json } from "@/lib/database.types";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { entityDef } from "@/lib/import/registry";
import { ROW_FILTERS, asReconciliation, matchLabel, moneyLabel, rowStateLabel, runStatusLabel, runStatusTone, type PreviewCounts, type RunCounts } from "@/lib/import/runs";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ImportSteps, type ImportStep } from "../steps";
import { CancelButton, CommitButton, DecisionButtons, OpeningBalancesForm, RebuildPreviewButton, ReconcileButton, SignOffForm, UndoButton } from "./run-controls";

export const metadata: Metadata = { title: "Import · Data import · Settings" };

const PAGE = 50;

type Run = {
  id: string;
  run_number: number;
  entity: string;
  entity_label: string;
  source: string;
  file_name: string | null;
  status: string;
  rows_total: number | null;
  counts: { preview?: PreviewCounts; result?: RunCounts } | null;
  reconciliation: Json | null;
  started_by: string | null;
  created_at: string;
  committed_at: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  sign_off_note: string | null;
  undone_at: string | null;
  undone_by: string | null;
  undo_reason: string | null;
  previous_run_number: number | null;
  request_id: string;
  can_undo: boolean;
  undo_until: string | null;
};

function stepFor(status: string): ImportStep {
  if (status === "pending" || status === "staged") return "Check";
  if (status === "previewed") return "Preview";
  if (status === "committing") return "Import";
  return "Reconcile";
}

function summaryOf(data: Json): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return Object.entries(data)
    .filter(([k]) => !k.endsWith("_id") || k === "household_id")
    .map(([k, v]) => {
      const raw = v && typeof v === "object" && !Array.isArray(v) && "value" in v ? String((v as { value: unknown }).value) : String(v);
      const shown = raw.replace(/^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/, "$1");
      return `${k.replace(/_cents$/, "").replace(/_/g, " ")}: ${k.endsWith("_cents") && typeof v === "number" ? formatCents(v) : shown}`;
    })
    .slice(0, 5)
    .join(" · ");
}

export default async function ImportRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const { id } = await params;
  const sp = await searchParams;
  const header = <PageHeader title="Settings" description="Data import · one run" />;
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Data import" access="dataImport" />
      </>
    );
  }
  if (!isUuid(id)) notFound();
  const tz = session.center.time_zone;
  const got = await session.db.rpc("import_run_get", { p_run: id });
  if (got.error) {
    return (
      <>
        {header}
        <QueryError what="this import" error={got.error} retryHref={`/settings/import/${id}`} />
      </>
    );
  }
  const run = got.data as unknown as Run;
  const entity = entityDef(run.entity);
  const view = param(sp, "view") ?? "all";
  const page = Math.max(1, Number(param(sp, "page") ?? "1") || 1);

  let q = session.db
    .from("import_rows")
    .select("row_no, source_key, data, custom, problems, action, decision, match, status, target_id, message", { count: "exact" })
    .eq("run_id", id)
    .order("row_no")
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (["create", "update", "skip", "needs_decision", "error"].includes(view)) q = q.eq("status", "staged").eq("action", view);
  else if (["created", "updated", "failed", "skipped"].includes(view)) q = q.eq("status", view);
  const rows = await q;
  const names = await userNames(session.db, session.center.id, [run.started_by, run.signed_off_by, run.undone_by]);
  const preview = run.counts?.preview;
  const result = run.counts?.result;
  const rec = asReconciliation(run.reconciliation);
  const step = stepFor(run.status);
  const canUndo = run.can_undo;
  const decisionsOpen = run.status === "previewed" || run.status === "committing";
  // A pledges import: what was paid before the imported payment history (owner decision 2026-09-25 #24).
  let opening: { rows: { opening_cents: number }[]; done: number } | null = null;
  let openingError: string | null = null;
  if (run.entity === "pledges" && (run.status === "committed" || run.status === "reconciled")) {
    const plan = await session.db.rpc("import_opening_balance_plan", { p_run: id });
    if (plan.error) {
      console.error("[import] opening balance plan failed:", plan.error);
      openingError = `${explainError(plan.error)}.`;
    } else {
      const all = ((plan.data as { rows?: { opening_cents: number; already: boolean }[] } | null)?.rows ?? []);
      opening = { rows: all.filter((r) => !r.already && r.opening_cents > 0), done: all.filter((r) => r.already).length };
    }
  }

  return (
    <>
      {header}
      <p className="mb-2 text-[13px]">
        <Link href="/settings/import" className="crm-link">
          ← Data import
        </Link>
      </p>
      <ImportSteps current={step} done={run.status === "reconciled" ? ["Reconcile"] : []} />
      <BlockGrid>
        <Card
          span={12}
          title={`Import #${run.run_number} · ${run.entity_label}`}
          description={`${run.file_name ?? "file"} · from ${run.source}${run.previous_run_number ? ` · top-up of #${run.previous_run_number}` : ""} · started ${formatDateTime(run.created_at, tz)} by ${
            names.get(run.started_by ?? "")?.name ?? "—"
          }`}
          actions={
            <>
              <StatusText tone={runStatusTone(run.status, run.reconciliation)}>{runStatusLabel(run.status)}</StatusText>
              <a className={buttonClass("ghost", "sm")} href={`/settings/import/${id}/problems`}>
                Download problem rows
              </a>
            </>
          }
        >
          {entity?.note ? <p className="mb-2 text-[13px] text-muted">{entity.note}</p> : null}
          <p className="text-[12px] text-muted">
            Every change this import makes is audited as “Import #{run.run_number} · {run.file_name}” (request {run.request_id.slice(0, 8)}) —{" "}
            <Link className="crm-link" href={`/settings/audit?app=import&reason=${encodeURIComponent(`Import #${run.run_number} ·`)}`}>
              see the audit log
            </Link>
            .
          </p>

          {run.status === "pending" || run.status === "staged" ? (
            <div className="mt-3 space-y-2">
              <Alert tone="info">This import stopped before its preview. Build the preview, or cancel it and start again.</Alert>
              <div className="flex gap-2">
                <RebuildPreviewButton runId={id} />
                <CancelButton runId={id} />
              </div>
            </div>
          ) : null}

          {preview && (run.status === "previewed" || run.status === "committing") ? (
            <div className="mt-3 space-y-3">
              <KpiGrid cols={5}>
                <Stat label="Will be added" value={preview.create} tone="success" />
                <Stat label="Will update" value={preview.update} tone="navy" />
                <Stat label="No change" value={preview.skip} tone="ink" />
                <Stat label="Needs a decision" value={preview.needs_decision} tone={preview.needs_decision ? "brown" : "ink"} />
                <Stat label="Errors (left out)" value={preview.error} tone={preview.error ? "danger" : "ink"} />
              </KpiGrid>
              {preview.needs_decision ? (
                <Alert tone="warning">
                  {preview.needs_decision} row{preview.needs_decision === 1 ? "" : "s"} need a decision (see “Needs a decision” below). A name-only look-alike is added and sent to merge
                  review unless you skip it; a row that matches several records is skipped unless you add it.
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-start gap-3">
                <CommitButton
                  runId={id}
                  total={preview.total}
                  label={run.status === "committing" ? "Continue the import" : `Import ${(preview.create + preview.update + preview.skip + preview.needs_decision).toLocaleString()} rows`}
                />
                {run.status === "previewed" ? (
                  <>
                    <RebuildPreviewButton runId={id} />
                    <CancelButton runId={id} />
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {result && ["committed", "reconciled", "undone"].includes(run.status) ? (
            <div className="mt-3">
              <KpiGrid cols={5}>
                <Stat label="Added" value={result.created} tone="success" />
                <Stat label="Updated" value={result.updated} tone="navy" />
                <Stat label="No change" value={result.unchanged} tone="ink" />
                <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "brown" : "ink"} />
                <Stat label="Failed" value={result.failed} tone={result.failed ? "danger" : "ink"} />
              </KpiGrid>
            </div>
          ) : null}
        </Card>

        {run.status === "committed" || run.status === "reconciled" ? (
          <Card span={12} title="Reconcile" description="Row counts and money totals compared with the file. The person who owns this data signs it off.">
            {rec ? (
              <div className="space-y-3">
                <p className="text-[13px]">
                  {rec.ok ? (
                    <StatusText tone="ok">Everything matches the file</StatusText>
                  ) : (
                    <StatusText tone="bad">Some numbers differ from the file</StatusText>
                  )}{" "}
                  · {rec.counts.file_rows} rows in the file: {rec.counts.created} added, {rec.counts.updated} updated, {rec.counts.unchanged} unchanged, {rec.counts.skipped} skipped,{" "}
                  {rec.counts.failed} failed · compared {formatDateTime(rec.computed_at, tz)}
                </p>
                {rec.money.length > 0 ? (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th scope="col">Total</th>
                        <th scope="col">In the file</th>
                        <th scope="col">Imported</th>
                        <th scope="col">Match</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.money.map((m) => (
                        <tr key={m.column}>
                          <td>{moneyLabel(m.column)}</td>
                          <td>{formatCents(m.file_cents, session.center.currency)}</td>
                          <td>{formatCents(m.db_cents, session.center.currency)}</td>
                          <td>{m.ok ? <StatusText tone="ok">Yes</StatusText> : <StatusText tone="bad">Differs</StatusText>}</td>
                        </tr>
                      ))}
                      {rec.by_year.map((y) => (
                        <tr key={y.year}>
                          <td>Paid in {y.year}</td>
                          <td>{formatCents(y.file_cents, session.center.currency)}</td>
                          <td>{formatCents(y.db_cents, session.center.currency)}</td>
                          <td>{y.ok ? <StatusText tone="ok">Yes</StatusText> : <StatusText tone="bad">Differs</StatusText>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {rec.paid_mismatches.length > 0 ? (
                  <Alert tone="warning">
                    {rec.paid_mismatches.length} pledge{rec.paid_mismatches.length === 1 ? "'s" : "s'"} paid-so-far differ from the imported allocations (e.g. {rec.paid_mismatches[0].pledge}:{" "}
                    file {formatCents(rec.paid_mismatches[0].file_cents)}, here {formatCents(rec.paid_mismatches[0].db_cents)}). Import the matching payments, or explain it in the
                    sign-off note.
                  </Alert>
                ) : null}
                {opening && opening.rows.length > 0 ? (
                  <OpeningBalancesForm
                    runId={id}
                    count={opening.rows.length}
                    total={formatCents(opening.rows.reduce((t, r) => t + r.opening_cents, 0), session.center.currency)}
                  />
                ) : opening && opening.done > 0 ? (
                  <p className="text-[13px] text-muted">
                    Opening balances are in: {opening.done} pledge{opening.done === 1 ? "" : "s"} carr{opening.done === 1 ? "ies" : "y"} one historical opening-balance line.
                  </p>
                ) : null}
                {openingError ? <Alert tone="warning">Could not check for opening balances — {openingError}</Alert> : null}
                <ReconcileButton runId={id} again />
                {run.status === "committed" ? (
                  <SignOffForm runId={id} needsNote={!rec.ok} />
                ) : (
                  <p className="text-[13px]">
                    Signed off {formatDateTime(run.signed_off_at, tz)} by {names.get(run.signed_off_by ?? "")?.name ?? "—"}
                    {run.sign_off_note ? ` · “${run.sign_off_note}”` : ""}.
                  </p>
                )}
              </div>
            ) : (
              <ReconcileButton runId={id} again={false} />
            )}
            {canUndo && run.undo_until ? (
              <div className="mt-4 border-t border-line-soft pt-3">
                <UndoButton runId={id} runNumber={run.run_number} until={formatDateTime(run.undo_until, tz)} />
              </div>
            ) : null}
          </Card>
        ) : null}

        {run.status === "undone" ? (
          <Card span={12} title="Undone">
            <p className="text-[13px]">
              Undone {formatDateTime(run.undone_at, tz)} by {names.get(run.undone_by ?? "")?.name ?? "—"}: “{run.undo_reason}”.
            </p>
          </Card>
        ) : null}

        <Card span={12} title="Rows" description="Every row of the file, with what happened to it." padded={false}>
          <div className="px-2 pt-1">
            <ChipLinks label="Show" items={ROW_FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/settings/import/${id}?view=${f.key}` }))} active={view} />
          </div>
          {rows.error ? (
            <div className="p-2">
              <QueryError what="the rows" error={rows.error} retryHref={`/settings/import/${id}`} />
            </div>
          ) : (rows.data ?? []).length === 0 ? (
            <EmptyState title="No rows here" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">ID</th>
                      <th scope="col">Values</th>
                      <th scope="col">What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(rows.data ?? []).map((r) => {
                      const probs = (Array.isArray(r.problems) ? r.problems : []) as { level: string; message: string }[];
                      const m = matchLabel(r.match);
                      return (
                        <tr key={r.row_no}>
                          <td className="font-mono">{r.row_no}</td>
                          <td className="font-mono text-[12px]">{r.source_key.startsWith("row:") ? "—" : r.source_key}</td>
                          <td className="max-w-[420px] text-[12px]">
                            {summaryOf(r.data)}
                            {r.custom && typeof r.custom === "object" && Object.keys(r.custom).length ? (
                              <span className="block text-muted">Custom: {Object.entries(r.custom as Record<string, unknown>).map(([k, v]) => `${k} ${String(v)}`).join(" · ")}</span>
                            ) : null}
                          </td>
                          <td className="text-[13px]">
                            <strong>{rowStateLabel(r.status, r.action)}</strong>
                            {m ? <span className="block text-[12px] text-muted">{m}</span> : null}
                            {r.message ? <span className="block text-[12px]">{r.message}</span> : null}
                            {probs.map((p, j) => (
                              <span key={j} className={`block text-[12px] ${p.level === "error" ? "text-danger" : "text-brown"}`}>
                                {p.level === "error" ? "Error" : "Warning"}: {p.message}
                              </span>
                            ))}
                            {decisionsOpen && r.status === "staged" && r.action === "needs_decision" ? (
                              <DecisionButtons runId={id} rowNo={r.row_no} decision={r.decision} />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE} total={rows.count ?? null} hrefFor={(p) => `/settings/import/${id}?view=${view}&page=${p}`} />
            </>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
