import type { ReactNode } from "react";

import { NoAccess, PageHeader, StatusText } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { stepStatusLabel, stepStatusTone } from "@/lib/setup";

/** The Setup module's title block (module tabs underneath). */
export function SetupHeader({ session, sub, actions }: { session: CrmSession; sub: string; actions?: ReactNode }) {
  return <PageHeader title="Setup" description={`${session.center.short_name || session.center.name} · ${sub}`} actions={actions} />;
}

/** Setup is for settings.manage holders (the owner is also allowed by the database). */
export function setupGate(session: CrmSession, sub: string, area: string): ReactNode | null {
  if (canAccess(session, "setup")) return null;
  return (
    <>
      <SetupHeader session={session} sub={sub} />
      <NoAccess area={area} access="setup" />
    </>
  );
}

export function StepStatus({ status }: { status: string }) {
  const tone = stepStatusTone(status);
  if (tone === "muted") return <span className="whitespace-nowrap font-semibold text-muted">{stepStatusLabel(status)}</span>;
  return <StatusText tone={tone}>{stepStatusLabel(status)}</StatusText>;
}

/** Progress bar with words beside it (never colour alone). */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${done} of ${total} done`}>
      <div className="h-2 w-28 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-[12px] font-semibold text-muted">
        {done} of {total} done
      </span>
    </div>
  );
}
