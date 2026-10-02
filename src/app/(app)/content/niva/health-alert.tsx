import Link from "next/link";

import { Alert, buttonClass } from "@/components/ui";
import type { NivaHealthView, NivaUsage } from "@/lib/niva";

import { RetryAllUnansweredButton } from "./retry-buttons";

/**
 * The top of Content › Niva, from app.niva_health (0572): an alert when the background service is
 * not running, Niva's answering job is not set up, questions failed in the last 24 hours or are
 * waiting out the AI service's spending limit. Nothing when all is well.
 */
export function NivaHealthAlert({ view, canRetry }: { view: NivaHealthView; canRetry: boolean }) {
  if (view.problems.length === 0) return null;
  const danger = view.problems.some((p) => p.tone === "danger");
  const retry = canRetry && view.problems.some((p) => p.retry);
  const [first, ...rest] = view.problems;
  return (
    <Alert
      tone={danger ? "danger" : "warning"}
      title={first.title}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {retry ? <RetryAllUnansweredButton size="xs" /> : null}
          <Link href="/settings/integrations" className={buttonClass(danger ? "bad" : "ghost", "xs")}>
            Background service in Settings › Integrations
          </Link>
        </div>
      }
    >
      <p>{first.detail}</p>
      {rest.map((p) => (
        <p key={p.title} className="mt-2">
          <span className="font-bold">{p.title}.</span> {p.detail}
        </p>
      ))}
    </Alert>
  );
}

/** "142 of 300 questions this month", as a warning from 80 % of niva.monthly_questions. */
export function NivaUsageLine({ usage }: { usage: NivaUsage }) {
  if (usage.level === "full") {
    return (
      <Alert tone="danger" title={`Niva has reached this month's limit: ${usage.label}`}>
        Members can&apos;t ask Niva anything more until the 1st of next month. The limit (niva.monthly_questions) is shown in Settings › Limits.
      </Alert>
    );
  }
  if (usage.level === "warn") {
    return (
      <Alert tone="warning" title={`${usage.label} (${Math.round((usage.pct ?? 0) * 100)}% of the limit)`}>
        When the limit is reached, members can&apos;t ask Niva anything more until the 1st of next month. The limit (niva.monthly_questions) is shown in Settings › Limits.
      </Alert>
    );
  }
  return <p className="text-[13px] text-muted">{usage.label}</p>;
}
