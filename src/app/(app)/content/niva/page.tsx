import type { Metadata } from "next";

import { Alert, BlockGrid, Card, EmptyState, InfoBox, QueryError, StatusText, TableWrap } from "@/components/ui";
import { addDays, formatMonth, todayInTz } from "@/lib/dates";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ContentItemButton } from "../item-form";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Niva" };

const GUARDRAILS: [string, string][] = [
  ["Doctrinal questions", "Answer from approved content, then refer to Pathshala teachers"],
  ["Personal member data", "Only the asking member’s own eligibility and events"],
  ["When unsure", "Say so and offer Ask a question"],
  ["Conversation logs", "Kept 30 days · never used to train models"],
];

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

  const [sources, unanswered] = await Promise.all([
    db
      .from("content_items")
      .select("id, center_id, kind, title, body_md, media_url, media_path, metadata, status, updated_at")
      .eq("kind", "niva_source")
      .or(`center_id.eq.${center.id},center_id.is.null`)
      .order("title"),
    canManage
      ? db.from("niva_conversations").select("question").eq("center_id", center.id).eq("unanswered", true).gte("created_at", weekAgo).limit(2000)
      : null,
  ]);
  const grouped = new Map<string, { text: string; n: number }>();
  for (const u of unanswered?.data ?? []) {
    const k = u.question.trim().toLowerCase().replace(/\s+/g, " ");
    const g = grouped.get(k) ?? { text: u.question.trim(), n: 0 };
    g.n += 1;
    grouped.set(k, g);
  }
  const questions = [...grouped.values()].sort((a, b) => b.n - a.n).slice(0, 25);

  return (
    <>
      <ContentHeader sub={sub} />
      <div className="mb-4">
        <Alert tone="info" title="Niva doesn't answer on its own yet">
          Members can ask Niva in the app. Each question is saved and listed below as unanswered, and the member is told plainly that answers are
          still being set up — the answering model is not connected yet. Add sources now so they are ready.
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
                        <td className="font-bold">{s.title}</td>
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
      </BlockGrid>
    </>
  );
}
