// What Giving's Pledges and Payments tabs share around their rows: the header with the tab row, chips that scroll sideways on a
// phone, problems said in plain English, the states of the list area (no access, switched off, an error with a retry) and paging.
// No hooks: drawn on the server, with the rows and the search as client parts.

import Link from "next/link";
import type { ReactNode } from "react";

import { RecordPaymentButton } from "@/components/giving-actions/provider";
import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { Alert, NoAccess, buttonClass } from "@/components/ui";
import type { GivingTabKey } from "@/lib/giving-today/tabs";
import type { ListBody, ListsCommon, Pager } from "@/lib/giving-lists/model";
import type { Chip } from "@/lib/giving-lists/types";

export function ListHeader({ model, active, description }: { model: ListsCommon; active: GivingTabKey; description: string }) {
  return (
    <header className="mb-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
          <p className="m-0 text-[14px] text-muted">{description}</p>
        </div>
        {/* The sheet in place where the New-look shell mounts it; `recordHref` (?record=1) without it. */}
        {model.recordHref ? (
          <RecordPaymentButton href={model.recordHref} className={`${buttonClass("primary", "sm")} min-h-[44px]`}>
            Record payment
          </RecordPaymentButton>
        ) : null}
      </div>
      <GivingTabRow tabs={model.tabs} active={active} />
    </header>
  );
}

export function ChipRow({ chips, label }: { chips: Chip[]; label: string }) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
      <ul className="m-0 flex w-max list-none gap-1.5 p-0 md:w-auto md:flex-wrap">
        {chips.map((c) => (
          <li key={c.key || "all"} className="flex-none">
            <Link href={c.href} aria-current={c.on ? "page" : undefined} className="cc-chip min-h-[40px] whitespace-nowrap">
              {c.label}
              {c.count !== null ? <span className="ml-1.5 tabular-nums opacity-80">{c.count.toLocaleString("en-US")}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Problems({ problems, note }: { problems: string[]; note: string | null }) {
  if (problems.length === 0 && !note) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {note ? <Alert tone="info">{note}</Alert> : null}
      {problems.map((p) => (
        <Alert key={p} tone="warning">
          {p}
        </Alert>
      ))}
    </div>
  );
}

/** The list area when there are no rows to draw: never an empty table. */
export function BodyState({ body }: { body: Exclude<ListBody, { state: "ok" }> }) {
  if (body.state === "no_access") return <NoAccess area={body.area} access={body.access} />;
  if (body.state === "off") {
    return (
      <div className="cc-card px-6 py-10 text-center" data-testid="view-switched-off">
        <p className="font-display text-[22px] font-semibold text-ink">{body.title}</p>
        <p role="status" className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
          {body.message}
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-[14px] border border-[#f0b9b4] bg-danger-50 px-4 py-3 text-[14px] text-[#7a1a14]">
      {body.error}{" "}
      <Link href={body.retry} className="font-bold underline">
        Try again
      </Link>
    </div>
  );
}

export function PagerNav({ pager }: { pager: Pager | null }) {
  if (!pager) return null;
  return (
    <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
      <span>{pager.label}</span>
      <span className="flex gap-2">
        {pager.prev ? (
          <Link href={pager.prev} className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
            Previous 50
          </Link>
        ) : null}
        {pager.next ? (
          <Link href={pager.next} className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
            Next 50
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function ListCard({ children }: { children: ReactNode }) {
  return <section className="rounded-[18px] border border-line bg-white px-3.5 py-3.5 md:px-5">{children}</section>;
}
