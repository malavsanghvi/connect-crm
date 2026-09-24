import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { documentKindLabel, ENTITY_TYPES, VERIFICATION_LABEL } from "@/lib/setup";

import { IrsResult, type IrsLookup } from "../../setup/organization/irs-result";
import { PlatformNoAccess } from "../platform-no-access";
import { decideVerificationAction } from "./actions";
import { ReviewButton } from "./review-button";

export const metadata: Metadata = { title: "Verification · Platform" };

export default async function VerificationPage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Non-profit verification · the documents next to the IRS record · verify or send back with a note" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const queue = await db.rpc("org_verification_queue");
  if (queue.error) {
    return (
      <>
        {header}
        <QueryError what="the verification queue" error={queue.error} retryHref="/platform/verification" />
      </>
    );
  }
  const rows = queue.data ?? [];
  const ids = rows.map((r) => r.center_id);
  const docsRes = ids.length
    ? await db.from("org_documents").select("id, center_id, kind, storage_path, file_name, uploaded_at, note").in("center_id", ids).order("uploaded_at", { ascending: false })
    : null;
  if (docsRes?.error) console.error("[platform/verification] could not load the documents:", docsRes.error);
  const docs = docsRes?.data ?? [];
  const signed = docs.length ? await db.storage.from("org-documents").createSignedUrls(docs.map((d) => d.storage_path), 600) : null;
  if (signed?.error) console.error("[platform/verification] could not make document links:", signed.error);
  const links = new Map((signed?.data ?? []).map((s) => [s.path, s.signedUrl ?? null]));
  const tz = session.center.time_zone;

  return (
    <>
      {header}
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No organizations have started their legal identity yet" />
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Verification queue">
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Legal name · EIN</th>
                  <th>Status</th>
                  <th>IRS</th>
                  <th className="num">Documents</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = docs.filter((d) => d.center_id === r.center_id);
                  const irs = (r.irs ?? null) as IrsLookup | null;
                  return (
                    <tr key={r.center_id} data-center={r.center_slug} data-status={r.verification_status}>
                      <td className="font-bold">
                        {r.center_name}
                        <p className="font-mono text-[11px] font-normal text-muted">{r.center_slug}</p>
                      </td>
                      <td>
                        {r.legal_name ?? "—"}
                        <p className="font-mono text-[12px] text-muted">{r.ein ?? "no EIN"}</p>
                      </td>
                      <td>
                        {r.verification_status === "verified" ? (
                          <StatusText tone="ok">{VERIFICATION_LABEL.verified}</StatusText>
                        ) : r.verification_status === "submitted" ? (
                          <StatusText tone="warn">Waiting for review</StatusText>
                        ) : r.verification_status === "rejected" ? (
                          <StatusText tone="bad">Sent back</StatusText>
                        ) : (
                          <span className="font-semibold text-muted">Not submitted</span>
                        )}
                        {r.submitted_at ? <p className="text-[11px] text-muted">Submitted {formatDateTime(r.submitted_at, tz)}</p> : null}
                      </td>
                      <td>{!irs ? "—" : irs.ok ? <StatusText tone="ok">Match</StatusText> : irs.found ? <StatusText tone="bad">Check</StatusText> : <StatusText tone="warn">Not found</StatusText>}</td>
                      <td className="num">{r.documents}</td>
                      <td className="text-right">
                        <ReviewButton label={r.verification_status === "submitted" ? "Review" : "Open"} variant={r.verification_status === "submitted" ? "primary" : "ghost"} title={r.center_name} subtitle={VERIFICATION_LABEL[r.verification_status] ?? r.verification_status}>
                            <div className="flex flex-col gap-4 text-[13px]">
                              <section>
                                <p className="crm-label">Legal identity</p>
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                  <dt className="text-muted">Legal name</dt>
                                  <dd>{r.legal_name ?? "—"}</dd>
                                  {r.dba ? (
                                    <>
                                      <dt className="text-muted">Doing business as</dt>
                                      <dd>{r.dba}</dd>
                                    </>
                                  ) : null}
                                  <dt className="text-muted">EIN</dt>
                                  <dd className="font-mono">{r.ein ?? "—"}</dd>
                                  <dt className="text-muted">Entity type</dt>
                                  <dd>{ENTITY_TYPES.find((e) => e.value === r.entity_type)?.label ?? "—"}</dd>
                                  <dt className="text-muted">Incorporated in</dt>
                                  <dd>{r.incorporation_state ?? "—"}</dd>
                                </dl>
                                {r.verification_note ? <p className="mt-2 text-muted">Last note: {r.verification_note}</p> : null}
                              </section>
                              <section>
                                <p className="crm-label">IRS lookup</p>
                                <IrsResult result={irs} />
                              </section>
                              <section>
                                <p className="crm-label">Documents</p>
                                {mine.length === 0 ? (
                                  <p className="text-muted">No documents uploaded.</p>
                                ) : (
                                  <ul className="flex flex-col gap-1">
                                    {mine.map((d) => (
                                      <li key={d.id}>
                                        <strong>{documentKindLabel(d.kind)}</strong> ·{" "}
                                        {links.get(d.storage_path) ? (
                                          <a href={links.get(d.storage_path) ?? undefined} target="_blank" rel="noreferrer" className="crm-link">
                                            {d.file_name ?? "View"}
                                          </a>
                                        ) : (
                                          <span title="No view link could be made">{d.file_name ?? "File"}</span>
                                        )}{" "}
                                        <span className="text-[12px] text-muted">{formatDateTime(d.uploaded_at, tz)}</span>
                                        {d.note ? <span className="text-[12px] text-muted"> · {d.note}</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {docsRes?.error || signed?.error ? <p className="mt-1 text-danger">Some documents or links could not be loaded. Reload to try again.</p> : null}
                              </section>
                              {r.verification_status === "submitted" || r.verification_status === "verified" ? (
                                <ActionForm action={decideVerificationAction} submitLabel={r.verification_status === "verified" ? "Withdraw verification" : "Send back"} variant="warn" hideSubmit={false} extraButtons={r.verification_status === "submitted" ? (
                                  <button type="submit" name="decision" value="verify" className="cc-btn cc-btn-ok" data-variant="ok" data-confirm={`Verify ${r.legal_name} as a non-profit?\nIt is recorded with your name, and the organization's readiness check passes.`}>
                                    Verify non-profit
                                  </button>
                                ) : null}>
                                  <input type="hidden" name="center" value={r.center_id} />
                                  <label className="crm-label" htmlFor={`note-${r.center_id}`}>
                                    Note (required to send back)
                                  </label>
                                  <textarea id={`note-${r.center_id}`} name="note" className="crm-input mb-3 min-h-[70px]" maxLength={1000} placeholder="e.g. The W-9 is not signed." />
                                </ActionForm>
                              ) : (
                                <p className="text-muted">{VERIFICATION_LABEL[r.verification_status] ?? r.verification_status}: nothing to decide until the organization submits.</p>
                              )}
                            </div>
                        </ReviewButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
