import type { Metadata } from "next";

import { Toggle } from "@/components/controls";
import { DrawerForm } from "@/components/drawer-form";
import { RowActions } from "@/components/row-actions";
import { Card, EmptyState, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { compareVersions, defaultMemberStep, isMemberStep, LEGAL_KIND_LABEL, MEMBER_LEGAL_KINDS, MEMBER_STEP_LABEL, nextVersion, publishEffect, type MemberStep } from "@/lib/content";
import { formatMonth } from "@/lib/dates";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { newLegalVersionAction, publishLegalAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Legal & waivers" };

const SUB = "Policies and notices members accept in the app, consents they answer, and waivers volunteers sign before serving";
const KIND_ORDER: readonly string[] = MEMBER_LEGAL_KINDS;

type Doc = {
  id: string;
  center_id: string | null;
  kind: string;
  version: string;
  title: string;
  body_md: string;
  requires_yearly_resign: boolean;
  published_at: string | null;
  member_step: string;
};

const stepOf = (d: Pick<Doc, "kind" | "member_step">): MemberStep => (isMemberStep(d.member_step) ? d.member_step : defaultMemberStep(d.kind));

function VersionFields({
  id,
  kind,
  title,
  version,
  body,
  yearly,
  step,
}: {
  id?: string;
  kind?: string;
  title?: string;
  version: string;
  body?: string;
  yearly?: boolean;
  step?: MemberStep;
}) {
  const p = `lv-${id ?? kind ?? "new"}`;
  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {kind ? (
        <input type="hidden" name="kind" value={kind} />
      ) : (
        <div>
          <label htmlFor={`${p}-kind`} className="crm-label">
            Document
          </label>
          <select id={`${p}-kind`} name="kind" defaultValue="volunteer_waiver" className="crm-input">
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {LEGAL_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor={`${p}-title`} className="crm-label">
          Title
        </label>
        <input id={`${p}-title`} name="title" required defaultValue={title ?? ""} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-ver`} className="crm-label">
          Version
        </label>
        <input id={`${p}-ver`} name="version" required defaultValue={version} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-body`} className="crm-label">
          Text (Markdown)
        </label>
        <textarea id={`${p}-body`} name="body_md" required rows={12} defaultValue={body ?? ""} className="crm-input font-mono text-[13px]" />
        <p className="crm-hint">Paste the organization&apos;s text (for example from counsel). It is saved as a draft; publish it after review. A published version never changes — edits become a new version.</p>
      </div>
      <div>
        <label htmlFor={`${p}-step`} className="crm-label">
          In the member app
        </label>
        <select id={`${p}-step`} name="member_step" defaultValue={step ?? (kind ? defaultMemberStep(kind) : "")} className="crm-input">
          {!kind ? <option value="">As usual for this kind of document</option> : null}
          {(Object.keys(MEMBER_STEP_LABEL) as MemberStep[]).map((k) => (
            <option key={k} value={k}>
              {MEMBER_STEP_LABEL[k]}
            </option>
          ))}
        </select>
        <p className="crm-hint">Asked in the member&apos;s first-sign-in step, and again whenever a new version is published.</p>
      </div>
      <Toggle name="requires_yearly_resign" label="Re-sign yearly" defaultChecked={yearly ?? false} onNote="Signed again every year" offNote="Signed again only when it changes" />
    </>
  );
}

export default async function LegalPage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const canEdit = canAccess(session, "centerSettings");
  const seesSignatures = can(session, "privacy.manage");

  const docs = await db
    .from("legal_documents")
    .select("id, center_id, kind, version, title, body_md, requires_yearly_resign, published_at, member_step")
    .eq("center_id", center.id)
    .order("created_at", { ascending: false });
  const list = (docs.data ?? []) as Doc[];
  const kinds = [...new Set(list.map((d) => d.kind))].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  const rows = kinds.map((k) => {
    const ofKind = list.filter((d) => d.kind === k).sort((a, b) => compareVersions(b.version, a.version));
    const current = ofKind.find((d) => d.published_at) ?? null;
    const drafts = ofKind.filter((d) => !d.published_at);
    return { kind: k, current, drafts, latest: ofKind[0] };
  });
  const seesCounts = seesSignatures || canEdit;
  const counts = seesCounts && rows.some((r) => r.current) ? await db.rpc("member_legal_acceptance_counts", { p_center: center.id }) : null;
  if (counts?.error) console.error("[content/legal] acceptance counts failed; the column says so:", counts.error);
  const countsBy = new Map((counts?.data ?? []).map((c) => [c.document_id, c]));

  return (
    <>
      <ContentHeader
        sub={SUB}
        actions={
          canEdit ? (
            <DrawerForm label="New document" kicker="Legal & waivers" title="New document" action={newLegalVersionAction} submitLabel="Save draft">
              <VersionFields version="v1" />
            </DrawerForm>
          ) : null
        }
      />
      <Card title="Documents" padded={false} className="mb-4">
        {docs.error ? (
          <div className="p-4">
            <QueryError what="the legal documents" error={docs.error} retryHref="/content/legal" />
          </div>
        ) : null}
        {counts?.error ? <p className="px-4 pt-2 text-[13px] text-danger">Acceptance counts could not be loaded. Reload to try again.</p> : null}
        {rows.length === 0 && !docs.error ? (
          <EmptyState title="No documents yet">Add the privacy policy, terms of use, notices and consents members answer in the app, and the waivers volunteers sign.</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Version</th>
                  <th>Published</th>
                  <th>In the app</th>
                  <th>Answers (current version)</th>
                  <th>Re-sign</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const doc = r.current ?? r.latest;
                  const isWaiver = r.kind === "volunteer_waiver" || r.kind === "pathshala_waiver";
                  return (
                    <tr key={r.kind}>
                      <td className="font-bold">
                        {doc.title}
                        {r.drafts.length > 0 ? (
                          <div className="text-xs font-normal text-brown">
                            Draft {r.drafts.map((d) => d.version).join(", ")} awaiting publish
                          </div>
                        ) : null}
                      </td>
                      <td>{r.current ? r.current.version : "—"}</td>
                      <td>{r.current?.published_at ? formatMonth(r.current.published_at.slice(0, 7) + "-01") : <StatusText tone="warn">Not published</StatusText>}</td>
                      <td className="text-[13px]">{MEMBER_STEP_LABEL[stepOf(doc)]}</td>
                      <td>
                        {!r.current ? (
                          "—"
                        ) : !seesCounts ? (
                          <span className="text-xs text-muted">Needs privacy.manage</span>
                        ) : counts?.error ? (
                          <span className="text-xs text-danger">Could not load</span>
                        ) : (
                          <span data-testid={`legal-count-${r.kind}`}>
                            {(countsBy.get(r.current.id)?.accepted ?? 0).toLocaleString()} {stepOf(r.current) === "consent" ? "yes" : "accepted"}
                            {stepOf(r.current) === "consent" ? ` · ${(countsBy.get(r.current.id)?.declined ?? 0).toLocaleString()} no` : ""}
                          </span>
                        )}
                      </td>
                      <td>{doc.requires_yearly_resign ? "Yearly" : "On change"}</td>
                      <td className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canEdit
                            ? r.drafts.map((d) => (
                                <RowActions
                                  key={d.id}
                                  action={publishLegalAction}
                                  fields={{ id: d.id }}
                                  buttons={[
                                    {
                                      label: `Publish ${d.version}`,
                                      value: "publish",
                                      variant: "primary",
                                      confirm: `Publish ${d.title} ${d.version}? It can no longer be changed after publishing. ${publishEffect(stepOf(d))}`,
                                    },
                                  ]}
                                />
                              ))
                            : null}
                          {canEdit
                            ? r.drafts.map((d) => (
                                <DrawerForm
                                  key={`edit-${d.id}`}
                                  label={`Edit draft ${d.version}`}
                                  variant="ghost"
                                  size="xs"
                                  kicker={LEGAL_KIND_LABEL[r.kind] ?? "Document"}
                                  title={`Edit draft ${d.version}`}
                                  subtitle="Not published yet — members do not see it"
                                  action={newLegalVersionAction}
                                  submitLabel="Save draft"
                                  resetOnSuccess={false}
                                >
                                  <VersionFields id={d.id} kind={r.kind} title={d.title} version={d.version} body={d.body_md} yearly={d.requires_yearly_resign} step={stepOf(d)} />
                                </DrawerForm>
                              ))
                            : null}
                          {isWaiver && r.current ? (
                            <button
                              type="button"
                              disabled
                              title="In-app reminders are not connected yet, so nothing can be sent from here."
                              className={buttonClass("off", "xs")}
                            >
                              {r.kind === "pathshala_waiver" ? "Remind parents" : "Remind unsigned"}
                            </button>
                          ) : null}
                          {canEdit ? (
                            <DrawerForm label="New version" variant="ghost" size="xs" kicker={LEGAL_KIND_LABEL[r.kind] ?? "Document"} title="New version" subtitle="Upload, review, publish" action={newLegalVersionAction} submitLabel="Save draft">
                              <VersionFields kind={r.kind} title={doc.title} version={nextVersion(r.latest.version)} body={doc.body_md} yearly={doc.requires_yearly_resign} step={stepOf(doc)} />
                            </DrawerForm>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        {!canEdit ? <p className="px-4 pb-3 pt-1 text-xs text-muted">New versions and publishing need settings.manage.</p> : null}
        <p className="px-4 pb-3 pt-1 text-xs text-muted">
          Reminders to unsigned volunteers are not available yet — the app has no in-app reminder sender. The buttons stay disabled until one exists.
        </p>
      </Card>
      <Card title="The member app's first sign-in" className="mb-4">
        <p className="text-[13px] text-ink-2">
          When a member first signs in, and again whenever a new version is published, the member app shows the published documents marked
          &ldquo;Must accept&rdquo; (privacy policy, terms of use, notices) and asks the yes-or-no consents (photo consent; children&apos;s photo
          consent for families with children) before they continue. Each answer is recorded with the version, time and device. A published text
          never changes: edit a draft, or start a new version.
        </p>
      </Card>
      <Card title="How waivers work">
        <p className="text-[13px] text-ink-2">
          The center uploads its legal form. Volunteers sign in the member app before any service; the signature, time, version and a copy are stored. Check-in and
          teacher assignment are meant to be blocked until the current version is signed — that block is not enforced by the system yet, so coordinators check
          signatures here.
        </p>
      </Card>
    </>
  );
}
