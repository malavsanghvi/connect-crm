"use client";

import { useId, useState } from "react";

import { tierLabel } from "@/lib/people";
import {
  CHANGE_NEEDS,
  liveOf,
  periodText,
  statusView,
  type MembershipsData,
} from "@/lib/people-v2/memberships";
import { NO_ACCESS_TEXT, type Part } from "@/lib/people-v2/slideover";

import { Chip } from "../family/person-card";

import { AssignPanel, EditPanel, TierPanel, type AssignStart, type EditStart, type MembershipActions, type TierStart } from "./membership-panels";
import { PartNote } from "./section";

// The Memberships section of the person slide-over (docs/PEOPLE_REDESIGN.md section 4). Each membership of the person and of their
// family shows its tier, status, dates, the family's card line (never a name alone), who holds it and its note. A person who holds
// BOTH people.approve and people.manage also sees, on each row, "Edit dates and notes"; on the family's live membership "Change tier";
// and under the list "Assign a membership". Everyone else sees the list read-only, with a short line saying why. Errors are said next
// to what was done, with a retry. The writes are Server Actions passed in by the server (the dev preview passes fakes).

/** Which panel the section opens with: the dev preview and the tests use it to show each state; the page itself opens none. */
export type PanelStart =
  | { kind: "edit"; id: string; start?: EditStart }
  | { kind: "tier"; start?: TierStart }
  | { kind: "assign"; start?: AssignStart };

type Open = { kind: "none" } | { kind: "edit"; id: string } | { kind: "tier" } | { kind: "assign" };

export function MembershipsSection({
  data,
  person,
  timeZone,
  actions,
  open: initial,
}: {
  data: Part<MembershipsData>;
  person: { id: string; firstName: string };
  timeZone: string;
  actions: MembershipActions;
  open?: PanelStart;
}) {
  if (data.state === "no-access") return <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>;
  if (data.state === "error") return <PartNote part={data} what="the memberships" />;
  return <Loaded m={data.data} person={person} timeZone={timeZone} actions={actions} initial={initial} />;
}

function Loaded({
  m,
  person,
  timeZone,
  actions,
  initial,
}: {
  m: MembershipsData;
  person: { id: string; firstName: string };
  timeZone: string;
  actions: MembershipActions;
  initial?: PanelStart;
}) {
  const uid = useId();
  const [open, setOpen] = useState<Open>(initial ? (initial.kind === "edit" ? { kind: "edit", id: initial.id } : { kind: initial.kind }) : { kind: "none" });
  const ctx = m.assign;
  const live = ctx ? liveOf(m.rows, ctx.householdId, m.today) : null;
  const close = (focusId: string) => () => {
    setOpen({ kind: "none" });
    window.setTimeout(() => document.getElementById(focusId)?.focus(), 0);
  };

  return (
    <div data-testid="memberships-section">
      {m.rows.length === 0 ? (
        <p className="m-0 py-1 text-[14px] text-muted">No memberships on record for {person.firstName}&apos;s family.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {m.rows.map((row) => {
            const status = statusView(row, m.today);
            const editId = `${uid}-edit-${row.id}`;
            const tierId = `${uid}-tier-${row.id}`;
            const isLiveOfFamily = Boolean(ctx && live && live.id === row.id);
            return (
              <li key={row.id} data-testid="membership-row" data-membership={row.id} className="rounded-xl bg-[var(--v2-ground)] px-3 py-2.5 text-[14px] text-ink">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold" dir="auto">
                    {tierLabel(row.tier)}
                  </span>
                  <span className="text-muted" dir="auto">
                    · {row.typeName}
                  </span>
                  <Chip tone={status.tone}>{status.label}</Chip>
                </div>
                <p className="m-0 mt-0.5 text-[13.5px] text-ink-2">{periodText(row, timeZone)}</p>
                <p data-testid="membership-household" dir="auto" className="m-0 mt-0.5 text-[13px] leading-snug text-muted">
                  {row.household.length > 0 ? row.household.join(" · ") : "Family not shown"}
                </p>
                <p className="m-0 mt-0.5 text-[13px] text-muted" dir="auto">
                  {row.holder ? `Held by ${row.holder.name}` : "No holder named"}
                </p>
                {row.notes ? (
                  <p data-testid="membership-note" dir="auto" className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px] text-ink-2">
                    Note: {row.notes}
                  </p>
                ) : null}
                {m.canChange ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      id={editId}
                      type="button"
                      aria-expanded={open.kind === "edit" && open.id === row.id}
                      onClick={() => setOpen(open.kind === "edit" && open.id === row.id ? { kind: "none" } : { kind: "edit", id: row.id })}
                      className="inline-flex min-h-10 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-3.5 text-[13px] font-bold text-ink hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
                    >
                      Edit dates and notes
                    </button>
                    {isLiveOfFamily ? (
                      <button
                        id={tierId}
                        type="button"
                        aria-expanded={open.kind === "tier"}
                        onClick={() => setOpen(open.kind === "tier" ? { kind: "none" } : { kind: "tier" })}
                        className="inline-flex min-h-10 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-3.5 text-[13px] font-bold text-ink hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
                      >
                        Change tier
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {open.kind === "edit" && open.id === row.id ? (
                  <EditPanel
                    row={row}
                    siblings={m.rows.filter((r) => r.householdId === row.householdId)}
                    today={m.today}
                    timeZone={timeZone}
                    actions={actions}
                    onClose={close(editId)}
                    start={initial?.kind === "edit" && initial.id === row.id ? initial.start : undefined}
                  />
                ) : null}
                {open.kind === "tier" && isLiveOfFamily && ctx && live ? (
                  <TierPanel live={live} ctx={ctx} actions={actions} onClose={close(tierId)} start={initial?.kind === "tier" ? initial.start : undefined} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {m.truncated ? <p className="m-0 mt-2 text-[12.5px] text-muted">Only the most recent memberships are shown.</p> : null}

      {m.canChange && ctx ? (
        live ? (
          <p data-testid="memberships-assign-note" className="m-0 mt-3 text-[13px] text-muted" dir="auto">
            This family already holds a {tierLabel(live.tier)} membership, so another cannot be assigned. To give it a different tier, use Change tier on it.
          </p>
        ) : open.kind === "assign" ? (
          <AssignPanel
            ctx={ctx}
            today={m.today}
            timeZone={timeZone}
            actions={actions}
            onClose={close(`${uid}-assign`)}
            start={initial?.kind === "assign" ? initial.start : undefined}
          />
        ) : (
          <button
            id={`${uid}-assign`}
            type="button"
            onClick={() => setOpen({ kind: "assign" })}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span aria-hidden="true" className="text-[18px] leading-none">
              +
            </span>
            Assign a membership
          </button>
        )
      ) : null}
      {!m.canChange ? (
        <p data-testid="memberships-readonly" className="m-0 mt-3 text-[13px] text-muted">
          {CHANGE_NEEDS}
        </p>
      ) : null}
    </div>
  );
}
