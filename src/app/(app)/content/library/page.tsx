import type { Metadata } from "next";

import { Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { contentStatusLabel } from "@/lib/content";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ContentItemButton } from "../item-form";
import { ContentHeader, contentGate } from "../shared";

export const metadata: Metadata = { title: "Content · Library" };

const SUB = "Pachchakhan library and audio lessons shown under Jain Way › Library and Learn";

type Item = {
  id: string;
  center_id: string | null;
  kind: string;
  title: string;
  body_md: string | null;
  media_url: string | null;
  media_path: string | null;
  metadata: unknown;
  status: string;
};

function meta(i: Item): Record<string, unknown> {
  return i.metadata && typeof i.metadata === "object" && !Array.isArray(i.metadata) ? (i.metadata as Record<string, unknown>) : {};
}

function textStatus(i: Item) {
  if (!i.body_md) return <StatusText tone="warn">No text yet</StatusText>;
  if (i.status === "published" || i.status === "approved") return <StatusText tone="ok">Approved</StatusText>;
  return <StatusText tone="warn">{contentStatusLabel(i.status)}</StatusText>;
}

function audioStatus(i: Item) {
  return i.media_path || i.media_url ? <StatusText tone="ok">Recorded</StatusText> : <StatusText tone="warn">To record</StatusText>;
}

export default async function LibraryPage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const canDraft = canAccess(session, "contentDraft");

  const res = await db
    .from("content_items")
    .select("id, center_id, kind, title, body_md, media_url, media_path, metadata, status, created_at")
    .in("kind", ["pachchakhan", "audio_lesson"])
    .or(`center_id.eq.${center.id},center_id.is.null`)
    .neq("status", "retired")
    .order("created_at");
  const all = (res.data ?? []) as Item[];
  const pach = all.filter((i) => i.kind === "pachchakhan");
  const audio = all.filter((i) => i.kind === "audio_lesson");

  const edit = (i: Item, kindLabel: string, fields: ("when" | "series" | "length_minutes")[], bodyLabel: string) =>
    canDraft ? (
      i.center_id ? (
        <ContentItemButton kind={i.kind} kindLabel={kindLabel} meta={fields} label="Edit" variant="ghost" size="xs" bodyLabel={bodyLabel} item={{ ...i, metadata: meta(i) }} />
      ) : (
        <span className="text-xs text-muted">Shared</span>
      )
    ) : null;

  return (
    <>
      <ContentHeader sub={SUB} />
      {res.error ? (
        <div className="mb-4">
          <QueryError what="the library" error={res.error} retryHref="/content/library" />
        </div>
      ) : null}
      <Card
        title="Pachchakhan"
        padded={false}
        className="mb-4"
        actions={canDraft ? <ContentItemButton kind="pachchakhan" kindLabel="Pachchakhan" meta={["when"]} label="Add pachchakhan" bodyLabel="Sutra text" /> : null}
      >
        {pach.length === 0 ? (
          <EmptyState title="No pachchakhan yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Timing rule</th>
                  <th>Sutra text</th>
                  <th>Audio</th>
                  {canDraft ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {pach.map((i) => (
                  <tr key={i.id}>
                    <td className="font-bold">{i.title}</td>
                    <td>{typeof meta(i).when === "string" ? (meta(i).when as string) : "—"}</td>
                    <td>{textStatus(i)}</td>
                    <td>{audioStatus(i)}</td>
                    {canDraft ? <td className="text-right">{edit(i, "Pachchakhan", ["when"], "Sutra text")}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card
        title="Audio lessons"
        padded={false}
        actions={
          canDraft ? <ContentItemButton kind="audio_lesson" kindLabel="Audio lesson" meta={["series", "length_minutes"]} label="Add lesson" bodyLabel="Transcript or notes" /> : null
        }
      >
        {audio.length === 0 ? (
          <EmptyState title="No audio lessons yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Series</th>
                  <th className="num">Length</th>
                  <th>Status</th>
                  {canDraft ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {audio.map((i) => {
                  const m = meta(i);
                  return (
                    <tr key={i.id}>
                      <td className="font-bold">{i.title}</td>
                      <td>{typeof m.series === "string" ? m.series : "—"}</td>
                      <td className="num">{typeof m.length_minutes === "number" ? `${m.length_minutes} min` : "—"}</td>
                      <td>
                        <StatusText tone={i.status === "published" ? "ok" : "warn"}>{contentStatusLabel(i.status)}</StatusText>
                      </td>
                      {canDraft ? <td className="text-right">{edit(i, "Audio lesson", ["series", "length_minutes"], "Transcript or notes")}</td> : null}
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
