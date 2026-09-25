import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Alert, BlockGrid, Card, NoAccess, PageHeader, QueryError, StatusText } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { AGREEMENT_LABEL, agreementState, type AgreementKind } from "@/lib/security";
import { getSession } from "@/lib/session";

import { acceptAgreementAction } from "./actions";

export const metadata: Metadata = { title: "Agreements · Settings" };

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The document text: paragraphs, with **bold** shown as bold. */
function Body({ md }: { md: string }) {
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
      {md.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {para.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>,
          )}
        </p>
      ))}
    </div>
  );
}

const STATE_TEXT = {
  accepted: { tone: "ok", label: "Accepted" },
  needs_acceptance: { tone: "warn", label: "Waiting for the owner" },
  new_version: { tone: "warn", label: "New version to accept" },
  not_published: { tone: "bad", label: "Not published yet" },
  not_required: { tone: "ok", label: "Not needed here" },
} as const;

/** Settings › Agreements: Community Connect's agreements with the organization (stream o-security). */
export default async function AgreementsPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="The agreements between your organization and Community Connect, accepted by the owner" />;
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Agreements" access="centerSettings" />
      </>
    );
  }
  const { db, center, userId } = session;
  const [status, docs, owner, check] = await Promise.all([
    db.rpc("org_agreement_status", { p_center: center.id }),
    db
      .from("legal_documents")
      .select("id, kind, version, title, body_md, published_at")
      .is("center_id", null)
      .in("kind", ["org_terms", "dpa", "children_addendum", "sandbox_terms", "order_form"]),
    db.from("center_owners").select("user_id").eq("center_id", center.id).maybeSingle(),
    db.rpc("check_agreements_accepted", { p_center: center.id }),
  ]);
  if (status.error) {
    return (
      <>
        {header}
        <QueryError what="the agreements" error={status.error} retryHref="/settings/agreements" />
      </>
    );
  }
  const byId = new Map((docs.data ?? []).map((d) => [d.id, d]));
  const isOwner = owner.data?.user_id === userId;
  const readiness = (check.data ?? null) as { ok?: boolean; detail?: string } | null;
  const drafts = session.isPlatformAdmin ? (docs.data ?? []).filter((d) => !d.published_at) : [];

  return (
    <>
      {header}
      <div className="mb-4 flex flex-col gap-3">
        {readiness ? (
          <Alert tone={readiness.ok ? "success" : "warning"} title={`Go-live check · agreements accepted: ${readiness.ok ? "passes" : "not met"}`}>
            {readiness.detail}
          </Alert>
        ) : check.error ? (
          <Alert tone="danger" title="Could not run the go-live check">
            {check.error.message}
          </Alert>
        ) : null}
        {!isOwner ? (
          <Alert tone="info">
            {owner.data ? "Only the organization's owner can accept these agreements. You can read them here." : "No owner is designated yet (Settings › Team)."}
          </Alert>
        ) : null}
      </div>
      <BlockGrid>
        {(status.data ?? []).map((row) => {
          const st = agreementState(row);
          const doc = row.document_id ? byId.get(row.document_id) : undefined;
          const title = row.title || AGREEMENT_LABEL[row.kind as AgreementKind] || row.kind;
          return (
            <Card
              key={row.kind}
              span={6}
              title={title}
              description={row.version ? `Version ${row.version}${row.required ? "" : " · not required for this organization"}` : undefined}
              actions={
                <StatusText tone={STATE_TEXT[st].tone}>
                  {isOwner && (st === "needs_acceptance" || st === "new_version") ? "Needs your acceptance" : STATE_TEXT[st].label}
                </StatusText>
              }
            >
              <div className="flex flex-col gap-3" data-testid={`agreement-${row.kind}`}>
                {row.accepted_at ? (
                  <p className="text-[13px] text-muted">
                    Version {row.accepted_version} accepted by {row.accepted_by_name ?? "the owner"} on {day(row.accepted_at)}.
                  </p>
                ) : null}
                {st === "not_published" ? (
                  <p className="text-[13px] text-muted">Community Connect has not published this agreement yet. It can be accepted once it is.</p>
                ) : null}
                {doc?.published_at ? (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold text-navy">Read the agreement</summary>
                    <div className="mt-2 max-h-72 overflow-y-auto rounded-[10px] bg-canvas p-3">
                      <Body md={doc.body_md} />
                    </div>
                  </details>
                ) : null}
                {isOwner && row.document_id && (st === "needs_acceptance" || st === "new_version") ? (
                  <ActionForm action={acceptAgreementAction} submitLabel={`Accept ${title}`} pendingLabel="Accepting…" className="flex flex-col gap-2">
                    <input type="hidden" name="document_id" value={row.document_id} />
                    <input type="hidden" name="title" value={title} />
                    <label className="flex items-start gap-2 text-[13px]">
                      <input type="checkbox" name="confirm" className="mt-0.5" />
                      <span>
                        I have read {title} (version {row.version}) and accept it on behalf of {center.name}.
                      </span>
                    </label>
                  </ActionForm>
                ) : null}
              </div>
            </Card>
          );
        })}
        {session.isPlatformAdmin ? (
          <Card span={12} title="Community Connect team" description="Only platform admins see this.">
            <p className="text-[13px] text-ink-2">
              {drafts.length > 0 ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting to be published. ` : ""}Edit the texts and publish new versions on{" "}
              <Link href="/platform/agreements" className="crm-link font-semibold">
                Platform › Agreements
              </Link>
              .
            </p>
          </Card>
        ) : null}
      </BlockGrid>
    </>
  );
}
