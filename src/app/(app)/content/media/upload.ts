// Browser only: send one file to a signed Storage upload address (from
// prepareMediaUploadAction). The same multipart request storage-js's
// uploadToSignedUrl makes, sent with XMLHttpRequest so the drawer can show
// progress on a 50 MB recording. The signed address carries the permission;
// nothing here holds a secret.

import { explainUploadFailure } from "@/lib/content";

export type UploadProgress = { loaded: number; total: number };
export type UploadResult = { ok: true } | { ok: false; error: string; cancelled?: boolean };

export function uploadToSignedUrl(opts: {
  signedUrl: string;
  file: File;
  contentType: string;
  /** The project's public (anon) key, sent as Supabase's gateway expects on every request. */
  apiKey: string | null;
  onProgress: (p: UploadProgress) => void;
  signal: AbortSignal;
}): Promise<UploadResult> {
  return new Promise((resolve) => {
    if (opts.signal.aborted) {
      resolve({ ok: false, error: "the upload was cancelled", cancelled: true });
      return;
    }
    // Store the file under the type it was checked as (browsers name some formats differently).
    const file = opts.file.type === opts.contentType ? opts.file : new File([opts.file], opts.file.name, { type: opts.contentType });
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file, opts.file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.signedUrl);
    if (opts.apiKey) xhr.setRequestHeader("apikey", opts.apiKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress({ loaded: e.loaded, total: e.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve({ ok: true });
      else {
        console.error("[content/media] upload refused:", xhr.status, xhr.responseText.slice(0, 500));
        resolve({ ok: false, error: explainUploadFailure(xhr.status, xhr.responseText) });
      }
    };
    xhr.onerror = () => {
      console.error("[content/media] upload failed: the storage service could not be reached");
      resolve({ ok: false, error: explainUploadFailure(0, "") });
    };
    xhr.onabort = () => resolve({ ok: false, error: "the upload was cancelled", cancelled: true });
    opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
