import type { Metadata } from "next";
import Link from "next/link";

import { Alert, BlockGrid, buttonClass, Card, EmptyState, InfoBox, Pagination, QueryError, StatusText, TableWrap } from "@/components/ui";
import { addDays, formatDateTime, formatMonth, todayInTz } from "@/lib/dates";
import { isModuleEnabled } from "@/lib/modules";
import {
  groupUnanswered,
  nivaBodyPreview,
  nivaConversationView,
  nivaHealthView,
  nivaOutcomeLabel,
  nivaOutcomeStatus,
  nivaSourceStatus,
  nivaSourceTotals,
  NIVA_GROUP_RETRY_MAX,
  sourceCountsLine,
  splitIntoGroups,
  summarizeSourceGroups,
  type NivaSourceLite,
  type SourceGroup,
  type UnansweredRow,
} from "@/lib/niva";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import { approveNivaContentAction } from "../../setup/approval-actions";
import { ApprovalCard } from "../../setup/_components/approval-card";
import { parseApprovalStatus } from "@/lib/setup";
import { ContentItemButton } from "../item-form";
import { NivaHealthAlert, NivaUsageLine } from "./health-alert";
import { ImportPagesForm, SendImportedDraftsForm } from "./import-form";
import { RegenerateNivaAnswerButton } from "./regenerate-button";
import { RetryAllUnansweredButton, RetryQuestionGroupButton } from "./retry-buttons";
import { RetireNivaSourceButton, SendPageForApprovalButton } from "./source-buttons";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Niva" };

const GUARDRAILS: [string, string][] = [
  ["Doctrinal questions", "Answer from approved content, then refer to Pathshala teachers"],
  ["Personal member data", "None — Niva cannot look up any member’s account, eligibility, RSVPs or payments."],
  ["When unsure", "Say so and offer Ask a question"],
  ["Conversation logs", "Kept 30 days · never used to train models"],
];

/** Sources shown per page of the Knowledge sources list (grouped by imported page). */
const SOURCES_PAGE_SIZE = 100;
/** The counts behind the groups read every source, 1,000 rows at a time (the API's row cap), up to this many. */
const SOURCE_INDEX_CHUNK = 1000;
const SOURCE_INDEX_MAX = 10_000;

type ImportRow = { job_id: number; url: string; status: string; attempts: number; last_error: string | null; result: unknown; created_at: string; finished_at: string | null };

/** One line, in plain English, for an import job: what it did, or why it could not. */
function importOutcome(r: ImportRow): { tone: "ok" | "warn" | "bad"; label: string; detail: string } {
  if (r.status === "done") {
    const x = (r.result ?? {}) as Record<string, unknown>;
    const n = Number(x.sections ?? 0);
    const kept = Number(x.kept_as_approved ?? 0);
    const parts = [`${n} section${n === 1 ? "" : "s"} read`, `${Number(x.created ?? 0)} new draft${Number(x.created ?? 0) === 1 ? "" : "s"}`];
    if (Number(x.updated ?? 0) > 0) parts.push(`${Number(x.updated)} draft${Number(x.updated) === 1 ? "" : "s"} refreshed`);
    if (kept > 0) parts.push(`${kept} already approved, left as approved`);
    if (x.truncated === true) parts.push("page was long, only the first part was kept");
    return { tone: "ok", label: "Done", detail: parts.join(" · ") };
  }
  if (r.status === "failed") return { tone: "bad", label: "Could not import", detail: r.last_error || "The page could not be read." };
  if (r.status === "running") return { tone: "warn", label: "Reading…", detail: "" };
  if (r.attempts > 0 && r.last_error) return { tone: "warn", label: "Will try again", detail: r.last_error };
  return { tone: "warn", label: "Waiting", detail: "Queued; pages are read a few seconds apart." };
}

/**
 * Every Niva source this center sees (its own and the shared ones), without their text: enough to
 * count each imported page's sections by status. Read in chunks so the 1,000-row cap never cuts the
 * counts short.
 */
async function loadSourceIndex(db: CrmSession["db"], centerId: string): Promise<{ rows: NivaSourceLite[]; error: unknown; capped: boolean }> {
  const rows: NivaSourceLite[] = [];
  for (let from = 0; from < SOURCE_INDEX_MAX; from += SOURCE_INDEX_CHUNK) {
    const r = await db
      .from("content_items")
      .select("id, center_id, status, metadata")
      .eq("kind", "niva_source")
      .or(`center_id.eq.${centerId},center_id.is.null`)
      .order("id")
      .range(from, from + SOURCE_INDEX_CHUNK - 1);
    if (r.error) return { rows, error: r.error, capped: false };
    const got = r.data ?? [];
    rows.push(...got);
    if (got.length < SOURCE_INDEX_CHUNK) return { rows, error: null, capped: false };
  }
  return { rows, error: null, capped: true };
}

function groupTitle(g: SourceGroup | undefined, key: string): string {
  if (key === "shared") return "Shared with every community";
  if (key === "hand") return "Written here";
  return g?.pageTitle || (key.startsWith("url:") ? key.slice(4) : key);
}

export default async function NivaPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const session = await getSession();
  const { db, center } = session;
  const short = center.short_name || center.name;
  const sub = `${short} Niva answers only from approved sources for this center and always shows the source`;
  const gate = contentGate(session, sub);
  if (gate) return gate;
  const canDraft = canAccess(session, "contentDraft");
  const canManage = canAccess(session, "contentManage");
  // The Niva module (Settings › Modules) decides whether members see Niva; the old
  // centers.feature_flags.niva is no longer read by the member app.
  const enabled = isModuleEnabled(session, "niva");
  const weekAgo = addDays(todayInTz(center.time_zone), -7);
  const showRetired = param(sp, "retired") === "1";
  const sourcesPage = pageParam(sp, "sources_page");

  // Readiness check 12: an administrator approves Niva's sources (or Niva is switched off).
  const showApproval = enabled && (canManage || canAccess(session, "setup"));
  let detailQuery = db
    .from("content_items")
    .select("id, center_id, kind, title, body_md, media_url, media_path, metadata, status, updated_at")
    .eq("kind", "niva_source")
    .or(`center_id.eq.${center.id},center_id.is.null`);
  if (!showRetired) detailQuery = detailQuery.neq("status", "retired");
  const [index, sources, unanswered, recent, approval, imports, health] = await Promise.all([
    loadSourceIndex(db, center.id),
    // One page of sources, in group order: shared first, then those written here, then each imported page.
    detailQuery
      .order("center_id", { ascending: true, nullsFirst: true })
      .order("metadata->>source_url", { ascending: true, nullsFirst: true })
      .order("metadata->section", { ascending: true })
      .order("title")
      .order("id")
      .range((sourcesPage - 1) * SOURCES_PAGE_SIZE, sourcesPage * SOURCES_PAGE_SIZE - 1),
    // No answer yet (waiting, no source, unsure, declined, paused or failed): what "Try again" is for.
    canManage
      ? db
          .from("niva_conversations")
          .select("id, question, answer_status, outcome_detail, created_at")
          .eq("center_id", center.id)
          .is("answer", null)
          .gte("created_at", weekAgo)
          .order("created_at", { ascending: false })
          .limit(1000)
      : null,
    // The most recent 30, so staff can see what Niva is actually saying, why a question has no
    // answer, and try it again (or regenerate a stale answer) once a source is edited or approved.
    canManage
      ? db
          .from("niva_conversations")
          .select("id, question, answer, sources, unanswered, answer_status, outcome_detail, created_at")
          .eq("center_id", center.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : null,
    showApproval ? db.rpc("golive_approval_status", { p_center: center.id }) : null,
    canDraft ? db.rpc("niva_import_status", { p_center: center.id, p_limit: 15 }) : null,
    // Owner-approved 2026-10-01: content staff see whether Niva can answer (0572).
    enabled && canDraft ? db.rpc("niva_health", { p_center: center.id }) : null,
  ]);
  if (approval?.error) console.error("[content/niva] could not load the go-live approval:", approval.error);
  if (health?.error) console.error("[content/niva] could not load Niva's health:", health.error);
  const approvals = approval && !approval.error ? parseApprovalStatus(approval.data) : null;
  const healthView = health && !health.error ? nivaHealthView(health.data) : null;

  const totals = nivaSourceTotals(index.rows);
  const groups = summarizeSourceGroups(index.rows);
  const visibleTotal = index.error ? null : showRetired ? totals.total : totals.total - totals.retired;
  const pageRows = sources.data ?? [];
  const pageGroups = splitIntoGroups(pageRows);
  const sourcesHref = (overrides: Record<string, string | number | undefined>) => hrefWith("/content/niva", sp, overrides);

  const questions = groupUnanswered((unanswered?.data ?? []) as UnansweredRow[], 25);
  const recentRows = recent?.data ?? [];

  return (
    <>
      <ContentHeader sub={sub} />
      <div className="mb-4 flex flex-col gap-3">
        {health?.error ? <QueryError what="how Niva is doing" error={health.error} retryHref="/content/niva" /> : null}
        {healthView ? <NivaHealthAlert view={healthView} canRetry={canManage} /> : null}
        <Alert tone="info" title="Niva answers from your approved sources only">
          A member&apos;s question is checked against the sources marked &ldquo;Included&rdquo; below; when one clearly answers it, Niva replies
          with that source cited. When none does, or Niva isn&apos;t confident, the question is saved as unanswered and the member is told
          honestly that it&apos;s still being looked into — never a guess. Doctrinal questions are always referred on to Pathshala teachers as
          well. Added or approved a source? Press Try again on the unanswered questions below; edited one? Regenerate the answers that cite it.
        </Alert>
        {healthView?.usage ? <NivaUsageLine usage={healthView.usage} /> : null}
      </div>
      <BlockGrid>
        <Card
          title="Knowledge sources"
          description={
            index.error
              ? undefined
              : `${totals.included} included in Niva · ${totals.waiting} awaiting approval · ${totals.draft} draft${totals.draft === 1 ? "" : "s"}${totals.retired > 0 ? ` · ${totals.retired} retired` : ""}`
          }
          span={12}
          padded={false}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {totals.retired > 0 ? (
                <Link href={sourcesHref({ retired: showRetired ? undefined : "1", sources_page: undefined })} className={buttonClass("plain", "sm")}>
                  {showRetired ? "Hide retired" : `Show retired (${totals.retired})`}
                </Link>
              ) : null}
              {canDraft && totals.importedDrafts > 0 ? <SendImportedDraftsForm count={totals.importedDrafts} /> : null}
              {canDraft ? <ContentItemButton kind="niva_source" kindLabel="Niva source" meta={[]} label="Add source" bodyLabel="The text Niva answers from" showMedia={false} /> : null}
            </div>
          }
        >
          {index.error || sources.error ? (
            <div className="p-4">
              <QueryError what="Niva's sources" error={index.error || sources.error} retryHref="/content/niva" />
            </div>
          ) : totals.total === 0 ? (
            <EmptyState title="No sources yet">Add the calendar, guide, membership rules and Gyan Path content Niva may answer from. Each source is approved before Niva uses it.</EmptyState>
          ) : pageRows.length === 0 ? (
            <EmptyState title={visibleTotal === 0 ? "Every source is retired" : "No sources on this page"}>
              {visibleTotal === 0 ? (
                <Link href={sourcesHref({ retired: "1", sources_page: undefined })} className="text-navy underline">
                  Show the retired sources
                </Link>
              ) : (
                <Link href={sourcesHref({ sources_page: undefined })} className="text-navy underline">
                  Back to the first page
                </Link>
              )}
            </EmptyState>
          ) : (
            <div className="flex flex-col">
              {index.capped ? (
                <p className="px-2.5 py-2 text-[12px] text-muted">
                  There are more than {SOURCE_INDEX_MAX.toLocaleString("en-US")} sources; the counts cover the first {SOURCE_INDEX_MAX.toLocaleString("en-US")}.
                </p>
              ) : null}
              {pageGroups.map((pg) => {
                const g = groups.get(pg.key);
                const visibleInGroup = g ? (showRetired ? g.counts.total : g.counts.total - g.counts.retired) : pg.rows.length;
                const drafts = g?.kind === "page" ? g.importedDrafts : 0;
                return (
                  <details key={`${pg.key}:${pg.rows[0]?.id}`} open={pg.key === "hand" || pageGroups.length === 1} className="border-t border-line-soft first:border-t-0">
                    <summary className="cursor-pointer px-2.5 py-2.5">
                      <span className="font-bold">{groupTitle(g, pg.key)}</span>
                      {g?.url ? <span className="block break-all text-[12px] text-muted">Imported from {g.url}</span> : null}
                      <span className="block text-[12px] text-muted">
                        {g ? sourceCountsLine(g.counts) : `${pg.rows.length} sections`}
                        {pg.rows.length < visibleInGroup ? ` · ${pg.rows.length} of ${visibleInGroup} on this page, the rest on the next or previous page` : ""}
                      </span>
                    </summary>
                    {canDraft && drafts > 0 && g?.url ? (
                      <div className="px-2.5 pb-2">
                        <SendPageForApprovalButton sourceUrl={g.url} drafts={drafts} />
                      </div>
                    ) : null}
                    <TableWrap>
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>Section</th>
                            <th>What Niva reads (the start)</th>
                            <th>Updated</th>
                            <th>Status</th>
                            {canDraft ? <th /> : null}
                          </tr>
                        </thead>
                        <tbody>
                          {pg.rows.map((s) => {
                            const m = (s.metadata ?? {}) as Record<string, unknown>;
                            const st = nivaSourceStatus(s.status);
                            const preview = nivaBodyPreview(s.body_md, 200);
                            return (
                              <tr key={s.id}>
                                <td className="max-w-[260px] font-bold">{s.title}</td>
                                <td className="max-w-[420px] text-[12px] text-muted">{preview || "No text yet — Niva has nothing to answer from here."}</td>
                                <td className="whitespace-nowrap">{formatMonth(s.updated_at.slice(0, 7) + "-01")}</td>
                                <td>
                                  <StatusText tone={st.tone}>{st.label}</StatusText>
                                </td>
                                {canDraft ? (
                                  <td className="whitespace-nowrap text-right">
                                    {s.center_id ? (
                                      <div className="flex flex-wrap items-start justify-end gap-2">
                                        <ContentItemButton
                                          kind="niva_source"
                                          kindLabel="Niva source"
                                          meta={[]}
                                          label="Edit"
                                          variant="ghost"
                                          size="xs"
                                          bodyLabel="The text Niva answers from"
                                          showMedia={false}
                                          item={{ ...s, metadata: m }}
                                        />
                                        {canManage && s.status !== "retired" ? <RetireNivaSourceButton id={s.id} title={s.title} /> : null}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted">Shared</span>
                                    )}
                                  </td>
                                ) : null}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableWrap>
                  </details>
                );
              })}
              {visibleTotal === null || visibleTotal > SOURCES_PAGE_SIZE || sourcesPage > 1 ? (
                <Pagination page={sourcesPage} pageSize={SOURCES_PAGE_SIZE} total={visibleTotal} hrefFor={(p) => sourcesHref({ sources_page: p > 1 ? p : undefined })} />
              ) : null}
            </div>
          )}
        </Card>
        {canDraft ? (
          <Card
            title="Import from a web page"
            span={7}
            description="Paste public web page addresses. Each page is read, cleaned up and saved as draft sources; nothing reaches members until you approve it."
          >
            <div className="flex flex-col gap-4">
              <ImportPagesForm />
              <p className="text-[13px] text-muted">
                Only public pages are read, and a site&apos;s robots.txt is respected. Pages built entirely by scripts, PDFs and files can&apos;t be read yet; add those by hand with Add source.
                Importing a page again refreshes its drafts and never changes a section that has already been approved.
              </p>
              {imports?.error ? (
                <QueryError what="the recent imports" error={imports.error} retryHref="/content/niva" />
              ) : imports && (imports.data ?? []).length > 0 ? (
                <TableWrap>
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Page</th>
                        <th>Asked</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {((imports.data ?? []) as ImportRow[]).map((r) => {
                        const o = importOutcome(r);
                        return (
                          <tr key={r.job_id}>
                            <td className="max-w-[320px] break-all">{r.url}</td>
                            <td className="whitespace-nowrap">{formatDateTime(r.created_at, center.time_zone)}</td>
                            <td>
                              <StatusText tone={o.tone}>{o.label}</StatusText>
                              {o.detail ? <span className="block text-[12px] text-muted">{o.detail}</span> : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              ) : null}
            </div>
          </Card>
        ) : null}
        <Card title="Guardrails" span={canDraft ? 5 : 12} description="How Niva is built to behave; these are fixed, not settings.">
          <div className="flex flex-col gap-3">
            {GUARDRAILS.map(([label, value]) => (
              <div key={label}>
                <p className="crm-label">{label}</p>
                <InfoBox>{value}</InfoBox>
              </div>
            ))}
          </div>
        </Card>
        {approval?.error ? (
          <div className="col-span-12">
            <QueryError what="the approval of Niva's content" error={approval.error} retryHref="/content/niva" />
          </div>
        ) : approvals ? (
          <ApprovalCard
            testId="approval-niva-content"
            title="Administrator's approval of Niva's content"
            what={`An administrator reads the knowledge sources marked "Included" (${totals.included} published) and approves them for go-live. Editing a source afterwards needs a new approval. Organizations not using Niva switch it off in Settings › Modules instead.`}
            later="Readiness check 12. The full Niva evaluation (a question bank with a pass mark) comes in a later release; this approval covers the sources as they are today."
            state={approvals.niva}
            canApprove={approvals.canApproveNiva}
            whoMayApprove="An administrator (settings.manage) approves Niva's content."
            action={approveNivaContentAction}
            timeZone={center.time_zone}
          />
        ) : null}
        <Card
          title="Unanswered questions this week"
          description="Add or approve a source that answers them, then try them again"
          span={12}
          padded={false}
          actions={canManage && enabled ? <RetryAllUnansweredButton /> : null}
        >
          {!canManage ? (
            <p className="px-4 pb-4 text-[13px] text-muted">Members&apos; questions are visible to content managers (content.manage) only.</p>
          ) : unanswered?.error ? (
            <div className="p-4">
              <QueryError what="the unanswered questions" error={unanswered.error} retryHref="/content/niva" />
            </div>
          ) : questions.length === 0 ? (
            <EmptyState title={enabled ? "No unanswered questions this week" : "No questions — the Niva module is switched off"} />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Why (most recent ask)</th>
                    <th className="num">Asked</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => {
                    const st = nivaOutcomeStatus(q.latest.status);
                    const ids = q.ids.slice(0, NIVA_GROUP_RETRY_MAX);
                    return (
                      <tr key={q.ids[0]}>
                        <td className="max-w-[320px]">{q.text}</td>
                        <td className="max-w-[420px]">
                          <StatusText tone={st.tone}>{st.label}</StatusText>
                          <span className="block text-[12px] text-muted">{nivaOutcomeLabel(q.latest.status, q.latest.detail)}</span>
                        </td>
                        <td className="num">{q.n}</td>
                        <td className="whitespace-nowrap text-right">{enabled ? <RetryQuestionGroupButton ids={ids} /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Recent questions & answers" description="What Niva is actually saying, most recent first" span={12} padded={false}>
          {!canManage ? (
            <p className="px-4 pb-4 text-[13px] text-muted">Members&apos; questions are visible to content managers (content.manage) only.</p>
          ) : recent?.error ? (
            <div className="p-4">
              <QueryError what="Niva's recent questions" error={recent.error} retryHref="/content/niva" />
            </div>
          ) : recentRows.length === 0 ? (
            <EmptyState title={enabled ? "No questions yet" : "No questions — the Niva module is switched off"} />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Answer</th>
                    <th>Sources</th>
                    <th>Status</th>
                    <th>Why</th>
                    <th>Asked</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((r) => {
                    const cited = Array.isArray(r.sources) ? (r.sources as unknown as { title?: string }[]) : [];
                    const citedTitles = cited.map((s) => s.title).filter((t): t is string => Boolean(t));
                    const answered = Boolean(r.answer);
                    const v = nivaConversationView(r);
                    return (
                      <tr key={r.id}>
                        <td className="max-w-[280px]">{r.question}</td>
                        <td className="max-w-[360px] text-muted">{r.answer ?? "—"}</td>
                        <td className="max-w-[200px] text-[12px] text-muted">{citedTitles.length ? citedTitles.join(" · ") : "—"}</td>
                        <td>
                          <StatusText tone={v.status.tone}>{v.status.label}</StatusText>
                        </td>
                        <td className="max-w-[320px] text-[12px] text-muted">{v.why}</td>
                        <td className="whitespace-nowrap">{formatDateTime(r.created_at, center.time_zone)}</td>
                        <td>{enabled ? <RegenerateNivaAnswerButton conversationId={r.id} answered={answered} /> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
