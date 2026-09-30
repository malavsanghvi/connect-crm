import type { Metadata } from "next";

import { Alert, BlockGrid, Card, EmptyState, InfoBox, QueryError, StatusText, TableWrap } from "@/components/ui";
import { addDays, formatDateTime, formatMonth, todayInTz } from "@/lib/dates";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { approveNivaContentAction } from "../../setup/approval-actions";
import { ApprovalCard } from "../../setup/_components/approval-card";
import { parseApprovalStatus } from "@/lib/setup";
import { ContentItemButton } from "../item-form";
import { ImportPagesForm } from "./import-form";
import { RegenerateNivaAnswerButton } from "./regenerate-button";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Niva" };

const GUARDRAILS: [string, string][] = [
  ["Doctrinal questions", "Answer from approved content, then refer to Pathshala teachers"],
  ["Personal member data", "Only the asking member’s own eligibility and events"],
  ["When unsure", "Say so and offer Ask a question"],
  ["Conversation logs", "Kept 30 days · never used to train models"],
];

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

export default async function NivaPage() {
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

  // Readiness check 12: an administrator approves Niva's sources (or Niva is switched off).
  const showApproval = enabled && (canManage || canAccess(session, "setup"));
  const [sources, unanswered, recent, approval, imports] = await Promise.all([
    db
      .from("content_items")
      .select("id, center_id, kind, title, body_md, media_url, media_path, metadata, status, updated_at")
      .eq("kind", "niva_source")
      .or(`center_id.eq.${center.id},center_id.is.null`)
      .order("title"),
    canManage
      ? db.from("niva_conversations").select("question").eq("center_id", center.id).eq("unanswered", true).gte("created_at", weekAgo).limit(2000)
      : null,
    // Answered by the worker (or still pending it): the most recent 30, so staff can see what Niva is
    // actually saying and, once a source is edited or freshly approved, regenerate a stale answer.
    canManage ? db.from("niva_conversations").select("id, question, answer, sources, unanswered, created_at").eq("center_id", center.id).order("created_at", { ascending: false }).limit(30) : null,
    showApproval ? db.rpc("golive_approval_status", { p_center: center.id }) : null,
    canDraft ? db.rpc("niva_import_status", { p_center: center.id, p_limit: 15 }) : null,
  ]);
  if (approval?.error) console.error("[content/niva] could not load the go-live approval:", approval.error);
  const approvals = approval && !approval.error ? parseApprovalStatus(approval.data) : null;
  const published = (sources.data ?? []).filter((x) => x.status === "published").length;
  const grouped = new Map<string, { text: string; n: number }>();
  for (const u of unanswered?.data ?? []) {
    const k = u.question.trim().toLowerCase().replace(/\s+/g, " ");
    const g = grouped.get(k) ?? { text: u.question.trim(), n: 0 };
    g.n += 1;
    grouped.set(k, g);
  }
  const questions = [...grouped.values()].sort((a, b) => b.n - a.n).slice(0, 25);
  const recentRows = recent?.data ?? [];

  return (
    <>
      <ContentHeader sub={sub} />
      <div className="mb-4">
        <Alert tone="info" title="Niva answers from your approved sources only">
          A member&apos;s question is checked against the sources marked &ldquo;Included&rdquo; below; when one clearly answers it, Niva replies
          with that source cited. When none does, or Niva isn&apos;t confident, the question is saved as unanswered and the member is told
          honestly that it&apos;s still being looked into — never a guess. Doctrinal questions are always referred on to Pathshala teachers as
          well. Editing a source? Regenerate the affected answers below.
        </Alert>
      </div>
      <BlockGrid>
        <Card
          title="Knowledge sources"
          span={7}
          padded={false}
          actions={canDraft ? <ContentItemButton kind="niva_source" kindLabel="Niva source" meta={["items_count"]} label="Add source" bodyLabel="What this source covers" showMedia={false} /> : null}
        >
          {sources.error ? (
            <div className="p-4">
              <QueryError what="Niva's sources" error={sources.error} retryHref="/content/niva" />
            </div>
          ) : (sources.data ?? []).length === 0 ? (
            <EmptyState title="No sources yet">Add the calendar, guide, membership rules and Gyan Path content Niva may answer from. Each source is approved before Niva uses it.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="num">Items</th>
                    <th>Updated</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(sources.data ?? []).map((s) => {
                    const m = (s.metadata ?? {}) as Record<string, unknown>;
                    return (
                      <tr key={s.id}>
                        <td>
                          <span className="font-bold">{s.title}</span>
                          {typeof m.source_url === "string" ? <span className="block text-[12px] font-normal text-muted">Imported from {m.source_url}</span> : null}
                        </td>
                        <td className="num">{typeof m.items_count === "number" ? m.items_count : "—"}</td>
                        <td>{formatMonth(s.updated_at.slice(0, 7) + "-01")}</td>
                        <td>{s.status === "published" ? <StatusText tone="ok">Included</StatusText> : <StatusText tone="warn">Not included yet</StatusText>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Guardrails" span={5} description="How Niva is built to behave; these are fixed, not settings.">
          <div className="flex flex-col gap-3">
            {GUARDRAILS.map(([label, value]) => (
              <div key={label}>
                <p className="crm-label">{label}</p>
                <InfoBox>{value}</InfoBox>
              </div>
            ))}
          </div>
        </Card>
        {canDraft ? (
          <Card
            title="Import from a web page"
            span={12}
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
        {approval?.error ? (
          <div className="col-span-12">
            <QueryError what="the approval of Niva's content" error={approval.error} retryHref="/content/niva" />
          </div>
        ) : approvals ? (
          <ApprovalCard
            testId="approval-niva-content"
            title="Administrator's approval of Niva's content"
            what={`An administrator reads the knowledge sources marked "Included" (${published} published) and approves them for go-live. Editing a source afterwards needs a new approval. Organizations not using Niva switch it off in Settings › Modules instead.`}
            later="Readiness check 12. The full Niva evaluation (a question bank with a pass mark) comes in a later release; this approval covers the sources as they are today."
            state={approvals.niva}
            canApprove={approvals.canApproveNiva}
            whoMayApprove="An administrator (settings.manage) approves Niva's content."
            action={approveNivaContentAction}
            timeZone={center.time_zone}
          />
        ) : null}
        <Card title="Unanswered questions this week" description="Add content to answer these" span={12} padded={false}>
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
                    <th className="num">Asked</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <tr key={q.text}>
                      <td>{q.text}</td>
                      <td className="num">{q.n}</td>
                    </tr>
                  ))}
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
                    <th>Asked</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((r) => {
                    const cited = Array.isArray(r.sources) ? (r.sources as unknown as { title?: string }[]) : [];
                    const citedTitles = cited.map((s) => s.title).filter((t): t is string => Boolean(t));
                    return (
                      <tr key={r.id}>
                        <td className="max-w-[280px]">{r.question}</td>
                        <td className="max-w-[360px] text-muted">{r.answer ?? "—"}</td>
                        <td className="max-w-[200px] text-[12px] text-muted">{citedTitles.length ? citedTitles.join(" · ") : "—"}</td>
                        <td>{r.unanswered ? <StatusText tone="warn">Unanswered</StatusText> : <StatusText tone="ok">Answered</StatusText>}</td>
                        <td className="whitespace-nowrap">{formatDateTime(r.created_at, center.time_zone)}</td>
                        <td>{r.answer ? <RegenerateNivaAnswerButton conversationId={r.id} /> : null}</td>
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
