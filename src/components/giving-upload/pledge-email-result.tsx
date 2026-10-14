"use client";

// What a pledge upload did about the emails (0793): how many families were emailed, how many had no email address on file, how many could
// not be sent (with the reason), and which pledges were held back and why. The emails leave a moment after the pledges are recorded, so
// the panel asks the database again every few seconds until nothing is waiting, and never says "emailed" for one that is not. When the
// answer cannot be read it says so, with a retry. Nothing here sends anything.

import { useCallback, useEffect, useState } from "react";

import { Alert, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { emailHeadline, emailProblemLines, emailsSettled, summarizeEmails, type PledgeEmailStatus } from "@/lib/pledge-email/bulk";

/** How often, and for how long, the panel asks again. */
export const RESULT_POLL_MS = 3000;
export const RESULT_POLL_TRIES = 40;

export type EmailedPledgeRef = { pledgeId: string; number: string | null; label: string };

export function PledgeEmailResult({
  requested,
  pledges,
  status,
}: {
  /** The box "Email each family their pledge" was ticked. */
  requested: boolean;
  pledges: EmailedPledgeRef[];
  status: (pledgeIds: string[]) => Promise<ActionResult<PledgeEmailStatus[]>>;
}) {
  const [list, setList] = useState<PledgeEmailStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // The pledges of this upload, fixed when the result first shows.
  const [ids] = useState(() => pledges.map((p) => p.pledgeId));

  const load = useCallback(async () => {
    try {
      const res = await status(ids);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setList(res.data ?? []);
    } catch (err) {
      console.error("[pledge upload] checking the emails failed:", err);
      setError("Could not check the emails — the server did not respond. Try again.");
    }
  }, [status, ids]);

  const summary = list ? summarizeEmails(list) : null;
  const settled = summary ? emailsSettled(summary) : false;

  useEffect(() => {
    if (!requested || ids.length === 0) return;
    if (settled || tries >= RESULT_POLL_TRIES) return;
    const t = window.setTimeout(
      () => {
        void load().finally(() => setTries((n) => n + 1));
      },
      list === null && tries === 0 ? 0 : RESULT_POLL_MS,
    );
    return () => window.clearTimeout(t);
  }, [requested, ids, settled, tries, attempt, list, load]);

  if (!requested) {
    return (
      <Alert tone="info" title="The families were not emailed">
        You chose not to email the families. Each pledge&apos;s History says so. To email one later, open ⋯ › Email… on the pledge.
      </Alert>
    );
  }
  if (ids.length === 0) return null;
  if (error && !list) {
    return (
      <Alert
        tone="warning"
        title="Could not read how the emails went"
        action={
          <button
            type="button"
            className={buttonClass("ghost", "xs")}
            onClick={() => {
              setError(null);
              setTries(0);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        }
      >
        {error} The pledges were recorded; each pledge&apos;s History shows what was done about its email.
      </Alert>
    );
  }
  if (!summary || !list) {
    return (
      <p role="status" className="m-0 text-[14px] text-muted">
        Checking the emails…
      </p>
    );
  }
  const byId = new Map(pledges.map((p) => [p.pledgeId, p]));
  const problems = emailProblemLines(list, (e) => {
    const ref = byId.get(e.pledgeId);
    return `${e.number ?? ref?.number ?? "A pledge"}${ref?.label ? ` (${ref.label})` : ""}`;
  });
  const tone = summary.failed > 0 ? "warning" : summary.noEmail > 0 ? "info" : settled ? "success" : "info";
  return (
    <section className="flex flex-col gap-2" aria-label="Emails to the families" data-testid="pledge-email-result">
      <Alert
        tone={tone}
        title={emailHeadline(summary, true)}
        action={
          settled ? null : (
            <button
              type="button"
              className={buttonClass("ghost", "xs")}
              onClick={() => {
                setTries(0);
                setAttempt((n) => n + 1);
              }}
            >
              Check again
            </button>
          )
        }
      >
        {settled
          ? "Each email carries the pledge as a PDF with the community's branding, and went to the household's primary member."
          : tries >= RESULT_POLL_TRIES
            ? "Some emails are taking longer than usual. Check again in a few minutes; Messages shows every email."
            : "The emails leave a moment after the pledges are recorded. This updates by itself."}
      </Alert>
      {error ? <p role="alert" className="m-0 text-[13px] text-danger">{error}</p> : null}
      {problems.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-field border border-line bg-white p-3 text-[13.5px] text-ink-2" data-testid="pledge-email-problems">
          {problems.map((p, i) => (
            <li key={`${i}-${p.text}`} className={p.state === "failed" ? "font-semibold text-danger" : undefined}>
              {p.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
