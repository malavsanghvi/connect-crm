import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { DrawerForm } from "@/components/drawer-form";
import { Alert, Card, PageHeader, QueryError, StatusText } from "@/components/ui";
import { formatDate, todayInTz } from "@/lib/dates";
import { PLATFORM_DOC_KINDS, PLATFORM_DOC_LABEL, PLATFORM_DOC_NOTE, platformDocState, suggestVersion, type PlatformDoc } from "@/lib/legal-platform";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { publishPlatformDraftAction, savePlatformDraftAction } from "./actions";

export const metadata: Metadata = { title: "Agreements · Platform" };

function DraftFields({ id, kind, title, version, body }: { id?: string; kind: string; title: string; version: string; body: string }) {
  const p = `pa-${id ?? kind}`;
  return (
    <>
      {id ? <input type="hidden" name="id" value={id} /> : <input type="hidden" name="kind" value={kind} />}
      <div>
        <label htmlFor={`${p}-title`} className="crm-label">
          Title
        </label>
        <input id={`${p}-title`} name="title" required defaultValue={title} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-version`} className="crm-label">
          Version
        </label>
        <input id={`${p}-version`} name="version" required defaultValue={version} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-body`} className="crm-label">
          Text (Markdown)
        </label>
        <textarea id={`${p}-body`} name="body_md" required rows={14} defaultValue={body} className="crm-input font-mono text-[13px]" />
        <p className="crm-hint">Counsel&apos;s wording. It stays a draft until it is published; a published version never changes.</p>
      </div>
      <div>
        <label htmlFor={`${p}-reason`} className="crm-label">
          Reason (goes in the audit log)
        </label>
        <input id={`${p}-reason`} name="reason" required maxLength={1000} className="crm-input" placeholder="For example: counsel's October revision" />
      </div>
    </>
  );
}

/** Platform › Agreements: Community Connect's texts as versions (#19, owner decision 2026-09-25). */
export default async function PlatformAgreementsPage() {
  const session = await getSession();
  const header = (
    <PageHeader title="Platform" description="Agreements · Community Connect's texts, edited as drafts and published as new versions; owners and members are asked again" />
  );
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const { db, center } = session;
  const res = await db
    .from("legal_documents")
    .select("id, kind, version, title, body_md, published_at, created_at")
    .is("center_id", null)
    .in("kind", [...PLATFORM_DOC_KINDS]);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the platform agreements" error={res.error} retryHref="/platform/agreements" />
      </>
    );
  }
  const docs = (res.data ?? []) as PlatformDoc[];
  const today = todayInTz(center.time_zone);
  const counts = new Map<string, { accepted: number; organizations: number }>();
  for (const kind of PLATFORM_DOC_KINDS.slice(0, 5)) {
    const cur = platformDocState(docs, kind).current;
    if (!cur) continue;
    const c = await db.rpc("platform_agreement_acceptance", { p_document: cur.id });
    if (c.error) console.error(`[platform/agreements] acceptance count for ${kind} failed; shown as unknown:`, c.error);
    else if (c.data?.[0]) counts.set(cur.id, c.data[0]);
  }

  return (
    <>
      {header}
      <div className="mb-4">
        <Alert tone="info" title="How versions work">
          Edit a draft, then publish it. Publishing makes it the current version: each organization&apos;s owner is asked to accept it on Settings › Agreements (the
          go-live check waits for it), and members are asked again in the app for the default privacy policy and terms. Earlier acceptances keep the version that was
          accepted.
        </Alert>
      </div>
      <div className="flex flex-col gap-4">
        {PLATFORM_DOC_KINDS.map((kind) => {
          const { current, draft, history } = platformDocState(docs, kind);
          const label = PLATFORM_DOC_LABEL[kind];
          const count = current ? counts.get(current.id) : undefined;
          const base = draft ?? current;
          return (
            <Card
              key={kind}
              title={label}
              description={PLATFORM_DOC_NOTE[kind]}
              actions={
                <StatusText tone={current ? "ok" : "warn"}>{current ? `Version ${current.version} published ${formatDate(current.published_at, center.time_zone)}` : "Not published"}</StatusText>
              }
            >
              <div className="flex flex-col gap-3" data-testid={`platform-agreement-${kind}`}>
                {current && count ? (
                  <p className="text-[13px] text-muted">
                    Accepted by {count.accepted.toLocaleString()} of {count.organizations.toLocaleString()} organizations.
                  </p>
                ) : null}
                {draft ? (
                  <div className="rounded-[10px] border border-line p-3">
                    <p className="text-[13px] font-bold">
                      Draft · {draft.title} · version {draft.version}
                    </p>
                    <div className="my-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] text-ink-2">{draft.body_md}</div>
                    <div className="flex flex-wrap gap-2">
                      <DrawerForm
                        label="Edit draft"
                        variant="ghost"
                        size="sm"
                        kicker={label}
                        title={`Edit draft ${draft.version}`}
                        subtitle="Not published yet — organizations do not see it"
                        action={savePlatformDraftAction}
                        submitLabel="Save draft"
                        resetOnSuccess={false}
                      >
                        <DraftFields id={draft.id} kind={kind} title={draft.title} version={draft.version} body={draft.body_md} />
                      </DrawerForm>
                      <ActionForm
                        action={publishPlatformDraftAction}
                        submitLabel={`Publish version ${draft.version}`}
                        pendingLabel="Publishing…"
                        size="sm"
                        confirmMessage={`Publish ${draft.title} version ${draft.version}? It can no longer be changed, and every organization's owner is asked to accept it.`}
                      >
                        <input type="hidden" name="id" value={draft.id} />
                        <input type="hidden" name="title" value={`${draft.title} (${draft.version})`} />
                      </ActionForm>
                    </div>
                  </div>
                ) : (
                  <div>
                    <DrawerForm
                      label="New version"
                      variant="ghost"
                      size="sm"
                      kicker={label}
                      title="New version"
                      subtitle="Starts as a draft from the current text"
                      action={savePlatformDraftAction}
                      submitLabel="Save draft"
                    >
                      <DraftFields
                        kind={kind}
                        title={base?.title ?? label}
                        version={suggestVersion(
                          docs.filter((d) => d.kind === kind).map((d) => d.version),
                          today,
                        )}
                        body={base?.body_md ?? ""}
                      />
                    </DrawerForm>
                  </div>
                )}
                {current ? (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold text-navy">Read the current version ({current.version})</summary>
                    <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-[10px] bg-canvas p-3 text-[13px] text-ink-2">{current.body_md}</div>
                  </details>
                ) : null}
                {history.length ? (
                  <p className="text-xs text-muted">
                    Earlier versions: {history.map((h) => `${h.version} (published ${formatDate(h.published_at, center.time_zone)})`).join(" · ")}
                  </p>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
