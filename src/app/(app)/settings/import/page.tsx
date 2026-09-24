import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, buttonClass } from "@/components/ui";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { runStatusLabel, runStatusTone, type RunCounts } from "@/lib/import/runs";
import { ENTITIES, TIER_LABEL, canImportEntity, type Tier } from "@/lib/import/registry";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Data import · Settings" };

const TIERS: Tier[] = ["setup", "records", "history"];
const TIER_NOTE: Record<Tier, string> = {
  setup: "Step 3 · the types, lists and catalogs the modules use. QuickBooks lists are pulled from QuickBooks, never uploaded.",
  records: "Step 4 · the people and things those types describe.",
  history: "Step 5 · what happened. Money history is kept as history and never posts to QuickBooks.",
};

export default async function DataImportPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Data import · load the organization's data in order: setup data, then records, then history. Every import is a numbered run you can reconcile and undo for 30 days."
      actions={
        <Link href="/settings/import/new" className={buttonClass("primary", "sm")}>
          New import
        </Link>
      }
    />
  );
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Data import" access="dataImport" />
      </>
    );
  }
  const runs = await session.db.rpc("import_run_list", { p_center: session.center.id, p_limit: 200 });
  const rows = runs.data ?? [];
  const names = await userNames(session.db, session.center.id, rows.map((r) => r.started_by));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.entity) && r.status !== "cancelled") latest.set(r.entity, r);

  return (
    <>
      {header}
      <BlockGrid>
        <Card
          span={12}
          title="Load order"
          description="Each tier points at the one before it: a pledge needs a household and a campaign; a household member needs a person and a household."
          actions={
            <>
              <Link href="/settings/custom-fields" className={buttonClass("ghost", "sm")}>
                Custom fields
              </Link>
              <Link href="/settings/data-quality" className={buttonClass("ghost", "sm")}>
                Data quality
              </Link>
            </>
          }
          padded={false}
        >
          {TIERS.map((t) => (
            <div key={t} className="px-2 pb-3">
              <p className="px-2.5 pt-2 text-[13px] font-bold">{TIER_LABEL[t]}</p>
              <p className="px-2.5 text-[12px] text-muted">{TIER_NOTE[t]}</p>
              <div className="overflow-x-auto">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th scope="col">Data</th>
                      <th scope="col">Last import</th>
                      <th scope="col">Template</th>
                      <th scope="col">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...ENTITIES]
                      .filter((e) => e.tier === t)
                      .sort((a, b) => a.order - b.order)
                      .map((e) => {
                        const may = canImportEntity(session, e);
                        const off = e.module !== null && session.modulesOff.includes(e.module);
                        const last = latest.get(e.key);
                        return (
                          <tr key={e.key}>
                            <td>
                              <p className="font-semibold">{e.label}</p>
                              <p className="text-[12px] text-muted">{e.description}</p>
                            </td>
                            <td className="whitespace-nowrap">
                              {last ? (
                                <Link className="crm-link" href={`/settings/import/${last.id}`}>
                                  #{last.run_number} · <StatusText tone={runStatusTone(last.status, last.reconciliation)}>{runStatusLabel(last.status)}</StatusText>
                                </Link>
                              ) : (
                                <span className="text-muted">Not loaded</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap text-[13px]">
                              <a className="crm-link" href={`/settings/import/template/${e.key}?format=csv`}>
                                CSV
                              </a>{" "}
                              ·{" "}
                              <a className="crm-link" href={`/settings/import/template/${e.key}?format=xlsx`}>
                                Excel
                              </a>{" "}
                              ·{" "}
                              <a className="crm-link" href={`/settings/import/template/${e.key}?format=dictionary`}>
                                Columns
                              </a>
                            </td>
                            <td className="whitespace-nowrap text-right">
                              {off ? (
                                <span className="text-[12px] text-muted">Module switched off</span>
                              ) : may ? (
                                <Link href={`/settings/import/new?entity=${e.key}`} className={buttonClass("ghost", "xs")}>
                                  Import
                                </Link>
                              ) : (
                                <span className="text-[12px] text-muted">Needs {e.writePerms.join(" or ")}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>

        <Card span={12} title="Import history" description="Open a run to preview, import, reconcile, sign off or undo it." padded={false}>
          {runs.error ? (
            <div className="p-2">
              <QueryError what="the import history" error={runs.error} retryHref="/settings/import" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState title="No imports yet">Start with the setup data: membership types, funds and campaigns.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th scope="col">Run</th>
                    <th scope="col">Data</th>
                    <th scope="col">File</th>
                    <th scope="col">Status</th>
                    <th scope="col">Rows</th>
                    <th scope="col">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = ((r.counts as { result?: RunCounts } | null)?.result ?? null) as RunCounts | null;
                    return (
                      <tr key={r.id}>
                        <td className="font-mono">
                          <Link className="crm-link" href={`/settings/import/${r.id}`}>
                            #{r.run_number}
                          </Link>
                        </td>
                        <td>{r.entity_label}</td>
                        <td>
                          {r.file_name}
                          <span className="block text-[12px] text-muted">
                            {r.source}
                            {r.previous_run_number ? ` · top-up of #${r.previous_run_number}` : ""}
                          </span>
                        </td>
                        <td className="whitespace-nowrap">
                          <StatusText tone={runStatusTone(r.status, r.reconciliation)}>{runStatusLabel(r.status)}</StatusText>
                          {r.can_undo ? <span className="block text-[12px] text-muted">Undo possible</span> : null}
                        </td>
                        <td className="whitespace-nowrap text-[13px]">
                          {c ? `${c.created} added · ${c.updated} updated · ${c.failed} failed` : `${r.rows_total ?? 0} staged`}
                        </td>
                        <td className="whitespace-nowrap text-[13px]">
                          {formatDateTime(r.created_at, session.center.time_zone)}
                          <span className="block text-[12px] text-muted">{names.get(r.started_by)?.name ?? "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
