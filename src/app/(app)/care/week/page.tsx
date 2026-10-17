import type { Metadata } from "next";
import Link from "next/link";

import { Alert, Card, PageHeader, buttonClass } from "@/components/ui";
import { WeekTaskCard } from "@/components/care/week-task";
import { NO_ACCESS } from "@/lib/care/model";
import { draftFor, weekLine } from "@/lib/care/week";
import { loadWeek, seesCare } from "@/lib/data/care";
import { kindName } from "@/lib/kind";
import { careCan } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Your week" };

// "Your 5 this week" (DonorDelight slice 5): up to five tasks for the households you own or back up, each with why, a ready draft and one tap to
// say it is done. Tasks come from the playbooks (a first gift, a new household, a household that is cooling...) and the thank-yous waiting. A
// draft is yours to send; Weaver sends nothing. No amount appears. The database decides who has which task (app.care_week, 0892: no
// platform-admin branch) and logs the read.

export default async function WeekPage() {
  const session = await getSession();
  const label = kindName(session.kind, "care", "DonorDelight");
  const header = <PageHeader title={`${label}: your week`} description="A few relationships to look after this week, each with why and a draft you can use. You send it; Weaver sends nothing." />;
  const card = (title: string, body?: string) => (
    <>
      {header}
      <div className="cc-card px-6 py-10 text-center">
        <p className="font-display text-[22px] font-semibold text-ink">{title}</p>
        {body ? <p className="mx-auto mt-2 max-w-lg text-[13px] text-muted">{body}</p> : null}
      </div>
    </>
  );

  if (!seesCare(session)) return card(NO_ACCESS, `${label} is open only to the roles your organization gives it. Ask your organization's owner or care lead.`);

  const read = await loadWeek(session);
  if (read.status === "no_access") return card(NO_ACCESS);
  if (read.status === "off") return card(read.message);
  if (read.status === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load your week"
          action={
            <a href="/care/week" className={buttonClass("bad", "xs")}>
              Try again
            </a>
          }
        >
          {read.error.charAt(0).toUpperCase() + read.error.slice(1).replace(/\.?$/, ".")}
        </Alert>
      </>
    );
  }

  const w = read.data;
  const manage = careCan(session, "manage");
  const more = w.total - w.tasks.length;
  return (
    <>
      {header}
      <p className="m-0 mb-3 text-[15px] font-semibold text-ink" role="status">
        {weekLine(w)}
      </p>
      {w.needsOwner > 0 && careCan(session, "view") ? (
        <div className="mb-3">
          <Alert tone="warning" title={`${w.needsOwner} ${w.needsOwner === 1 ? "household has" : "households have"} a task and no relationship owner`}>
            Nobody sees these tasks until someone owns the household.{" "}
            <Link href="/care?show=needs_owner" className="crm-link font-semibold">
              Choose owners
            </Link>
          </Alert>
        </div>
      ) : null}
      {w.tasks.length === 0 ? (
        <Card>
          <p className="m-0 text-[14px] text-ink-2">
            {w.playbooks === 0
              ? manage
                ? "There are no playbooks yet, so no household has a task. Add the starter playbooks to begin."
                : "There are no playbooks yet, so no household has a task. Someone who manages this area adds them."
              : "Nothing waits for you this week. Tasks appear when a household enters one of your playbooks and you own it."}{" "}
            <Link href="/care/playbooks" className="crm-link font-semibold">
              See the playbooks
            </Link>
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {w.tasks.map((t) => (
            <WeekTaskCard key={`${t.runId ?? t.thankId}:${t.stepId ?? ""}`} task={t} draft={draftFor(t, w)} today={w.today} />
          ))}
          {more > 0 ? (
            <p className="m-0 text-[13.5px] text-muted">
              {more} more {more === 1 ? "task is" : "tasks are"} waiting. They appear as you finish these.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}
