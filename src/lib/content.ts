// Pure helpers for the Content module (approval queue, practices, timings,
// Gyan Path, library, media library, photos, legal documents).

import type { Json } from "@/lib/database.types";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Content items (0007 content_items.kind / status)
// ---------------------------------------------------------------------------
export const CONTENT_KIND_LABEL: Record<string, string> = {
  sutra: "Religious content",
  pachchakhan: "Religious content · pachchakhan",
  audio_lesson: "Audio lesson",
  video: "Video",
  stavan: "Stavan",
  podcast: "Podcast",
  recipe: "Recipe",
  guide_page: "Guide page",
  explainer: "Explainer",
  darshan_stream: "Live darshan stream",
  niva_source: "Niva source",
  faq: "FAQ",
  other: "Other",
};

export function contentKindLabel(kind: string): string {
  return CONTENT_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

export function contentStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "in_review":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "retired":
      return "Retired";
    default:
      return status;
  }
}

export function contentStatusTone(status: string): "ok" | "warn" | "bad" {
  if (status === "published" || status === "approved") return "ok";
  if (status === "retired") return "bad";
  return "warn";
}

/** Lowercase, dash-separated web address from a title ("Iriyavahiyam sutra" → "iriyavahiyam-sutra"). */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Media library (0560): stavans, videos, podcasts and recipes. Members find
// them in the member app's 3L (Look, Listen, Learn); metadata conventions are
// documented on content_items.metadata.
// ---------------------------------------------------------------------------
export const MEDIA_KINDS = ["stavan", "video", "podcast", "recipe"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export function isMediaKind(v: unknown): v is MediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);
}

/** Kinds a member can add to My playlist (app.add_to_playlist). Recipes are liked, not played. */
export const PLAYLIST_KINDS: readonly MediaKind[] = ["stavan", "video", "podcast"];

export type MediaSource = "upload" | "youtube" | "link";
export const MEDIA_SOURCE_LABEL: Record<MediaSource, string> = { upload: "Uploaded file", youtube: "YouTube", link: "Web link" };

/** Where an item's recording comes from: metadata.source when it is set, else what is filled in. */
export function mediaSourceOf(item: { media_path: string | null; media_url: string | null; metadata: unknown }): MediaSource | null {
  const s = isObj(item.metadata) ? item.metadata.source : undefined;
  if (s === "upload" || s === "youtube" || s === "link") return s;
  if (item.media_path) return "upload";
  if (item.media_url) {
    const yt = parseYouTubeUrl(item.media_url);
    return yt && !("error" in yt) ? "youtube" : "link";
  }
  return null;
}

/** The content bucket's limit per file (0172): bigger videos go to YouTube and are linked. */
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

/** What an uploaded file of each kind is: the recording, or (recipes) the photo. */
export type MediaFileRole = "audio" | "video" | "image";

export function mediaFileRole(kind: MediaKind): MediaFileRole {
  if (kind === "video") return "video";
  if (kind === "recipe") return "image";
  return "audio";
}

/** File types the content bucket stores for each role (0172 + 0560), with the extension each is saved under. */
const MEDIA_TYPES: Record<MediaFileRole, Record<string, string>> = {
  audio: { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/ogg": "ogg", "audio/wav": "wav", "audio/webm": "webm" },
  video: { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" },
  image: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" },
};

/** Other names browsers give the same formats; the file is stored under the standard type. */
const TYPE_ALIASES: Record<string, string> = {
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/mpeg3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/x-mpeg-3": "audio/mpeg",
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "audio/aacp": "audio/aac",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
};

/** For a file the browser reports without a type (or as application/octet-stream). */
const EXTENSION_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** obj[key] for the table's own keys only (never Object.prototype's). */
function own(table: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** The type a chosen file is stored as, or null when it is not a file this role takes. */
export function mediaContentType(role: MediaFileRole, file: { name: string; type: string }): string | null {
  const reported = file.type.trim().toLowerCase().split(";")[0];
  let type = own(TYPE_ALIASES, reported) ?? reported;
  if (!type || type === "application/octet-stream") type = own(EXTENSION_TYPES, extensionOf(file.name)) ?? "";
  // Browsers report a .webm sound recording as video/webm (the extension says nothing more).
  if (role === "audio" && type === "video/webm") type = "audio/webm";
  return own(MEDIA_TYPES[role], type) ? type : null;
}

export const MEDIA_ACCEPT: Record<MediaFileRole, string> = {
  audio: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,audio/wav,audio/webm,.mp3,.m4a,.aac,.ogg,.opus,.wav,.weba",
  video: "video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov",
  image: "image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif",
};

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * A file the content bucket takes for this role (type and the 50 MB limit), with the type to
 * store it as, or the plain-English reason it can't be uploaded.
 */
export function checkMediaFile(
  role: MediaFileRole,
  file: { name: string; type: string; size: number },
): { ok: true; contentType: string } | { ok: false; error: string } {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "That file is empty. Choose it again." };
  const contentType = mediaContentType(role, file);
  if (!contentType) {
    if (role === "audio") return { ok: false, error: "That is not an audio file the library can store. Use MP3, M4A, AAC, OGG, WAV or WebM audio." };
    if (role === "video") return { ok: false, error: "That is not a video the library can store. Use MP4, WebM or MOV, or put it on YouTube and paste the link." };
    return { ok: false, error: "The photo must be a JPEG, PNG, WebP or GIF image (an iPhone HEIC photo can be exported as JPEG)." };
  }
  if (file.size > MEDIA_MAX_BYTES) {
    const size = megabytes(file.size);
    if (role === "video") return { ok: false, error: `This video is ${size}, over the 50 MB limit. Upload big videos to YouTube (unlisted is fine) and paste the link instead.` };
    if (role === "audio") {
      return { ok: false, error: `This recording is ${size}, over the 50 MB limit. Save it as MP3 at a lower quality, or upload it to YouTube and paste the link instead.` };
    }
    return { ok: false, error: `This photo is ${size}, over the 50 MB limit. Use a smaller photo.` };
  }
  return { ok: true, contentType };
}

/** "Navkār Mantra (live).MP3" → "navkar-mantra-live" (storage-safe, no extension). */
function safeBaseName(name: string): string {
  const base = name.trim().replace(/\.[a-z0-9]{1,5}$/i, "");
  return (
    base
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "file"
  );
}

/** Where an uploaded media file is stored: <center_id>/media/<kind>/<uuid>-<safe-name>.<ext> (0560). */
export function mediaObjectPath(centerId: string, kind: MediaKind, id: string, fileName: string, contentType: string): string {
  const ext = own(MEDIA_TYPES[mediaFileRole(kind)], contentType) ?? (extensionOf(fileName) || "bin");
  return `${centerId}/media/${kind}/${id}-${safeBaseName(fileName)}.${ext}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** True when `path` is a file uploaded for this center and kind (what the save accepts as a new media_path or photo_path). */
export function isMediaObjectPath(centerId: string, kind: MediaKind, path: string): boolean {
  if (!new RegExp(`^${UUID}$`, "i").test(centerId)) return false;
  return new RegExp(`^${centerId}/media/${kind}/${UUID}-[a-z0-9-]+\\.[a-z0-9]{1,5}$`, "i").test(path);
}

/** The file name a member would recognize: "<uuid>-navkar-mantra.mp3" → "navkar-mantra.mp3". */
export function mediaFileLabel(path: string): string {
  const last = path.split("/").pop() ?? path;
  return last.replace(new RegExp(`^${UUID}-`, "i"), "");
}

// --- Links: YouTube and other web addresses --------------------------------

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);

export type YouTubeLink = { youtubeId: string; url: string };

/**
 * A YouTube video link → its 11-character id and the canonical address
 * https://www.youtube.com/watch?v=<id>. Reads watch?v=, youtu.be/<id>, /shorts/, /embed/,
 * /live/ and /v/ links on youtube.com (www., m., music.) and youtube-nocookie.com, with or
 * without https:// in front. null when the text is not a YouTube address at all; { error } when
 * it is one but does not name a single video (a playlist, a channel).
 */
export function parseYouTubeUrl(input: string): YouTubeLink | { error: string } | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = parts[0] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const first = parts[0] ?? "";
    if (first === "watch" || (first === "" && url.searchParams.has("v"))) id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v", "e"].includes(first)) id = parts[1] ?? null;
    else if (first === "playlist") return { error: "that is a YouTube playlist. Open one video in it and copy that video's link" };
    else return { error: "that YouTube link does not point to one video. Open the video and copy its link (Share › Copy link)" };
  } else {
    return null;
  }
  if (!id || !YOUTUBE_ID.test(id)) return { error: "that YouTube link does not name a video. Open the video and copy its link (Share › Copy link)" };
  return { youtubeId: id, url: `https://www.youtube.com/watch?v=${id}` };
}

export type MediaLink = { ok: true; source: "youtube"; url: string; youtubeId: string } | { ok: true; source: "link"; url: string } | { ok: false; error: string };

/** What an editor pasted as the recording: a YouTube video (normalized) or another secure web address. */
export function parseMediaLink(input: string): MediaLink {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "paste the YouTube or web link" };
  const yt = parseYouTubeUrl(raw);
  if (yt && "error" in yt) return { ok: false, error: yt.error };
  if (yt) return { ok: true, source: "youtube", url: yt.url, youtubeId: yt.youtubeId };
  if (raw.length > 2000) return { ok: false, error: "that link is too long (2,000 characters at most)" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "the link must be a web address starting with https://" };
  }
  if (url.protocol !== "https:" || /\s/.test(raw) || !url.hostname.includes(".")) {
    return { ok: false, error: "the link must be a secure web address starting with https://" };
  }
  return { ok: true, source: "link", url: raw };
}

/** Whether a web link points straight at an audio or video file (so the drawer can play it). */
export function linkPlaysAs(url: string): "audio" | "video" | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const type = own(EXTENSION_TYPES, extensionOf(path)) ?? "";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return null;
}

/** The privacy-enhanced embed address for a YouTube video id. */
export function youtubeEmbedUrl(youtubeId: string): string {
  return `https://www.youtube-nocookie.com/embed/${youtubeId}`;
}

// --- Lengths and lists ------------------------------------------------------

/** "4:05" → 245, "1:02:03" → 3723, "12" (minutes) → 720; "" → null; anything else → "bad". At most 24 hours. */
export function parseDuration(text: string): number | null | "bad" {
  const v = text.trim();
  if (!v) return null;
  let seconds: number;
  if (/^\d{1,4}$/.test(v)) seconds = Number(v) * 60;
  else {
    const m = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(v);
    if (!m) return "bad";
    if (m[1] !== undefined && Number(m[2]) > 59) return "bad";
    seconds = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return seconds > 0 && seconds <= 24 * 3600 ? seconds : "bad";
}

/** 245 → "4:05", 3723 → "1:02:03"; nothing for a missing or broken value. */
export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Text typed as a list → its entries, trimmed, inner spaces collapsed. "comma" splits on commas and
 * new lines and drops repeats (any case); "line" splits on new lines only (an ingredient may hold a
 * comma), strips leading bullets and keeps repeats.
 */
export function parseTextList(text: string, by: "comma" | "line"): string[] {
  const parts = text
    .split(by === "line" ? /\r?\n/ : /[,\r\n]/)
    .map((s) => (by === "line" ? s.replace(/^\s*(?:[-•*·]|\d+[.)])\s+/, "") : s).trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (by === "line") return parts;
  const seen = new Set<string>();
  return parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** A metadata value that should be a list of text → its entries (anything else → none). */
export function metaList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

// --- The media drawer's form → the item's columns and metadata -------------

/** Languages offered for a media item (content_items.language; the member app's languages). */
export const MEDIA_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "gu", label: "Gujarati" },
  { value: "hi", label: "Hindi" },
] as const;

/** Metadata keys the media drawer edits, per kind; other keys (thumbnail_path, …) are kept as they are. */
export const MEDIA_META_KEYS: Record<MediaKind, readonly string[]> = {
  stavan: ["source", "youtube_id", "duration_seconds", "artist", "aliases", "tags"],
  video: ["source", "youtube_id", "duration_seconds", "artist", "aliases", "tags"],
  podcast: ["source", "youtube_id", "duration_seconds", "artist", "aliases", "tags", "series", "episode"],
  recipe: ["fully_jain", "ingredients", "servings", "prep_minutes", "cook_minutes", "photo_path", "aliases", "tags"],
};

export type MediaFields = {
  language: string;
  bodyMd: string | null;
  mediaUrl: string | null;
  mediaPath: string | null;
  /** Metadata keys to write. */
  set: Record<string, Json>;
  /** Keys this form manages that are now empty: removed from the stored metadata. */
  clear: string[];
};

type FormRead = (name: string) => string | null;

function wholeNumberIn(read: FormRead, name: string, min: number, max: number): number | null | "bad" {
  const raw = (read(name) ?? "").trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return "bad";
  const n = Number(raw);
  return n >= min && n <= max ? n : "bad";
}

/**
 * Read the media drawer (stavan, video, podcast, recipe) into the item's columns and metadata.
 * `current` is what the item holds now: a stored file that is kept as it is is always accepted;
 * a new one must be an upload of this center and kind. Errors read after "Could not save the item — ".
 */
export function parseMediaForm(
  kind: MediaKind,
  read: FormRead,
  centerId: string,
  current: { mediaPath: string | null; photoPath: string | null } = { mediaPath: null, photoPath: null },
): { ok: true; fields: MediaFields } | { ok: false; error: string } {
  const str = (name: string) => (read(name) ?? "").trim();
  const set: Record<string, Json> = {};
  const language = str("language") || "en";
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(language)) return { ok: false, error: "choose the language." };
  const bodyMd = str("body_md") || null;

  const aliases = parseTextList(str("aliases"), "comma");
  if (aliases.length > 20) return { ok: false, error: "list at most 20 other names or spellings." };
  if (aliases.some((a) => a.length > 120)) return { ok: false, error: "each other name or spelling must be 120 characters or fewer." };
  if (aliases.length) set.aliases = aliases;
  const tags = parseTextList(str("tags"), "comma");
  if (tags.length > 20) return { ok: false, error: "use at most 20 tags." };
  if (tags.some((t) => t.length > 60)) return { ok: false, error: "each tag must be 60 characters or fewer." };
  if (tags.length) set.tags = tags;

  let mediaUrl: string | null = null;
  let mediaPath: string | null = null;

  if (kind === "recipe") {
    if (read("fully_jain") === "on") set.fully_jain = true;
    else set.fully_jain = false;
    const ingredients = parseTextList(read("ingredients") ?? "", "line");
    if (ingredients.length > 80) return { ok: false, error: "list at most 80 ingredients." };
    if (ingredients.some((i) => i.length > 200)) return { ok: false, error: "each ingredient must be 200 characters or fewer (one per line)." };
    if (ingredients.length) set.ingredients = ingredients;
    const servings = wholeNumberIn(read, "servings", 1, 100);
    if (servings === "bad") return { ok: false, error: "servings must be a whole number from 1 to 100." };
    if (servings !== null) set.servings = servings;
    const prep = wholeNumberIn(read, "prep_minutes", 0, 1440);
    if (prep === "bad") return { ok: false, error: "the preparation time must be a whole number of minutes (up to 1,440)." };
    if (prep !== null) set.prep_minutes = prep;
    const cook = wholeNumberIn(read, "cook_minutes", 0, 1440);
    if (cook === "bad") return { ok: false, error: "the cooking time must be a whole number of minutes (up to 1,440)." };
    if (cook !== null) set.cook_minutes = cook;
    const photo = str("photo_path");
    if (photo && photo !== current.photoPath && !isMediaObjectPath(centerId, kind, photo)) {
      return { ok: false, error: "the photo is not one uploaded for this community's recipes. Upload it again." };
    }
    if (photo) set.photo_path = photo;
  } else {
    const artist = str("artist");
    if (artist.length > 120) return { ok: false, error: "the name of the singer or speaker must be 120 characters or fewer." };
    if (artist) set.artist = artist;
    const duration = parseDuration(str("duration"));
    if (duration === "bad") return { ok: false, error: "the length must look like 4:05 (minutes:seconds) or 1:02:03." };
    if (duration !== null) set.duration_seconds = duration;
    if (kind === "podcast") {
      const series = str("series");
      if (series.length > 120) return { ok: false, error: "the series name must be 120 characters or fewer." };
      if (series) set.series = series;
      const episode = wholeNumberIn(read, "episode", 1, 99999);
      if (episode === "bad") return { ok: false, error: "the episode must be a whole number (1, 2, 3…)." };
      if (episode !== null) set.episode = episode;
    }
    const source = str("source");
    if (source === "upload") {
      const path = str("media_path");
      if (path && path !== current.mediaPath && !isMediaObjectPath(centerId, kind, path)) {
        return { ok: false, error: "the file is not one uploaded for this community's library. Upload it again." };
      }
      if (path) {
        mediaPath = path;
        set.source = "upload";
      }
    } else if (source === "link") {
      if (str("media_url")) {
        const link = parseMediaLink(str("media_url"));
        if (!link.ok) return { ok: false, error: `${link.error}.` };
        mediaUrl = link.url;
        set.source = link.source;
        if (link.source === "youtube") set.youtube_id = link.youtubeId;
      }
    } else if (source) {
      return { ok: false, error: "choose where the recording comes from: an uploaded file or a link." };
    }
  }

  const clear = MEDIA_META_KEYS[kind].filter((k) => !(k in set));
  return { ok: true, fields: { language, bodyMd, mediaUrl, mediaPath, set, clear } };
}

/** What still stops an item from going to the approval queue (null = ready). Drafts may be incomplete. */
export function mediaReadyProblem(kind: MediaKind, f: Pick<MediaFields, "bodyMd" | "mediaUrl" | "mediaPath" | "set">): string | null {
  const hasRecording = Boolean(f.mediaUrl || f.mediaPath);
  if (kind === "stavan" && !hasRecording && !f.bodyMd) return "add the recording or the lyrics before sending it for approval.";
  if ((kind === "video" || kind === "podcast") && !hasRecording) return "add the recording (upload a file or paste a link) before sending it for approval.";
  if (kind === "recipe" && (!Array.isArray(f.set.ingredients) || f.set.ingredients.length === 0 || !f.bodyMd)) {
    return "add the ingredients and the method before sending it for approval.";
  }
  return null;
}

/** Plain-English reason a browser upload to a signed storage address failed (status 0: it never reached the server). */
export function explainUploadFailure(status: number, body: string): string {
  let message = "";
  let code = status;
  try {
    const j: unknown = JSON.parse(body);
    if (isObj(j)) {
      message = String(j.message ?? j.error ?? "");
      const inner = Number(j.statusCode);
      if (Number.isInteger(inner) && inner >= 400) code = inner;
    }
  } catch {
    message = body.slice(0, 200).trim();
  }
  if (status === 0) return "the upload could not reach the storage service — check your connection and try again";
  if (code === 413 || /maximum allowed size|too large/i.test(message)) {
    return "the file is larger than the storage area takes (50 MB). Upload big videos to YouTube and paste the link instead";
  }
  if (code === 415 || /mime ?type|not supported/i.test(message)) return "the storage area does not take this type of file";
  if (code === 409 || /already exists|duplicate/i.test(message)) return "a file with the same name was stored a moment ago — try again";
  if (code === 401 || code === 403 || /jwt|token|signature|expired/i.test(message)) return "the upload link expired or was refused — try again";
  if (code >= 500) return "the storage service had a problem — try again in a moment";
  return message ? message.replace(/[.\s]+$/, "") : `the storage service answered with status ${status}`;
}

// ---------------------------------------------------------------------------
// Practices (My Jain Way catalog)
// ---------------------------------------------------------------------------
export const PRACTICE_CATEGORIES = [
  { key: "mantra_jaap", label: "Mantra and jaap" },
  { key: "tapasya_pachchakhan", label: "Tapasya and pachchakhan" },
  { key: "darshan_puja", label: "Darshan and puja" },
  { key: "samayik_pratikraman", label: "Samayik and pratikraman" },
  { key: "swadhyay_learning", label: "Swadhyay and learning" },
  { key: "seva_daan", label: "Seva and daan" },
] as const;

export function practiceCategoryLabel(key: string): string {
  return PRACTICE_CATEGORIES.find((c) => c.key === key)?.label ?? key.replace(/_/g, " ");
}

/** "06:45:00" → "6:45 AM"; null → null. */
export function formatClock(time: string | null | undefined): string | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}

/** Practices with no clock time are relative to the sun (Navkarsi, Chauvihar) or "anytime". */
export function practiceDefaultTime(p: { key: string; default_time: string | null }): string {
  const clock = formatClock(p.default_time);
  if (clock) return clock;
  if (p.key === "navkarsi") return "Sunrise + 48 min";
  if (p.key === "chauvihar") return "Before sunset";
  return "Anytime";
}

// ---------------------------------------------------------------------------
// Points, streaks and Saathi (centers.rules.points.*)
// ---------------------------------------------------------------------------
export type PointsRules = {
  day_complete_bonus: number;
  anumodana_points: number;
  anumodana_daily_cap: number;
  support_points: number;
  behind_after_days: number;
  streak_rest_days_per_month: number;
};

/** Defaults the database functions use when a key is missing (0011, 0021). */
export const POINTS_DEFAULTS: PointsRules = {
  day_complete_bonus: 20,
  anumodana_points: 5,
  anumodana_daily_cap: 5,
  support_points: 3,
  behind_after_days: 3,
  streak_rest_days_per_month: 1,
};

export const POINTS_LIMITS: Record<keyof PointsRules, { min: number; max: number; label: string }> = {
  day_complete_bonus: { min: 0, max: 1000, label: "Day-complete bonus" },
  anumodana_points: { min: 0, max: 1000, label: "Anumodana points" },
  anumodana_daily_cap: { min: 0, max: 1000, label: "Anumodana daily limit" },
  support_points: { min: 0, max: 1000, label: "Saathi support points" },
  behind_after_days: { min: 1, max: 60, label: "“Behind” after" },
  streak_rest_days_per_month: { min: 0, max: 10, label: "Streak rest days" },
};

export function readPointsRules(rules: unknown): PointsRules {
  const p = isObj(rules) && isObj(rules.points) ? rules.points : {};
  const out = { ...POINTS_DEFAULTS };
  for (const k of Object.keys(POINTS_DEFAULTS) as (keyof PointsRules)[]) {
    const v = p[k];
    if (typeof v === "number" && Number.isInteger(v)) out[k] = v;
  }
  return out;
}

/** Validate typed values; returns the whole rules object with `points` updated (other keys untouched). */
export function mergePointsRules(
  rules: unknown,
  input: Record<string, string | null | undefined>,
): { ok: true; rules: Obj } | { ok: false; error: string } {
  const base: Obj = isObj(rules) ? { ...rules } : {};
  const points: Obj = isObj(base.points) ? { ...base.points } : {};
  for (const k of Object.keys(POINTS_LIMITS) as (keyof PointsRules)[]) {
    const raw = (input[k] ?? "").trim();
    const lim = POINTS_LIMITS[k];
    if (raw === "") return { ok: false, error: `${lim.label} is required.` };
    if (!/^\d+$/.test(raw)) return { ok: false, error: `${lim.label} must be a whole number.` };
    const n = Number(raw);
    if (n < lim.min || n > lim.max) return { ok: false, error: `${lim.label} must be between ${lim.min} and ${lim.max}.` };
    points[k] = n;
  }
  base.points = points;
  return { ok: true, rules: base };
}

// ---------------------------------------------------------------------------
// Daily timings (rule-based text in centers.rules.timings)
// ---------------------------------------------------------------------------
export type TimingRules = { derasar_hours: string; aarti: string; snatra_puja: string };

export function readTimingRules(rules: unknown): TimingRules {
  const t = isObj(rules) && isObj(rules.timings) ? rules.timings : {};
  const s = (k: string) => (typeof t[k] === "string" ? (t[k] as string) : "");
  return { derasar_hours: s("derasar_hours"), aarti: s("aarti"), snatra_puja: s("snatra_puja") };
}

export function mergeTimingRules(rules: unknown, input: Partial<TimingRules>): { ok: true; rules: Obj } | { ok: false; error: string } {
  const base: Obj = isObj(rules) ? { ...rules } : {};
  const t: Obj = isObj(base.timings) ? { ...base.timings } : {};
  for (const k of ["derasar_hours", "aarti", "snatra_puja"] as const) {
    const v = (input[k] ?? "").trim();
    if (v.length > 120) return { ok: false, error: "Each timing must be 120 characters or fewer." };
    if (v) t[k] = v;
    else delete t[k];
  }
  base.timings = t;
  return { ok: true, rules: base };
}

/** "HH:MM[:SS]" + minutes → "HH:MM" (same day, clamped to 23:59). */
export function addMinutesToClock(time: string, minutes: number): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const total = Math.min(23 * 60 + 59, Number(m[1]) * 60 + Number(m[2]) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Member Home line: "Sunrise 7:14 AM · Navkarsi 8:02 AM · Chauvihar by 7:21 PM". */
export function todayTimingLine(t: { sunrise: string | null; sunset: string | null; navkarsi: string | null; chauvihar: string | null } | null): string | null {
  if (!t || (!t.sunrise && !t.sunset)) return null;
  const parts: string[] = [];
  if (t.sunrise) parts.push(`Sunrise ${formatClock(t.sunrise)}`);
  const navkarsi = t.navkarsi ?? (t.sunrise ? addMinutesToClock(t.sunrise, 48) : null);
  if (navkarsi) parts.push(`Navkarsi ${formatClock(navkarsi)}`);
  const chauvihar = t.chauvihar ?? t.sunset;
  if (chauvihar) parts.push(`Chauvihar by ${formatClock(chauvihar)}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Photos (storage_path → bucket + object key)
// ---------------------------------------------------------------------------
export const PHOTO_BUCKET = "photos";

/**
 * Where a photo lives. A full URL is used as is. Otherwise the path is an
 * object key in the "photos" bucket, optionally written as "photos/<key>".
 */
export function photoLocation(storagePath: string): { kind: "url"; url: string } | { kind: "storage"; bucket: string; key: string } | null {
  const p = storagePath.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return { kind: "url", url: p };
  const key = p.replace(/^\/+/, "");
  if (key.startsWith(`${PHOTO_BUCKET}/`)) return { kind: "storage", bucket: PHOTO_BUCKET, key: key.slice(PHOTO_BUCKET.length + 1) };
  return { kind: "storage", bucket: PHOTO_BUCKET, key };
}

export const ALBUM_VISIBILITY_LABEL: Record<string, string> = { public: "Everyone", members: "Members", private: "Staff only" };

// ---------------------------------------------------------------------------
// Legal documents
// ---------------------------------------------------------------------------
export const LEGAL_KIND_LABEL: Record<string, string> = {
  privacy: "Privacy policy",
  terms: "Terms of use",
  volunteer_waiver: "Volunteer waiver",
  pathshala_waiver: "Pathshala waiver (parent signs)",
  photo_release: "Photo consent",
  children_consent: "Children's photo consent",
  disclaimer: "Notices and disclaimers",
  other: "Other document",
};

/** The member kinds a community can publish, in the order the portal lists them. */
export const MEMBER_LEGAL_KINDS = ["privacy", "terms", "disclaimer", "photo_release", "children_consent", "volunteer_waiver", "pathshala_waiver", "other"] as const;

/** How the member app's first-sign-in legal step asks for a document (legal_documents.member_step, 0422). */
export type MemberStep = "accept" | "consent" | "none";
export const MEMBER_STEP_LABEL: Record<MemberStep, string> = {
  accept: "Must accept to use the app",
  consent: "Asked yes or no (the answer is recorded)",
  none: "Not asked at sign-in",
};

export function isMemberStep(x: unknown): x is MemberStep {
  return x === "accept" || x === "consent" || x === "none";
}

/** The database's default for a kind (0422): privacy/terms/notices must be accepted; photo and children consent are a yes/no. */
export function defaultMemberStep(kind: string): MemberStep {
  if (kind === "privacy" || kind === "terms" || kind === "disclaimer") return "accept";
  if (kind === "photo_release" || kind === "children_consent") return "consent";
  return "none";
}

/** Plain-English note on what publishing a version does in the member app. */
export function publishEffect(step: MemberStep): string {
  if (step === "accept") return "Members are asked to accept it the next time they open the app, before they continue.";
  if (step === "consent") return "Members are asked yes or no the next time they open the app; their answer is recorded.";
  return "It is not asked at sign-in; signers are asked for the new version where it is required.";
}

/** "v3" → "v4", "3" → "4", "2026.1" → "2026.2"; unknown shapes get "-2". */
export function nextVersion(current: string | null | undefined): string {
  if (!current) return "v1";
  const m = /^(.*?)(\d+)$/.exec(current.trim());
  if (!m) return `${current.trim()}-2`;
  return `${m[1]}${Number(m[2]) + 1}`;
}

/** Compare document versions ("v10" after "v9"). */
export function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ---------------------------------------------------------------------------
// Gyan Path learner stats
// ---------------------------------------------------------------------------
/**
 * Per goal: learners = people with any completed step of the goal; completion
 * = share of those learners who completed every step of it.
 */
export function goalLearnerStats(
  stepsByGoal: Map<string, string[]>,
  progress: { person_id: string; step_id: string }[],
): Map<string, { learners: number; completionPct: number | null }> {
  const goalOfStep = new Map<string, string>();
  for (const [g, steps] of stepsByGoal) for (const s of steps) goalOfStep.set(s, g);
  const done = new Map<string, Map<string, Set<string>>>();
  for (const p of progress) {
    const g = goalOfStep.get(p.step_id);
    if (!g) continue;
    const byPerson = done.get(g) ?? new Map<string, Set<string>>();
    const set = byPerson.get(p.person_id) ?? new Set<string>();
    set.add(p.step_id);
    byPerson.set(p.person_id, set);
    done.set(g, byPerson);
  }
  const out = new Map<string, { learners: number; completionPct: number | null }>();
  for (const [g, steps] of stepsByGoal) {
    const byPerson = done.get(g) ?? new Map();
    const learners = byPerson.size;
    const complete = steps.length === 0 ? 0 : [...byPerson.values()].filter((s) => s.size >= steps.length).length;
    out.set(g, { learners, completionPct: learners ? Math.round((complete / learners) * 100) : null });
  }
  return out;
}

export type QuizQuestion = { question: string; options: string[]; answer: number };

/** Lengths the database allows in a quiz question (0570, app.gyan_quiz_problems); the step form uses the same. */
export const QUIZ_QUESTION_MAX = 500;
export const QUIZ_OPTION_MAX = 200;
export const QUIZ_MAX_OPTIONS = 6;
/** The answers box: up to QUIZ_MAX_OPTIONS lines of up to QUIZ_OPTION_MAX characters. */
export const QUIZ_OPTIONS_TEXT_MAX = QUIZ_MAX_OPTIONS * (QUIZ_OPTION_MAX + 1);

/** Characters as the database counts them (char_length: code points, so an emoji is one). */
const charCount = (s: string) => Array.from(s).length;

/**
 * One multiple-choice question from the step form (gyan_steps.quiz jsonb:
 * {questions:[{question, options, answer}]}, answer = index of the right option,
 * the shape the member app reads). Options: one per line; answer: 1-based.
 */
export function quizFromFields(
  question: string | null,
  optionsText: string | null,
  answerText: string | null,
): { ok: true; quiz: { questions: QuizQuestion[] } | null } | { ok: false; error: string } {
  const q = (question ?? "").trim();
  const options = (optionsText ?? "")
    .split(/\r?\n/)
    .map((o) => o.trim())
    .filter(Boolean);
  if (!q && options.length === 0) return { ok: true, quiz: null };
  if (!q) return { ok: false, error: "write the quiz question" };
  if (charCount(q) > QUIZ_QUESTION_MAX) {
    return { ok: false, error: `shorten the question to at most ${QUIZ_QUESTION_MAX} characters (it has ${charCount(q)})` };
  }
  if (options.length < 2) return { ok: false, error: "give at least two answers, one per line" };
  if (options.length > QUIZ_MAX_OPTIONS) return { ok: false, error: "use at most six answers" };
  const long = options.findIndex((o) => charCount(o) > QUIZ_OPTION_MAX);
  if (long >= 0) {
    return { ok: false, error: `shorten answer ${long + 1} to at most ${QUIZ_OPTION_MAX} characters (it has ${charCount(options[long])})` };
  }
  const n = Number((answerText ?? "").trim());
  if (!Number.isInteger(n) || n < 1 || n > options.length) return { ok: false, error: `say which answer is right (1 to ${options.length})` };
  return { ok: true, quiz: { questions: [{ question: q, options, answer: n - 1 }] } };
}

// ---------------------------------------------------------------------------
// Gyan Path steps: kinds, activity payloads and quiz types (0570). Read-only
// summaries for the editor; the database checks the shapes on every write
// (app.gyan_activity_problems / app.gyan_quiz_problems).
// ---------------------------------------------------------------------------
const GYAN_KIND_LABEL: Record<string, string> = {
  read: "Learn",
  listen: "Listen",
  recite: "Recite",
  quiz: "Quiz",
  video: "Video",
  practice: "Practice",
  hotspot: "Tap the spots",
  voice: "Say it aloud",
};

/** "Learn", "Quiz", "Tap the spots · practice", "Say it aloud"; an unknown kind is shown as stored. */
export function gyanStepKindLabel(kind: string, activity?: unknown): string {
  const base = GYAN_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
  if (kind === "hotspot" && isObj(activity) && (activity.mode === "learn" || activity.mode === "practice")) return `${base} · ${activity.mode}`;
  return base;
}

const QUIZ_TYPE_LABEL: Record<string, string> = {
  choice: "multiple choice",
  truefalse: "true or false",
  order: "put in order",
  match: "match the pairs",
  fill: "fill the gap",
};

/** The quiz's questions by type, in first-seen order: {questions:[...]} or the older bare list; no type = choice. */
export function quizTypeCounts(quiz: unknown): { type: string; label: string; count: number }[] {
  const list = Array.isArray(quiz) ? quiz : isObj(quiz) && Array.isArray(quiz.questions) ? quiz.questions : [];
  const counts = new Map<string, number>();
  for (const q of list) {
    if (!isObj(q)) continue;
    const t = typeof q.type === "string" && q.type ? q.type : "choice";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, label: QUIZ_TYPE_LABEL[type] ?? type, count }));
}

function listLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a step holds, in a few words: "3 questions: 2 multiple choice, 1 put in order", "4 cards", "9 spots", "5 verses · hi-IN". */
export function gyanStepDetail(step: { kind: string; activity?: unknown; quiz?: unknown }): string | null {
  const a = isObj(step.activity) ? step.activity : {};
  if (step.kind === "quiz") {
    const types = quizTypeCounts(step.quiz);
    const total = types.reduce((s, t) => s + t.count, 0);
    if (!total) return null;
    return `${plural(total, "question")}: ${types.map((t) => `${t.count} ${t.label}`).join(", ")}`;
  }
  if (step.kind === "hotspot") {
    const n = listLength(a.spots);
    return n ? plural(n, "spot") : null;
  }
  if (step.kind === "voice") {
    const n = listLength(a.verses);
    if (!n) return null;
    return typeof a.lang === "string" && a.lang ? `${plural(n, "verse")} · ${a.lang}` : plural(n, "verse");
  }
  const cards = listLength(a.cards);
  return cards ? plural(cards, "card") : null;
}

/** Marked by its author as waiting for the Pathshala's review (activity.review). */
export function gyanNeedsReview(activity: unknown): boolean {
  return isObj(activity) && activity.review === "needs_pathshala_review";
}

/** "10 points + 3 a try", "5 points", "3 a try" or "" (no points). */
export function gyanStepPointsText(points: number | null | undefined, repeatPoints: number | null | undefined): string {
  const p = points ?? 0;
  const r = repeatPoints ?? 0;
  if (p > 0 && r > 0) return `${plural(p, "point")} + ${r} a try`;
  if (p > 0) return plural(p, "point");
  if (r > 0) return `${r} a try`;
  return "";
}

/** Questions across a level's quiz steps (each step can hold several). */
export function quizQuestionCount(steps: { kind: string; quiz?: unknown }[]): number {
  return steps.filter((s) => s.kind === "quiz").reduce((sum, s) => sum + quizTypeCounts(s.quiz).reduce((n, t) => n + t.count, 0), 0);
}

type GyanStepContent = { kind: string; activity?: unknown; quiz?: unknown };

/** The level carries its own text in the lesson (0570): learn cards, a tap-the-spots picture, or voice verses. */
export function gyanLevelHasLessonContent(steps: GyanStepContent[]): boolean {
  return steps.some((s) => (s.kind === "read" || s.kind === "hotspot" || s.kind === "voice") && gyanStepDetail(s) !== null);
}

export type GyanLevelAudio = "recorded" | "to_record" | "in_lesson" | "not_needed";

/**
 * The levels table's Audio column. Listen and recite steps play a Library recording, so they need one ("recorded",
 * "to_record"). Without them there is nothing to record: voice verses play in the lesson (their own audio, or the
 * phone reads them aloud), and any other level has no audio at all.
 */
export function gyanLevelAudio(steps: GyanStepContent[], recorded: boolean): GyanLevelAudio {
  if (steps.some((s) => s.kind === "listen" || s.kind === "recite")) return recorded ? "recorded" : "to_record";
  return steps.some((s) => s.kind === "voice" && gyanStepDetail(s) !== null) ? "in_lesson" : "not_needed";
}
