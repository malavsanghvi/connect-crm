import Link from "next/link";
import type { ReactNode } from "react";

import { waitingCount, type InboxModel } from "@/lib/people-v2/inbox";

import { InboxList } from "./inbox-rows";

// The People home's Inbox, as drawn in docs/PEOPLE_REDESIGN.md section 4: what waits for a decision, decided where it is listed.
// Membership applications and family change requests are decided in the row; possible duplicates open the side-by-side comparison
// (the list that already compares and merges). Each part says plainly when it is empty or cannot be read, never a blank.

const CARD = "rounded-[18px] border border-line bg-white";

function Group({ title, count, children }: { title: string; count: number | null; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="m-0 text-[13px] font-bold uppercase tracking-[0.04em] text-muted">
        {title}
        {count !== null ? ` · ${count}` : ""}
      </h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 text-[13.5px] text-muted">{children}</p>;
}

export function InboxSection({ model }: { model: InboxModel }) {
  const waiting = waitingCount(model);
  const hiddenApps = model.applicationsTotal !== null && model.applicationsTotal > model.applications.length;
  const hiddenReqs = model.requestsTotal - model.forScreen > model.requests.length;
  return (
    <section aria-label="Inbox" className={`${CARD} flex flex-col gap-4 p-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 font-display text-[20px] font-semibold text-ink">Inbox</h2>
        {waiting > 0 ? <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-[12px] font-bold text-navy">{waiting} waiting</span> : null}
        <span className="text-[12px] text-muted">What waits for a decision, oldest first</span>
      </div>

      {model.note ? <Empty>{model.note}</Empty> : null}

      {model.applicationsTotal !== null ? (
        <Group title="Membership applications" count={model.applicationsTotal}>
          {model.applications.length > 0 ? <InboxList rows={model.applications} roles={model.roles} /> : <Empty>No applications are waiting.</Empty>}
          {hiddenApps ? (
            <Empty>
              Showing the oldest {model.applications.length} of {model.applicationsTotal}. The rest are on the{" "}
              <Link href={model.applicationsHref} className="font-semibold text-navy">
                applications screen
              </Link>
              .
            </Empty>
          ) : null}
        </Group>
      ) : null}

      <Group title="Family change requests" count={model.requestsTotal}>
        {model.requests.length > 0 ? <InboxList rows={model.requests} roles={model.roles} /> : model.forScreen === 0 ? <Empty>No family requests are waiting.</Empty> : null}
        {hiddenReqs ? (
          <Empty>
            Showing the oldest {model.requests.length}. The rest are on the{" "}
            <Link href={model.requestsHref} className="font-semibold text-navy">
              family requests screen
            </Link>
            .
          </Empty>
        ) : null}
        {model.forScreen > 0 ? (
          <Empty>
            {model.forScreen === 1 ? "1 more request is" : `${model.forScreen} more requests are`} decided on the{" "}
            <Link href={model.requestsHref} className="font-semibold text-navy">
              family requests screen
            </Link>
            : they mention a child.
          </Empty>
        ) : null}
      </Group>

      {model.duplicates ? (
        <Group title="Possible duplicates" count={model.duplicates.count}>
          <Link
            href={model.duplicates.href}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-line px-4 py-3 no-underline hover:border-navy"
          >
            <span className="text-[14px] text-ink">
              {model.duplicates.count === null
                ? "Could not be counted just now."
                : model.duplicates.count === 0
                  ? "No suggestions are waiting."
                  : `${model.duplicates.count} pair${model.duplicates.count === 1 ? "" : "s"} that may be the same: compare side by side, then merge or mark as different.`}
            </span>
            <span className="text-[13.5px] font-bold text-navy">Open</span>
          </Link>
        </Group>
      ) : null}

      {waiting === 0 && model.forScreen === 0 && model.duplicates?.count !== null ? <Empty>Nothing is waiting for a decision.</Empty> : null}
    </section>
  );
}

/** The Inbox could not be read: say so with the reason and a way to try again. Never an empty box that looks like "nothing waiting". */
export function InboxError({ message }: { message: string }) {
  return (
    <section aria-label="Inbox" className={`${CARD} flex flex-col gap-2 p-4`}>
      <h2 className="m-0 font-display text-[20px] font-semibold text-ink">Inbox</h2>
      <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
        Could not load what is waiting for a decision. {message}
      </p>
      <Link href="/people" className="self-start text-[13.5px] font-bold text-navy hover:underline">
        Try again
      </Link>
    </section>
  );
}
