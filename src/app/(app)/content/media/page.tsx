import type { Metadata } from "next";

import { Alert, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import {
  contentStatusLabel,
  contentStatusTone,
  formatDuration,
  MEDIA_KINDS,
  MEDIA_LANGUAGES,
  MEDIA_SOURCE_LABEL,
  mediaSourceOf,
  metaList,
  PLAYLIST_KINDS,
  type MediaKind,
} from "@/lib/content";
import { readPublicEnv } from "@/lib/env";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ContentHeader, contentGate } from "../shared";
import { MediaItemButton, type MediaItem, type MediaPermissions } from "./media-item-form";

export const metadata: Metadata = { title: "Content · Media library" };

const SUB = "Stavans, videos, podcasts and recipes members find in the member app's 3L (Look, Listen, Learn)";

type Row = {
  id: string;
  center_id: string | null;
  kind: MediaKind;
  title: string;
  body_md: string | null;
  language: string;
  media_url: string | null;
  media_path: string | null;
  metadata: unknown;
  status: string;
};

const CARDS: { kind: MediaKind; title: string; label: string; description: string; add: string; empty: string; artist?: string }[] = [
  { kind: "stavan", title: "Stavans", label: "Stavan", artist: "Singer", description: "Devotional songs and their lyrics · 3L › Listen", add: "Add stavan", empty: "No stavans yet" },
  {
    kind: "video",
    title: "Videos",
    label: "Video",
    artist: "Presenter",
    description: "Talks, pravachans and how-tos · 3L › Look. Files up to 50 MB; put bigger videos on YouTube and paste the link.",
    add: "Add video",
    empty: "No videos yet",
  },
  { kind: "podcast", title: "Podcasts", label: "Podcast", artist: "Speaker", description: "Episodes · 3L › Listen and the Home shortcut “Podcast”", add: "Add podcast", empty: "No podcasts yet" },
  { kind: "recipe", title: "Recipes", label: "Recipe", description: "Jain recipes · 3L › Look and the Home shortcut “Jain recipe” (fully Jain recipes only)", add: "Add recipe", empty: "No recipes yet" },
];

function meta(r: Row): Record<string, unknown> {
  return r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {};
}
function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function whole(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** The stored file a row's preview plays or shows: the recording, or a recipe's photo. */
function storedFile(r: Row): string | null {
  const p = r.kind === "recipe" ? text(meta(r).photo_path) : r.media_path;
  return p && !/^https?:\/\//i.test(p) ? p : null;
}

function recipeTime(m: Record<string, unknown>): string {
  const prep = whole(m.prep_minutes);
  const cook = whole(m.cook_minutes);
  if (prep !== null && cook !== null) return `${prep} + ${cook} min`;
  if (prep !== null || cook !== null) return `${prep ?? cook} min`;
  return "—";
}

export default async function MediaLibraryPage() {
  const session = await getSession();
  const gate = contentGate(session, SUB);
  if (gate) return gate;
  const { db, center } = session;
  const canDraft = canAccess(session, "contentDraft");
  const canManage = can(session, "content.manage");
  const env = readPublicEnv();
  const permissions: MediaPermissions = { canUpload: canManage, canManage, apiKey: env.ok ? env.env.supabaseAnonKey : null };

  const res = await db
    .from("content_items")
    .select("id, center_id, kind, title, body_md, language, media_url, media_path, metadata, status")
    .in("kind", [...MEDIA_KINDS])
    .or(`center_id.eq.${center.id},center_id.is.null`)
    .neq("status", "retired")
    .order("title");
  const rows = (res.data ?? []) as Row[];

  // Previews in the drawers: one batch of short-lived signed addresses for the stored files.
  const paths = [...new Set(rows.map(storedFile).filter((p): p is string => p !== null))];
  const previews = new Map<string, { url: string | null; error: string | null }>();
  if (paths.length) {
    const signed = await db.storage.from("content").createSignedUrls(paths, 3600);
    if (signed.error) {
      console.error("[content/media] could not sign the preview addresses:", signed.error);
      for (const p of paths) previews.set(p, { url: null, error: "No preview: storage did not answer. Reload the page to try again." });
    } else {
      for (const s of signed.data ?? []) {
        if (!s.path) continue;
        if (s.error || !s.signedUrl) console.error(`[content/media] could not sign content/${s.path}:`, s.error);
        previews.set(s.path, s.error || !s.signedUrl ? { url: null, error: "No preview: storage could not find the file, or you can't open it." } : { url: s.signedUrl, error: null });
      }
    }
  }

  // Likes and playlist adds per item (app.media_like_counts, 0560): counts only, never who. The
  // database gives them to content.view and content.manage; items nobody likes are left out (0).
  const canSeeCounts = can(session, ["content.view", "content.manage"]);
  const counts = new Map<string, { likes: number; playlists: number }>();
  let countsError: unknown = null;
  if (canSeeCounts && rows.length) {
    const c = await db.rpc("media_like_counts", { p_center: center.id });
    if (c.error) {
      console.error("[content/media] could not load the like counts:", c.error);
      countsError = c.error;
    } else for (const x of c.data ?? []) counts.set(x.item_id, { likes: x.like_count, playlists: x.playlist_count });
  }

  const toItem = (r: Row): MediaItem => {
    const file = storedFile(r);
    const p = file ? previews.get(file) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      body_md: r.body_md,
      language: r.language,
      media_url: r.media_url,
      media_path: r.media_path,
      metadata: meta(r),
      status: r.status,
      previewUrl: p?.url ?? null,
      previewError: file ? (p?.error ?? "No preview: the file's address could not be prepared. Reload the page to try again.") : null,
    };
  };

  const editCell = (r: Row, card: (typeof CARDS)[number]) =>
    canDraft ? (
      <td className="text-right">
        {r.center_id ? (
          <MediaItemButton kind={r.kind} kindLabel={card.label} item={toItem(r)} label={canManage || !isPublished(r) ? "Edit" : "Open"} variant="ghost" size="xs" permissions={permissions} />
        ) : (
          <span className="text-xs text-muted">Shared</span>
        )}
      </td>
    ) : null;

  const likesCells = (r: Row, playlists: boolean) => {
    if (!canSeeCounts) return null;
    const c = counts.get(r.id);
    const shown = (n: number | undefined) => (countsError ? "—" : String(n ?? 0));
    return (
      <>
        <td className="num">{shown(c?.likes)}</td>
        {playlists ? <td className="num">{shown(c?.playlists)}</td> : null}
      </>
    );
  };

  return (
    <>
      <ContentHeader sub={SUB} />
      {res.error ? (
        <div className="mb-4">
          <QueryError what="the media library" error={res.error} retryHref="/content/media" />
        </div>
      ) : null}
      {countsError ? (
        <div className="mb-4">
          <QueryError what="the like and playlist counts" error={countsError} retryHref="/content/media" />
        </div>
      ) : null}
      {!canSeeCounts ? (
        <p className="mb-3 text-[13px] text-muted">Like and playlist counts need content.view or content.manage, so they are not shown for your role.</p>
      ) : null}
      {canDraft && !canManage ? (
        <div className="mb-4">
          <Alert tone="info" title="You can add stavans, videos, podcasts and recipes as drafts">
            Uploading files and changing published items need content.manage. Paste a YouTube or web link instead, or save the draft and ask a content manager
            to upload the file. Drafts go to the Approval queue when you send them for approval.
          </Alert>
        </div>
      ) : null}
      {CARDS.map((card) => {
        const list = rows.filter((r) => r.kind === card.kind);
        const playlists = PLAYLIST_KINDS.includes(card.kind);
        return (
          <Card
            key={card.kind}
            title={card.title}
            description={card.description}
            padded={false}
            className="mb-4"
            actions={canDraft ? <MediaItemButton kind={card.kind} kindLabel={card.label} label={card.add} permissions={permissions} /> : null}
          >
            {list.length === 0 ? (
              <EmptyState title={card.empty} />
            ) : (
              <TableWrap>
                <table className="crm-table" aria-label={card.title}>
                  <thead>
                    <tr>
                      <th>Title</th>
                      {card.kind === "recipe" ? (
                        <>
                          <th>Fully Jain</th>
                          <th>Time</th>
                          <th>Photo</th>
                        </>
                      ) : (
                        <>
                          <th>{card.artist}</th>
                          <th>Source</th>
                          <th className="num">Length</th>
                        </>
                      )}
                      <th>Status</th>
                      {canSeeCounts ? <th className="num">Likes</th> : null}
                      {canSeeCounts && playlists ? <th className="num">In playlists</th> : null}
                      {canDraft ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const m = meta(r);
                      return (
                        <tr key={r.id}>
                          <td>
                            <span className="font-bold">{r.title}</span>
                            <SubLine r={r} m={m} />
                          </td>
                          {r.kind === "recipe" ? (
                            <>
                              <td>{m.fully_jain === true ? <StatusText tone="ok">Fully Jain</StatusText> : "No"}</td>
                              <td className="whitespace-nowrap">{recipeTime(m)}</td>
                              <td>{text(m.photo_path) ? "Photo" : <StatusText tone="warn">No photo</StatusText>}</td>
                            </>
                          ) : (
                            <>
                              <td>{text(m.artist) ?? "—"}</td>
                              <td>
                                <SourceCell r={r} />
                              </td>
                              <td className="num">{formatDuration(m.duration_seconds) || "—"}</td>
                            </>
                          )}
                          <td>
                            <StatusText tone={contentStatusTone(r.status)}>{contentStatusLabel(r.status)}</StatusText>
                          </td>
                          {likesCells(r, playlists)}
                          {editCell(r, card)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        );
      })}
    </>
  );
}

function isPublished(r: Row): boolean {
  return r.status === "published" || r.status === "approved";
}

function SourceCell({ r }: { r: Row }) {
  const source = mediaSourceOf(r);
  return source ? <>{MEDIA_SOURCE_LABEL[source]}</> : <StatusText tone="warn">No recording yet</StatusText>;
}

/** Under the title: the podcast's series and episode, a recipe's servings, other spellings, the language. */
function SubLine({ r, m }: { r: Row; m: Record<string, unknown> }) {
  const parts: string[] = [];
  if (r.kind === "podcast") {
    const series = text(m.series);
    const episode = whole(m.episode);
    if (series) parts.push(series);
    if (episode !== null) parts.push(`Episode ${episode}`);
  }
  const servings = whole(m.servings);
  if (r.kind === "recipe" && servings !== null) parts.push(`Serves ${servings}`);
  const aliases = metaList(m.aliases);
  if (aliases.length) parts.push(`Also: ${aliases.join(", ")}`);
  if (r.language && r.language !== "en") parts.push(MEDIA_LANGUAGES.find((l) => l.value === r.language)?.label ?? r.language);
  if (parts.length === 0) return null;
  return <p className="text-[12px] text-muted">{parts.join(" · ")}</p>;
}
