"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { Drawer } from "@/components/drawer";
import { HistoryButton } from "@/components/record-history";
import { Alert, buttonClass, capitalize, type ButtonSize, type ButtonVariant } from "@/components/ui";
import {
  checkMediaFile,
  contentStatusLabel,
  formatDuration,
  linkPlaysAs,
  MEDIA_ACCEPT,
  MEDIA_LANGUAGES,
  mediaFileLabel,
  mediaFileRole,
  metaList,
  parseMediaLink,
  youtubeEmbedUrl,
  type MediaKind,
} from "@/lib/content";

import { saveContentItemAction } from "../actions";
import { prepareMediaUploadAction } from "./actions";
import { uploadToSignedUrl } from "./upload";

export type MediaItem = {
  id: string;
  kind: MediaKind;
  title: string;
  body_md: string | null;
  language: string;
  media_url: string | null;
  media_path: string | null;
  metadata: Record<string, unknown>;
  status: string;
  /** Short-lived signed address of the stored file (recording, or a recipe's photo) for the preview. */
  previewUrl: string | null;
  /** Why there is no preview of a stored file, in plain English. */
  previewError: string | null;
};

/** What the drawer may do for this editor: drafts need content.draft; files and published items need content.manage. */
export type MediaPermissions = {
  canUpload: boolean;
  canManage: boolean;
  apiKey: string | null;
  /** The organization's kind has no tradition pack: songs instead of stavans, no "fully Jain" recipe mark, neutral examples. */
  neutral?: boolean;
};

type Copy = { noun: string; artist?: string; artistHint?: string; body: string; bodyHint?: string; bodyRows: number; upload: string; fileHint: string };

/** What a stavan is called by a kind without a tradition pack. */
const SONG_COPY: Copy = {
  noun: "song",
  artist: "Singer",
  body: "Lyrics",
  bodyHint: "Shown with the song in the app. A song may go for approval with lyrics only.",
  bodyRows: 8,
  upload: "Upload a recording",
  fileHint: "MP3 or M4A, up to 50 MB. They play on every phone; OGG and WebM do not play on iPhones.",
};

const COPY: Record<MediaKind, Copy> = {
  stavan: {
    noun: "stavan",
    artist: "Singer",
    body: "Lyrics",
    bodyHint: "Shown with the stavan in the app. A stavan may go for approval with lyrics only.",
    bodyRows: 8,
    upload: "Upload a recording",
    fileHint: "MP3 or M4A, up to 50 MB. They play on every phone; OGG and WebM do not play on iPhones.",
  },
  video: {
    noun: "video",
    artist: "Presenter",
    body: "Description",
    bodyRows: 4,
    upload: "Upload a video",
    fileHint: "MP4, up to 50 MB. Bigger videos: upload them to YouTube (unlisted is fine) and paste the link instead.",
  },
  podcast: {
    noun: "podcast",
    artist: "Speaker",
    body: "Episode notes",
    bodyRows: 4,
    upload: "Upload a recording",
    fileHint: "MP3 or M4A, up to 50 MB. They play on every phone; OGG and WebM do not play on iPhones.",
  },
  recipe: {
    noun: "recipe",
    body: "Method",
    bodyHint: "The steps in order, one per line.",
    bodyRows: 8,
    upload: "Upload a photo",
    fileHint: "JPEG, PNG or WebP. Members see it on the recipe.",
  },
};

/** "Add stavan" / "Edit": opens the right-hand drawer with the item's form. */
export function MediaItemButton({
  kind,
  kindLabel,
  item,
  label,
  variant = "primary",
  size = "sm",
  permissions,
}: {
  kind: MediaKind;
  kindLabel: string;
  item?: MediaItem;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  permissions: MediaPermissions;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size)}>
        {label}
      </button>
      <Drawer open={open} onClose={close} kicker={kindLabel} title={item ? item.title : `New ${(permissions.neutral && kind === "stavan" ? SONG_COPY : COPY[kind]).noun}`}>
        <MediaItemForm kind={kind} item={item} permissions={permissions} onSaved={close} />
      </Drawer>
    </>
  );
}

type Upload = {
  phase: "uploading" | "done" | "failed";
  name: string;
  loaded: number;
  total: number;
  /** The chosen file (kept for "Try again"); null when it could never be uploaded. */
  file: File | null;
  /** Stored path once the upload finished. */
  path: string | null;
  error: string | null;
  /** Local address of the chosen file, for the preview. */
  localUrl: string | null;
};

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function MediaItemForm({ kind, item, permissions, onSaved }: { kind: MediaKind; item?: MediaItem; permissions: MediaPermissions; onSaved: () => void }) {
  const copy = permissions.neutral && kind === "stavan" ? SONG_COPY : COPY[kind];
  const role = mediaFileRole(kind);
  const m = item?.metadata ?? {};
  const idp = item ? `mi-${item.id.slice(0, 8)}` : `mi-new-${kind}`;
  const published = item?.status === "published" || item?.status === "approved";
  const locked = published && !permissions.canManage;
  const storedPath = kind === "recipe" ? (typeof m.photo_path === "string" && m.photo_path ? m.photo_path : null) : (item?.media_path ?? null);

  const [source, setSource] = useState<"upload" | "link">(
    kind === "recipe" || item?.media_path ? "upload" : item?.media_url ? "link" : permissions.canUpload ? "upload" : "link",
  );
  const [link, setLink] = useState(item?.media_url ?? "");
  const [duration, setDuration] = useState(formatDuration(m.duration_seconds));
  const [upload, setUpload] = useState<Upload | null>(null);
  const [removed, setRemoved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const localUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Closing the drawer mid-upload stops the upload and frees the local preview.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    },
    [],
  );

  function replaceLocalUrl(file: File | null): string | null {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    localUrlRef.current = file ? URL.createObjectURL(file) : null;
    return localUrlRef.current;
  }

  async function startUpload(file: File) {
    abortRef.current?.abort();
    const checked = checkMediaFile(role, file);
    if (!checked.ok) {
      replaceLocalUrl(null);
      setUpload({ phase: "failed", name: file.name, loaded: 0, total: file.size, file: null, path: null, error: checked.error, localUrl: null });
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const localUrl = replaceLocalUrl(file);
    setRemoved(false);
    setUpload({ phase: "uploading", name: file.name, loaded: 0, total: file.size, file, path: null, error: null, localUrl });
    const fail = (error: string) => setUpload({ phase: "failed", name: file.name, loaded: 0, total: file.size, file, path: null, error, localUrl });
    let ticket: Awaited<ReturnType<typeof prepareMediaUploadAction>>;
    try {
      ticket = await prepareMediaUploadAction({ kind, fileName: file.name, type: file.type, size: file.size });
    } catch (err) {
      console.error("[content/media] could not ask for an upload address:", err);
      if (!controller.signal.aborted) fail("Could not start the upload — the server did not answer. Check the connection and try again.");
      return;
    }
    if (controller.signal.aborted) return;
    if (!ticket.ok || !ticket.data) {
      fail(ticket.ok ? "Could not start the upload — the server gave no upload address. Try again." : ticket.error);
      return;
    }
    const { path, signedUrl, contentType } = ticket.data;
    const res = await uploadToSignedUrl({
      signedUrl,
      file,
      contentType,
      apiKey: permissions.apiKey,
      signal: controller.signal,
      onProgress: (p) => setUpload((u) => (u && u.phase === "uploading" && u.file === file ? { ...u, loaded: p.loaded, total: p.total } : u)),
    });
    if (controller.signal.aborted) return;
    if (!res.ok) {
      fail(`Could not upload the file — ${res.error}.`);
      return;
    }
    setUpload({ phase: "done", name: file.name, loaded: file.size, total: file.size, file, path, error: null, localUrl });
  }

  function dropNewFile() {
    abortRef.current?.abort();
    replaceLocalUrl(null);
    setUpload(null);
  }

  const usingUpload = kind === "recipe" || source === "upload";
  const pathToSave = upload?.phase === "done" ? upload.path : removed ? null : storedPath;
  const previewSrc = upload && upload.phase !== "failed" ? upload.localUrl : !removed && storedPath ? (item?.previewUrl ?? null) : null;
  const blocked =
    usingUpload && upload?.phase === "uploading"
      ? "Wait for the upload to finish before saving."
      : usingUpload && upload?.phase === "failed" && upload.file
        ? "The new file has not uploaded. Try again, or remove it."
        : null;
  const parsedLink = source === "link" && link.trim() ? parseMediaLink(link) : null;
  const languages: { value: string; label: string }[] = [...MEDIA_LANGUAGES];
  if (item?.language && !languages.some((l) => l.value === item.language)) languages.push({ value: item.language, label: item.language });

  const onLoadedMetadata = (e: SyntheticEvent<HTMLMediaElement>) => {
    const d = e.currentTarget.duration;
    if (kind !== "recipe" && !duration.trim() && Number.isFinite(d) && d > 0) setDuration(formatDuration(d));
  };

  const filePanel = (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line-soft bg-ground p-3">
      {upload?.phase === "uploading" ? (
        <div role="status" aria-live="polite">
          <p className="text-[13px] font-semibold">
            Uploading {upload.name} — {mb(upload.loaded)} of {mb(upload.total)} MB ({upload.total ? Math.floor((upload.loaded / upload.total) * 100) : 0}%)
          </p>
          <progress className="mt-1 h-2 w-full" max={upload.total || 1} value={upload.loaded} aria-label={`Upload of ${upload.name}`} />
          <button type="button" onClick={dropNewFile} className={`${buttonClass("ghost", "xs")} mt-2`}>
            Cancel upload
          </button>
        </div>
      ) : null}
      {upload?.phase === "failed" ? (
        <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          <p>{upload.error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {upload.file ? (
              <button type="button" onClick={() => void startUpload(upload.file!)} className={buttonClass("bad", "xs")}>
                Try again
              </button>
            ) : null}
            <button type="button" onClick={dropNewFile} className={buttonClass("ghost", "xs")}>
              {storedPath && !removed ? "Keep the current file" : "Dismiss"}
            </button>
          </div>
        </div>
      ) : null}
      {upload?.phase === "done" ? (
        <p className="text-[13px] font-semibold text-success">
          {upload.name} uploaded · {mb(upload.total)} MB. Save to use it.
        </p>
      ) : null}
      {!upload && storedPath && !removed ? <p className="text-[13px]">Current file: {mediaFileLabel(storedPath)}</p> : null}
      {!upload && removed ? <p className="text-[13px] text-muted">No file. The stored file is kept in storage; this item just stops using it once you save.</p> : null}

      {previewSrc ? (
        role === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewSrc} alt={`Photo of ${item?.title ?? "the recipe"}`} className="max-h-56 w-auto self-start rounded-lg border border-line" />
        ) : role === "video" ? (
          <video controls preload="metadata" src={previewSrc} onLoadedMetadata={onLoadedMetadata} className="aspect-video w-full rounded-lg bg-black" />
        ) : (
          <audio controls preload="metadata" src={previewSrc} onLoadedMetadata={onLoadedMetadata} className="w-full" />
        )
      ) : !upload && storedPath && !removed && item?.previewError ? (
        <p className="text-[12px] text-danger">{item.previewError}</p>
      ) : null}

      {permissions.canUpload ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={locked || upload?.phase === "uploading"} className={buttonClass("ghost", "xs")}>
            {(storedPath && !removed) || upload ? "Choose another file" : role === "image" ? "Choose a photo" : "Choose a file"}
          </button>
          {/* No name: the file goes straight to storage, never through the form (Server Actions take 11 MB at most). */}
          <input
            ref={fileInputRef}
            type="file"
            accept={MEDIA_ACCEPT[role]}
            className="hidden"
            tabIndex={-1}
            aria-hidden
            disabled={locked}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void startUpload(f);
            }}
          />
          {storedPath && !removed && !upload ? (
            <button type="button" onClick={() => setRemoved(true)} className={buttonClass("plain", "xs")}>
              Remove {role === "image" ? "photo" : "file"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-muted">
          {storedPath ? "Replacing the file" : role === "image" ? "Adding a photo" : "Uploading a file"} needs content.manage.{" "}
          {role === "image" ? "Save the recipe and ask a content manager to add the photo." : "Paste a YouTube or web link instead, or save the draft and ask a content manager to upload the file."}
        </p>
      )}
      <p className="crm-hint">{copy.fileHint}</p>
    </div>
  );

  return (
    <ActionForm
      action={saveContentItemAction}
      submitLabel="Save draft"
      hideSubmit
      onSuccess={onSaved}
      extraButtons={
        <>
          {locked ? null : (
            <>
              <button type="submit" name="submit" value="draft" data-variant="ghost" disabled={Boolean(blocked)} className={buttonClass(blocked ? "off" : "ghost")}>
                Save draft
              </button>
              <button type="submit" name="submit" value="review" data-variant="primary" disabled={Boolean(blocked)} className={buttonClass(blocked ? "off" : "primary")}>
                Send for approval
              </button>
            </>
          )}
          {item ? <HistoryButton table="content_items" recordId={item.id} title={item.title} size="md" /> : null}
          {blocked ? <p className="w-full text-[12px] text-muted">{blocked}</p> : null}
        </>
      }
    >
      <input type="hidden" name="kind" value={kind} />
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <fieldset disabled={locked} className="mb-3 flex min-w-0 flex-col gap-3">
        {item ? (
          <p className="text-[13px]">
            <span className="font-semibold">Status:</span> {contentStatusLabel(item.status)}
            {published && !locked ? <span className="text-muted"> · Saving a change takes it off the member app until it is approved again.</span> : null}
          </p>
        ) : null}
        {locked ? <Alert tone="info">Only content managers can change a published {copy.noun} (needs content.manage). You can still play it here.</Alert> : null}

        <div>
          <label htmlFor={`${idp}-title`} className="crm-label">
            Title
          </label>
          <input id={`${idp}-title`} name="title" required maxLength={200} defaultValue={item?.title ?? ""} className="crm-input" />
        </div>

        {kind === "recipe" ? (
          <>
            {permissions.neutral ? (
              // No tradition pack: the mark is not offered, but a recipe already marked keeps its mark.
              m.fully_jain === true ? <input type="hidden" name="fully_jain" value="on" /> : null
            ) : (
              <div>
                <p className="crm-label">Fully Jain</p>
                <Toggle name="fully_jain" defaultChecked={m.fully_jain === true} label="Fully Jain recipe" onNote="Fully Jain" offNote="Not marked fully Jain" disabled={locked} />
                <p className="crm-hint">
                  No root vegetables: no potato, onion, garlic, carrot and the like. The Home shortcut “Jain recipe” only picks fully Jain recipes.
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${idp}-servings`} className="crm-label">
                  Servings
                </label>
                <input id={`${idp}-servings`} name="servings" inputMode="numeric" defaultValue={numberText(m.servings)} className="crm-input" />
              </div>
              <div>
                <label htmlFor={`${idp}-prep`} className="crm-label">
                  Prep (minutes)
                </label>
                <input id={`${idp}-prep`} name="prep_minutes" inputMode="numeric" defaultValue={numberText(m.prep_minutes)} className="crm-input" />
              </div>
              <div>
                <label htmlFor={`${idp}-cook`} className="crm-label">
                  Cook (minutes)
                </label>
                <input id={`${idp}-cook`} name="cook_minutes" inputMode="numeric" defaultValue={numberText(m.cook_minutes)} className="crm-input" />
              </div>
            </div>
            <div>
              <label htmlFor={`${idp}-ingredients`} className="crm-label">
                Ingredients
              </label>
              <textarea id={`${idp}-ingredients`} name="ingredients" rows={6} defaultValue={metaList(m.ingredients).join("\n")} className="crm-input" />
              <p className="crm-hint">One per line, e.g. “1 cup moong dal”. Bullets and numbers at the start are removed.</p>
            </div>
          </>
        ) : (
          <>
            <div>
              <label htmlFor={`${idp}-artist`} className="crm-label">
                {copy.artist}
              </label>
              <input id={`${idp}-artist`} name="artist" maxLength={120} defaultValue={typeof m.artist === "string" ? m.artist : ""} className="crm-input" />
            </div>
            {kind === "podcast" ? (
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <div>
                  <label htmlFor={`${idp}-series`} className="crm-label">
                    Series
                  </label>
                  <input id={`${idp}-series`} name="series" maxLength={120} defaultValue={typeof m.series === "string" ? m.series : ""} className="crm-input" />
                </div>
                <div>
                  <label htmlFor={`${idp}-episode`} className="crm-label">
                    Episode
                  </label>
                  <input id={`${idp}-episode`} name="episode" inputMode="numeric" defaultValue={numberText(m.episode)} className="crm-input" />
                </div>
              </div>
            ) : null}
          </>
        )}

        <div>
          <label htmlFor={`${idp}-aliases`} className="crm-label">
            {kind === "recipe" ? "Other names" : "Other spellings"}
          </label>
          <input id={`${idp}-aliases`} name="aliases" defaultValue={metaList(m.aliases).join(", ")} className="crm-input" />
          <p className="crm-hint">Separated by commas. Members find it by any of them{kind === "stavan" && !permissions.neutral ? ", e.g. Navkar, Navkaar, Namokar" : ""}.</p>
        </div>
        <div>
          <label htmlFor={`${idp}-language`} className="crm-label">
            Language
          </label>
          <select id={`${idp}-language`} name="language" defaultValue={item?.language ?? "en"} className="crm-input">
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {kind === "recipe" ? (
          <div>
            <p className="crm-label">Photo</p>
            <input type="hidden" name="photo_path" value={pathToSave ?? ""} />
            {filePanel}
          </div>
        ) : (
          <div>
            <p className="crm-label">Recording</p>
            <ChipGroup
              name="source"
              label="Where the recording comes from"
              value={source}
              onChange={(v) => setSource(v === "link" ? "link" : "upload")}
              options={[
                { value: "upload", label: copy.upload, disabled: !permissions.canUpload && !storedPath },
                { value: "link", label: "YouTube or web link" },
              ]}
              disabled={locked}
            />
            <div className="mt-2">
              {source === "upload" ? (
                <>
                  <input type="hidden" name="media_path" value={pathToSave ?? ""} />
                  {filePanel}
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <input
                    id={`${idp}-link`}
                    name="media_url"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=… or https://…"
                    aria-label="YouTube or web link"
                    aria-describedby={`${idp}-link-note`}
                    className="crm-input"
                  />
                  <LinkPreview id={`${idp}-link-note`} parsed={parsedLink} title={item?.title ?? "the recording"} onLoadedMetadata={onLoadedMetadata} />
                </div>
              )}
            </div>
          </div>
        )}

        {kind !== "recipe" ? (
          <div>
            <label htmlFor={`${idp}-duration`} className="crm-label">
              Length
            </label>
            <input id={`${idp}-duration`} name="duration" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="4:05" className="crm-input w-32" />
            <p className="crm-hint">Minutes:seconds. Filled in from the file when you choose one.</p>
          </div>
        ) : null}

        <div>
          <label htmlFor={`${idp}-tags`} className="crm-label">
            Tags
          </label>
          <input id={`${idp}-tags`} name="tags" defaultValue={metaList(m.tags).join(", ")} className="crm-input" />
          <p className="crm-hint">Separated by commas{permissions.neutral ? (kind === "recipe" ? ", e.g. potluck, no-cook" : ", e.g. morning, weekly") : kind === "recipe" ? ", e.g. paryushan, no-cook" : ", e.g. paryushan, morning"}. Search finds them.</p>
        </div>
        <div>
          <label htmlFor={`${idp}-body`} className="crm-label">
            {copy.body}
          </label>
          <textarea id={`${idp}-body`} name="body_md" rows={copy.bodyRows} defaultValue={item?.body_md ?? ""} className="crm-input" />
          {copy.bodyHint ? <p className="crm-hint">{copy.bodyHint}</p> : null}
        </div>
      </fieldset>
    </ActionForm>
  );
}

function numberText(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

/** Under the link field: what the link was read as, and a player when it can be played here. */
function LinkPreview({
  id,
  parsed,
  title,
  onLoadedMetadata,
}: {
  id: string;
  parsed: ReturnType<typeof parseMediaLink> | null;
  title: string;
  onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => void;
}) {
  if (!parsed) {
    return (
      <p id={id} className="crm-hint">
        A YouTube video (watch, youtu.be, shorts and embed links all work), or a secure https:// link. A link straight to an audio file plays in the app&apos;s player.
      </p>
    );
  }
  if (!parsed.ok) {
    return (
      <p id={id} role="alert" className="text-[12px] text-danger">
        {capitalize(parsed.error)}.
      </p>
    );
  }
  if (parsed.source === "youtube") {
    return (
      <div className="flex flex-col gap-1.5">
        <p id={id} className="text-[12px] text-success">
          YouTube video {parsed.youtubeId} · saved as {parsed.url}
        </p>
        <iframe
          src={youtubeEmbedUrl(parsed.youtubeId)}
          title={`${title} (YouTube preview)`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="aspect-video w-full rounded-lg border border-line bg-black"
        />
      </div>
    );
  }
  const plays = linkPlaysAs(parsed.url);
  return (
    <div className="flex flex-col gap-1.5">
      <p id={id} className="text-[12px] text-muted">
        {plays ? `Web link to ${plays === "audio" ? "an audio file" : "a video file"} · it plays below.` : "Web link · members open it in the browser."}{" "}
        <a href={parsed.url} target="_blank" rel="noreferrer" className="crm-link">
          Open the link
        </a>
      </p>
      {plays === "audio" ? <audio controls preload="metadata" src={parsed.url} onLoadedMetadata={onLoadedMetadata} className="w-full" /> : null}
      {plays === "video" ? (
        <video controls preload="metadata" src={parsed.url} onLoadedMetadata={onLoadedMetadata} className="aspect-video w-full rounded-lg bg-black" />
      ) : null}
    </div>
  );
}
