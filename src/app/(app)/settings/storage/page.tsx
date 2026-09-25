import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Alert, Card, KpiGrid, NoAccess, PageHeader, QueryError, Stat, TableWrap } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { formatBytes, parseStorageOverview, STORAGE_AREAS } from "@/lib/setup";
import { rulesVersion } from "@/lib/settings-rules";

import { saveRetentionAction } from "./actions";

export const metadata: Metadata = { title: "Storage · Settings" };

/**
 * Settings › Storage (Setup step svc.storage, ONBOARDING_PLAN §1.9): the storage areas
 * Community Connect created for the organization, who can read each, their file limits,
 * what this organization uses against its plan, and the two retention choices it owns.
 */
export default async function StoragePage() {
  const session = await getSession();
  const { db, center } = session;
  const header = (
    <PageHeader title="Settings" description={`${center.short_name || center.name} · file storage areas, who can read them, how long files are kept`} />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Storage" access="centerSettings" />
      </>
    );
  }
  const res = await db.rpc("center_storage_overview", { p_center: center.id });
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the storage areas" error={res.error} retryHref="/settings/storage" />
      </>
    );
  }
  const o = parseStorageOverview(res.data);
  const version = rulesVersion(center.rules);
  const pct = o.limitBytes ? Math.min(100, Math.round((o.usedBytes / o.limitBytes) * 100)) : null;

  return (
    <>
      {header}
      {!o.available ? (
        <div className="mb-4">
          <Alert tone="warning" title="File storage is not available on this server">
            The storage service is not set up in this deployment, so uploads (logos, documents, imports) cannot be stored. Community Connect sets it up.
          </Alert>
        </div>
      ) : null}
      <div className="mb-4">
        <KpiGrid cols={3}>
          <Stat label="Used" value={formatBytes(o.usedBytes)} tone="navy" hint={`${o.areas.reduce((n, a) => n + a.files, 0)} files across ${o.areas.length} areas`} />
          <Stat label="Plan limit" value={o.limitBytes ? formatBytes(o.limitBytes) : "No limit"} tone="ink" hint={center.environment === "sandbox" ? "Sandbox limit; lifts at go-live" : "Set by Community Connect"} />
          <Stat label="Of the limit" value={pct === null ? "—" : `${pct}%`} tone={pct !== null && pct >= 90 ? "danger" : "success"} hint="Settings › Limits lists every limit" href="/settings/limits" />
        </KpiGrid>
      </div>
      <Card title="Storage areas" description="Created by Community Connect for every organization; files always sit under your organization's folder" padded={false}>
        <TableWrap>
          <table className="crm-table" aria-label="Storage areas">
            <thead>
              <tr>
                <th>Area</th>
                <th>Holds</th>
                <th>Who can read</th>
                <th>Largest file</th>
                <th className="num">Files</th>
                <th className="num">Used</th>
                <th>Kept for</th>
              </tr>
            </thead>
            <tbody>
              {o.areas.map((a) => {
                const d = STORAGE_AREAS[a.bucket];
                return (
                  <tr key={a.bucket} data-bucket={a.bucket}>
                    <td className="font-bold">
                      {d?.label ?? a.bucket}
                      {!a.module_on ? <p className="text-[12px] font-semibold text-muted">Its module is switched off</p> : null}
                    </td>
                    <td className="text-[13px]">{d?.holds ?? "—"}</td>
                    <td className="text-[13px]">{a.public ? "Anyone (public)" : (d?.readers ?? "Staff with access")}</td>
                    <td className="text-[13px]">{a.max_file_bytes ? formatBytes(a.max_file_bytes) : "—"}</td>
                    <td className="num">{a.files}</td>
                    <td className="num">{formatBytes(a.bytes)}</td>
                    <td className="min-w-[220px] text-[13px]">
                      {a.retention_editable ? (
                        <ActionForm action={saveRetentionAction} submitLabel="Save" size="xs" variant="ghost" className="flex items-center gap-2">
                          <input type="hidden" name="bucket" value={a.bucket} />
                          <input type="hidden" name="version" value={version === null ? "" : String(version)} />
                          <input
                            name="days"
                            defaultValue={a.retention_days ?? 90}
                            inputMode="numeric"
                            className="crm-input w-[80px]"
                            aria-label={`Days to keep ${d?.label ?? a.bucket}`}
                          />
                          <span>days</span>
                        </ActionForm>
                      ) : a.retention_days ? (
                        `${a.retention_days} days`
                      ) : (
                        (d?.kept ?? "Until removed")
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <p className="mt-3 text-[13px] text-muted">
        Uploads are checked for type and size; malware scanning is queued for every upload and runs once a scanning provider is connected. Saving a
        retention choice (keeping the default is fine) marks the <Link href="/setup" className="crm-link">Setup step</Link> “File storage” as reviewed.
      </p>
    </>
  );
}
