import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Alert, BlockGrid, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { DOCUMENT_KINDS, documentKindLabel, ENTITY_TYPES, VERIFICATION_LABEL, verificationBlockers } from "@/lib/setup";

import { saveLegalIdentityAction, submitVerificationAction, uploadOrgDocumentAction } from "../actions";
import { SetupHeader, setupGate } from "../_components/setup-ui";
import { IrsResult, type IrsLookup } from "./irs-result";

export const metadata: Metadata = { title: "Legal identity · Setup" };

const SUB = "Step 0.2 · legal identity and non-profit proof · Community Connect verifies it before production";

function str(o: unknown, k: string): string {
  const v = isPlainObject(o) ? o[k] : undefined;
  return typeof v === "string" ? v : "";
}

function Input({ name, label, value, hint, ...rest }: { name: string; label: string; value?: string | null; hint?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value">) {
  return (
    <div>
      <label className="crm-label" htmlFor={`f-${name}`}>
        {label}
      </label>
      <input id={`f-${name}`} name={name} className="crm-input" defaultValue={value ?? ""} {...rest} />
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}

export default async function OrganizationPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Legal identity");
  if (gate) return gate;
  const { db, center } = session;

  const [profileRes, docsRes] = await Promise.all([
    db
      .from("org_profiles")
      .select("legal_name, dba, ein, entity_type, incorporation_state, registered_address, authorized_signer_name, authorized_signer_title, sales_tax_id, verification_status, verification_note, verified_at, submitted_at")
      .eq("center_id", center.id)
      .maybeSingle(),
    db.from("org_documents").select("id, kind, storage_path, file_name, size_bytes, uploaded_by, uploaded_at, note").eq("center_id", center.id).order("uploaded_at", { ascending: false }),
  ]);
  if (profileRes.error || docsRes.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the legal identity" error={profileRes.error ?? docsRes.error} retryHref="/setup/organization" />
      </>
    );
  }
  const p = profileRes.data;
  const docs = docsRes.data ?? [];
  const [irsRes, names, signed] = await Promise.all([
    p?.ein ? db.rpc("irs_lookup", { p_ein: p.ein, p_name: p.legal_name ?? undefined }) : null,
    userNames(db, center.id, docs.map((d) => d.uploaded_by)),
    docs.length ? db.storage.from("org-documents").createSignedUrls(docs.map((d) => d.storage_path), 300) : null,
  ]);
  if (irsRes?.error) console.error("[setup] IRS lookup failed:", irsRes.error);
  if (signed?.error) console.error("[setup] could not make view links for the documents:", signed.error);
  const links = new Map((signed?.data ?? []).map((s) => [s.path, s.signedUrl]));
  const status = p?.verification_status ?? "unverified";
  const kinds = [...new Set(docs.map((d) => d.kind))];
  const blockers = verificationBlockers(p ?? null, kinds);
  const locked = status === "submitted" || status === "verified";
  const addr = p?.registered_address;

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <div className="mb-4">
        {status === "verified" ? (
          <Alert tone="success" title="Verified non-profit">
            Community Connect verified {p?.legal_name} on {formatDateTime(p?.verified_at, center.time_zone)}. Changing the legal name, EIN or entity type sends it back for
            verification.
          </Alert>
        ) : status === "submitted" ? (
          <Alert tone="info" title="Waiting for Community Connect review">
            Submitted {formatDateTime(p?.submitted_at, center.time_zone)}. Community Connect compares the documents with the IRS record.
          </Alert>
        ) : status === "rejected" ? (
          <Alert tone="warning" title="Sent back by Community Connect">
            {p?.verification_note ?? "See the note from Community Connect."} Fix it, then submit again.
          </Alert>
        ) : p?.verification_note ? (
          <Alert tone="warning" title="Not verified">
            {p.verification_note}
          </Alert>
        ) : null}
      </div>
      <BlockGrid>
        <Card span={7} title="Legal identity" description="Exactly as on the IRS letter · the signer is printed on statements">
          <ActionForm action={saveLegalIdentityAction} submitLabel="Save legal identity" pendingLabel="Saving…" buttonsClassName="mt-4">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Input name="legal_name" label="Legal name" value={p?.legal_name} required maxLength={200} />
              <Input name="dba" label="Doing business as (optional)" value={p?.dba} maxLength={200} />
              <Input name="ein" label="EIN" value={p?.ein} required placeholder="12-3456789" inputMode="numeric" hint="Nine digits, from the IRS letter or the W-9." />
              <div>
                <label className="crm-label" htmlFor="f-entity_type">
                  Entity type
                </label>
                <select id="f-entity_type" name="entity_type" className="crm-input" defaultValue={p?.entity_type ?? ""} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {ENTITY_TYPES.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </div>
              <Input name="incorporation_state" label="State of incorporation" value={p?.incorporation_state} maxLength={2} placeholder="TX" className="crm-input w-24 uppercase" />
              <Input name="sales_tax_id" label="Sales-tax registration (optional)" value={p?.sales_tax_id} maxLength={60} hint="Only if the store sells taxable items." />
              <p className="crm-label sm:col-span-2">Registered address</p>
              <Input name="address_line1" label="Street" value={str(addr, "line1")} />
              <Input name="address_line2" label="Suite or unit (optional)" value={str(addr, "line2")} />
              <Input name="address_city" label="City" value={str(addr, "city")} />
              <div className="grid grid-cols-2 gap-3">
                <Input name="address_state" label="State" value={str(addr, "state")} maxLength={2} className="crm-input uppercase" />
                <Input name="address_postal_code" label="ZIP" value={str(addr, "postal_code")} maxLength={10} />
              </div>
              <Input name="authorized_signer_name" label="Authorized signer" value={p?.authorized_signer_name} maxLength={120} />
              <Input name="authorized_signer_title" label="Signer's title" value={p?.authorized_signer_title} maxLength={120} placeholder="President" />
            </div>
          </ActionForm>
        </Card>

        <Card span={5} title="IRS lookup" description="Tax Exempt Organization Search bulk data (Pub. 78 and the EO Business Master File)">
          {!p?.ein ? (
            <EmptyState title="Save the EIN to check it against the IRS list." />
          ) : irsRes?.error ? (
            <QueryError what="the IRS lookup" error={irsRes.error} retryHref="/setup/organization" />
          ) : (
            <IrsResult result={(irsRes?.data ?? null) as IrsLookup | null} />
          )}
        </Card>

        <Card span={7} title="Non-profit documents" description="Kept in private storage · only the owner, settings managers and Community Connect verification staff can open them" padded={false}>
          {docs.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No documents yet">Upload a signed W-9 and the IRS determination letter (or proof of a group exemption).</EmptyState>
            </div>
          ) : (
            <TableWrap>
              <table className="crm-table" aria-label="Non-profit documents">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>File</th>
                    <th>Uploaded</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => {
                    const superseded = docs.findIndex((x) => x.kind === d.kind) !== i;
                    const url = links.get(d.storage_path);
                    return (
                      <tr key={d.id} data-kind={d.kind}>
                        <td className="font-bold">
                          {documentKindLabel(d.kind)}
                          {superseded ? <span className="ml-1.5 text-[12px] font-semibold text-faint">earlier version</span> : null}
                        </td>
                        <td>
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="crm-link">
                              {d.file_name ?? "View"}
                            </a>
                          ) : (
                            <span title="A view link could not be made; reload to try again">{d.file_name ?? "File"}</span>
                          )}
                        </td>
                        <td className="text-[12px]">
                          {formatDateTime(d.uploaded_at, center.time_zone)}
                          <br />
                          <span className="text-muted">{d.uploaded_by ? (names.get(d.uploaded_by)?.name ?? "A former user") : "—"}</span>
                        </td>
                        <td className="text-[12px]">{d.note ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {signed?.error ? (
            <p className="px-4 pb-2 text-[12px] text-danger">Could not make view links for the documents. Reload to try again.</p>
          ) : null}
          <div className="border-t border-line-soft px-4 pb-4 pt-3">
            <ActionForm action={uploadOrgDocumentAction} submitLabel="Upload document" pendingLabel="Uploading…" resetOnSuccess buttonsClassName="mt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="crm-label" htmlFor="doc-kind">
                    What it is
                  </label>
                  <select id="doc-kind" name="kind" className="crm-input" defaultValue="w9">
                    {DOCUMENT_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="crm-label" htmlFor="doc-file">
                    File
                  </label>
                  <input id="doc-file" name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="crm-input" required />
                  <p className="crm-hint">PDF, PNG or JPEG, up to 10 MB.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="crm-label" htmlFor="doc-note">
                    Note (optional)
                  </label>
                  <input id="doc-note" name="note" className="crm-input" maxLength={1000} placeholder="e.g. Signed by the treasurer" />
                </div>
              </div>
            </ActionForm>
          </div>
        </Card>

        <Card span={5} title="Submit for verification" description="Required for production, not for the sandbox">
          <p className="mb-2 text-[13px]">
            Status: <strong>{VERIFICATION_LABEL[status] ?? status}</strong>
          </p>
          {locked ? (
            <p className="text-[13px] text-muted">{status === "verified" ? "Nothing to do here." : "Community Connect is reviewing it."}</p>
          ) : blockers.length > 0 ? (
            <>
              <p className="text-[13px]">Before submitting, add:</p>
              <ul className="ml-5 mt-1 list-disc text-[13px]">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="crm-hint mt-2">Houses of worship without an IRS letter can send a board or attorney letter instead; Community Connect reviews it.</p>
            </>
          ) : (
            <>
              <p className="mb-2 text-[13px]">
                <StatusText tone="ok">Ready to submit</StatusText> — the legal identity and documents are complete.
              </p>
              <ActionForm
                action={submitVerificationAction}
                submitLabel="Submit for verification"
                pendingLabel="Submitting…"
                confirmMessage={`Submit ${p?.legal_name ?? "the organization"} for verification?\nCommunity Connect reviews the documents next to the IRS record. You can keep setting up meanwhile.`}
              />
            </>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
