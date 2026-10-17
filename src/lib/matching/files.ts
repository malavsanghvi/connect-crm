// CatchTheMatch Phase 1, piece 4 (migration 0928): a file or screenshot for a library entry. Pure: no React, no database, so what a person is told before
// an upload starts is what the tests check. The database decides again (app.add_match_process_file and the bucket's policies).

import { fileSize } from "@/lib/pledge-evidence";

/** The bucket's own limits (0928): a phone photo of a form is a JPEG; HEIC is not accepted here. */
export const LIBRARY_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const LIBRARY_MAX_BYTES = 10 * 1024 * 1024;
export const LIBRARY_MAX_FILES = 6;
export const LIBRARY_BUCKET = "match-library";

export const FILE_KINDS = ["form", "screenshot", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_LABEL: Record<FileKind, string> = { form: "Form", screenshot: "Screenshot", other: "File" };
export const isFileKind = (v: unknown): v is FileKind => typeof v === "string" && (FILE_KINDS as readonly string[]).includes(v);

const BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const EXTENSION_OF: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const TYPE_LABEL: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP", "application/pdf": "PDF" };

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

export type LibraryFileCheck = { ok: true; contentType: string } | { ok: false; error: string };

/** Whether a file can be added to an entry, in words. `live` is how many live files the entry already has. */
export function checkLibraryFile(file: { name: string; type: string; size: number }, live = 0): LibraryFileCheck {
  if (live >= LIBRARY_MAX_FILES) return { ok: false, error: `An entry can have up to ${LIBRARY_MAX_FILES} files. Remove one first.` };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "The file is empty." };
  if (file.size > LIBRARY_MAX_BYTES) return { ok: false, error: `The file is ${fileSize(file.size)}. A file can be at most 10 MB.` };
  const declared = file.type.trim().toLowerCase();
  const contentType = (LIBRARY_FILE_TYPES as readonly string[]).includes(declared) ? declared : declared === "" ? (BY_EXTENSION[extensionOf(file.name)] ?? "") : "";
  if (!contentType) return { ok: false, error: "Add a JPEG, PNG or WebP picture or a PDF. A phone photo can be saved as a JPEG." };
  return { ok: true, contentType };
}

/** <entry id>/<file id>.<ext>: no community (the library is shared), a lowercase uuid and a short lowercase extension (the bucket's policy checks the same shape). */
export function libraryObjectPath(programId: string, fileId: string, contentType: string): string {
  return `${programId.toLowerCase()}/${fileId.toLowerCase()}.${EXTENSION_OF[contentType] ?? "bin"}`;
}

export type ProcessFile = {
  id: string;
  kind: FileKind;
  caption: string;
  contentType: string;
  bytes: number;
  path: string;
  addedAt: string | null;
  /** A link that lasts one hour, made when the page is drawn (null when it could not be made). */
  url: string | null;
};

/** "Form · PDF · 120 KB". */
export function fileLine(f: Pick<ProcessFile, "kind" | "contentType" | "bytes">): string {
  return `${FILE_KIND_LABEL[f.kind]} · ${TYPE_LABEL[f.contentType] ?? "File"} · ${fileSize(f.bytes)}`;
}

/** The caption and the kind from the form, checked (the database checks again). */
export function libraryFileFromForm(input: { kind: unknown; caption: unknown; reason: unknown }): { ok: true; kind: FileKind; caption: string; reason: string } | { ok: false; error: string } {
  if (!isFileKind(input.kind)) return { ok: false, error: "Say what the file is: a form, a screenshot or something else." };
  const caption = String(input.caption ?? "").replace(/\s+/g, " ").trim();
  if (!caption) return { ok: false, error: "Give the file a short caption: what it shows." };
  if (caption.length > 200) return { ok: false, error: "The caption can be at most 200 characters." };
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  if (!reason) return { ok: false, error: "Say why you are adding it. It goes in the library's history." };
  return { ok: true, kind: input.kind, caption, reason };
}
