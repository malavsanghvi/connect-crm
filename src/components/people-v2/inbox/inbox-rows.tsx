"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReducer, useState } from "react";

import { decideApplicationAction } from "@/app/(app)/memberships/applications/actions";
import { decideHouseholdRequestAction } from "@/app/(app)/people/requests/actions";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { InboxApplicationRow, InboxModel, InboxRequestRow } from "@/lib/people-v2/inbox";
import { decisionFields, flowReducer, initialFlow } from "@/lib/people-v2/inbox-flow";

// One row of the Inbox: who, what, since when and the household card line, with Approve and Decline right there. Approve asks one inline
// question ("Yes, approve"); Decline asks for the reason; a family request is approved with a relationship chosen on the row. The
// decisions are the SAME server actions the classic screens use (they run people.decide_application and people.decide_household_request),
// so permissions, the audit trail and Niva stay shared. The states are in src/lib/people-v2/inbox-flow.ts (tested without a browser).

type Row = InboxApplicationRow | InboxRequestRow;

const CHIP = "inline-flex min-h-11 items-center rounded-[22px] border px-3.5 text-[13.5px] font-bold";

export function InboxRow({ row, roles }: { row: Row; roles: InboxModel["roles"] }) {
  const request = row.type === "request";
  const [flow, dispatch] = useReducer(flowReducer, request ? row.askedRole : null, initialFlow);
  const router = useRouter();
  const toast = useToast();
  const sending = flow.phase === "sending";
  const roleLabel = roles.find((r) => r.value === flow.role)?.label.toLowerCase() ?? null;

  async function send() {
    const event = { type: "send", needsRole: request } as const;
    const next = flowReducer(flow, event);
    dispatch(event);
    if (next.phase !== "sending") return;
    const fd = new FormData();
    for (const [k, v] of Object.entries(decisionFields(row.id, next, request))) fd.set(k, v);
    try {
      const result = request ? await decideHouseholdRequestAction(null, fd) : await decideApplicationAction(null, fd);
      if (result.ok) {
        const message = result.message || "Done.";
        dispatch({ type: "ok", message });
        toast?.show(message, "ok");
        router.refresh();
      } else {
        dispatch({ type: "fail", error: result.error });
      }
    } catch (error) {
      console.error("[inbox] the decision did not reach the server:", error);
      dispatch({ type: "fail", error: "The decision did not reach the server, so nothing was changed. Check your connection and try again." });
    }
  }

  const title = request ? row.what : row.who;
  const detail = request ? (row.asked ? `Asked for as their ${row.asked}` : "No relationship was given") : `${row.what} · ${row.step}`;
  const formOpen = flow.phase === "sending" ? flow.from : flow.phase;

  return (
    <li className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-white px-4 py-3.5" aria-busy={sending}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-bold text-ink">{title}</p>
          <p className="m-0 text-[13px] text-ink-2">{detail}</p>
        </div>
        <p className="m-0 text-[12.5px] text-muted">
          {row.since} · {row.waited}
        </p>
      </div>

      {row.cardLine && row.familyHref ? (
        <Link href={row.familyHref} className="text-[13px] leading-snug text-navy no-underline hover:underline">
          {row.cardLine}
        </Link>
      ) : (
        <p className="m-0 text-[12.5px] text-muted">No household card: your role cannot see this household.</p>
      )}

      {flow.phase === "done" ? (
        <p role="status" className="m-0 rounded-field border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
          {flow.message}
        </p>
      ) : (
        <>
          {request && formOpen !== "decline" ? (
            <div role="radiogroup" aria-label={`Their relationship to the family, for ${row.who}`} className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted">Relationship</span>
              {roles.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={flow.role === r.value}
                  disabled={sending}
                  onClick={() => dispatch({ type: "role", role: r.value })}
                  className={`${CHIP} ${flow.role === r.value ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink hover:border-navy"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}

          {formOpen === "approve" ? (
            <div className="flex flex-col gap-2">
              <p className="m-0 text-[14px] text-ink">
                {request ? `Add ${row.who} to this family${roleLabel ? ` as ${roleLabel}` : ""}? They are added right away.` : row.approval.kind === "approve" ? row.approval.confirm : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" autoFocus disabled={sending} onClick={send} className={buttonClass("primary", "sm")}>
                  {sending ? "Working…" : request ? "Yes, add them" : row.approval.kind === "approve" ? row.approval.yes : "Yes"}
                </button>
                <button type="button" disabled={sending} onClick={() => dispatch({ type: "cancel" })} className={buttonClass("ghost", "sm")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : formOpen === "decline" ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
                Why are you declining? It is kept with the record.
                <textarea
                  autoFocus
                  rows={2}
                  maxLength={1000}
                  value={flow.reason}
                  disabled={sending}
                  onChange={(e) => dispatch({ type: "reason", text: e.target.value })}
                  className="w-full rounded-field border border-line-control bg-white px-3 py-2 text-[14px] font-normal text-ink outline-none focus:border-navy focus:ring-2 focus:ring-navy/30"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={sending} onClick={send} className={buttonClass("bad-solid", "sm")}>
                  {sending ? "Working…" : request ? "Decline this request" : "Decline this application"}
                </button>
                <button type="button" disabled={sending} onClick={() => dispatch({ type: "cancel" })} className={buttonClass("ghost", "sm")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {request || row.approval.kind === "approve" ? (
                <button type="button" disabled={sending} onClick={() => dispatch({ type: "approve" })} className={buttonClass("primary", "sm")}>
                  {request ? "Approve" : row.approval.kind === "approve" ? row.approval.label : "Approve"}
                </button>
              ) : (
                <p className="m-0 text-[13px] font-semibold text-ink-2">{row.approval.sentence}</p>
              )}
              <button type="button" disabled={sending} onClick={() => dispatch({ type: "decline" })} className={buttonClass("ghost", "sm")}>
                Decline
              </button>
            </div>
          )}

          {flow.error ? (
            <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {flow.error}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}

/** A group of rows: the oldest few, with a way to see all that were loaded. */
export function InboxList({ rows, roles, initial = 5 }: { rows: Row[]; roles: InboxModel["roles"]; initial?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, initial);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {shown.map((r) => (
          <InboxRow key={r.id} row={r} roles={roles} />
        ))}
      </ul>
      {rows.length > initial ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-[13.5px] font-bold text-navy hover:underline">
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </>
  );
}
