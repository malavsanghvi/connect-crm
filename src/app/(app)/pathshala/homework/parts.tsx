import type { SignedFile } from "@/lib/gyan-homework/db";
import { fileLabel, fileRemoved, type Submission, type SubmissionFile } from "@/lib/gyan-homework/homework";

import { PhotoLightbox } from "./photo-lightbox";

/**
 * The parts of one answer, as the reviewer sees them: photos as thumbnails that open full size, voice notes in a
 * player, files as a download, the written answer as text. A part whose file is gone (retention) or cannot be
 * signed says so instead of disappearing. Never the storage path: it carries ids.
 */
export function SubmissionParts({ submission, signed, learner }: { submission: Submission; signed: ReadonlyMap<string, SignedFile>; learner: string }) {
  const files = submission.files;
  if (!files.length && !submission.text_answer) return <p className="text-[13px] text-muted">Nothing was attached to this answer.</p>;
  return (
    <div className="flex flex-col gap-2">
      {files.length ? (
        <ul className="flex flex-wrap items-start gap-3">
          {files.map((f, i) => (
            <li key={f.id} className="max-w-full">
              <FilePart file={f} signed={f.storage_path ? signed.get(f.storage_path) : undefined} index={i + 1} learner={learner} />
            </li>
          ))}
        </ul>
      ) : null}
      {submission.text_answer ? (
        <blockquote className="cc-info whitespace-pre-wrap text-[13px] text-ink">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.04em] text-muted">Written answer</span>
          {submission.text_answer}
        </blockquote>
      ) : null}
    </div>
  );
}

function FilePart({ file, signed, index, learner }: { file: SubmissionFile; signed: SignedFile | undefined; index: number; learner: string }) {
  const label = fileLabel(file);
  if (fileRemoved(file)) {
    return (
      <p className="text-xs text-muted">
        {label} — the file was removed after the retention period; the answer, note and points stay.
      </p>
    );
  }
  if (!signed?.url) {
    return (
      <p className="text-xs text-danger">
        {label} — {signed?.problem ?? "preview unavailable: the file could not be signed."}
      </p>
    );
  }
  if (file.kind === "photo") {
    return (
      <div className="flex flex-col gap-1">
        <PhotoLightbox src={signed.url} alt={`${label} ${index} from ${learner}`} />
        <span className="text-xs text-muted">{label}</span>
      </div>
    );
  }
  if (file.kind === "voice") {
    return (
      <div className="flex flex-col gap-1">
        <audio controls preload="none" src={signed.url} className="h-10 max-w-[280px]" aria-label={`${label} from ${learner}`} />
        <span className="text-xs text-muted">{label}</span>
      </div>
    );
  }
  // A signed URL is cross-origin, where the browser ignores `download`: a new tab keeps a half-typed note on this
  // page, and the URL itself was signed with Content-Disposition: attachment (signHomeworkFiles).
  return (
    <a href={signed.url} target="_blank" rel="noreferrer" className="crm-link text-[13px] font-semibold">
      Download: {label}
    </a>
  );
}
