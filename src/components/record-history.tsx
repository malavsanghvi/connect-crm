"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { loadRecordHistoryAction, type RecordHistoryResult } from "@/app/history-actions";
import { Drawer } from "@/components/drawer";
import { Alert, EmptyState, buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { clientLabel, diffRecord, historyVerb } from "@/lib/history";
import { moduleLabelFor } from "@/lib/modules";

// ---------------------------------------------------------------------------
// Who may see "History": holders of audit.view (the database enforces it
// again in app.record_history). Set once in the app shell.
// ---------------------------------------------------------------------------
const HistoryAccess = createContext(false);

export function HistoryAccessProvider({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return <HistoryAccess.Provider value={allowed}>{children}</HistoryAccess.Provider>;
}

export function useHistoryAccess(): boolean {
  return useContext(HistoryAccess);
}

/**
 * "History" action for a record drawer or page: opens a drawer with the
 * record's audit trail. Renders nothing for people without audit.view.
 */
export function HistoryButton({
  table,
  recordId,
  title,
  variant = "ghost",
  size = "sm",
}: {
  table: string;
  recordId: string | null | undefined;
  /** Drawer title, e.g. the pledge number or household name. */
  title?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const allowed = useHistoryAccess();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!allowed || !recordId) return null;
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => setOpen(true)}>
        History
      </button>
      {/* The drawer is portaled, but React still bubbles its events to this
          tree: keep clicks inside it from reaching a clickable table row. */}
      <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Drawer open={open} onClose={close} kicker="History" title={title ?? "Record history"} subtitle="Every change, newest first · from the audit log">
          {open ? <RecordHistory table={table} recordId={recordId} /> : null}
        </Drawer>
      </span>
    </>
  );
}

type Load = { state: "loading" } | { state: "error"; error: string } | { state: "done"; result: RecordHistoryResult };

/** The audit trail of one record: when, who, what changed (before → after), app/screen and reason. */
export function RecordHistory({ table, recordId }: { table: string; recordId: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadRecordHistoryAction(table, recordId)
      .then((res) => {
        if (!live) return;
        setLoad(res.ok && res.data ? { state: "done", result: res.data } : { state: "error", error: res.ok ? "Could not load the history — no answer came back." : res.error });
      })
      .catch((e: unknown) => {
        console.error("[history] loading the record history failed:", e);
        if (live) setLoad({ state: "error", error: "Could not load the history — the server could not be reached. Try again." });
      });
    return () => {
      live = false;
    };
  }, [table, recordId, attempt]);

  if (load.state === "loading") return <p className="text-[13px] text-muted">Loading the history…</p>;
  if (load.state === "error") {
    return (
      <Alert
        tone="danger"
        action={
          <button
            type="button"
            className={buttonClass("bad", "xs")}
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        }
      >
        {load.error}
      </Alert>
    );
  }
  const result = load.result;
  if (!result.available) {
    return <p className="text-[13px] text-muted">Record history is not available yet — it arrives with the next database update.</p>;
  }
  if (result.rows.length === 0) return <EmptyState title="No changes recorded for this record yet" />;

  return (
    <ol className="flex flex-col gap-3">
      {result.rows.map((r) => {
        const changes = diffRecord(r.before, r.after, result.currency);
        const where = clientLabel(r.client_app, r.client_screen);
        return (
          <li key={r.id} className="rounded-[10px] border border-line bg-white px-3 py-2.5">
            <p className="text-[13px]">
              <strong>{historyVerb(r.action)}</strong> · {formatDateTime(r.occurred_at, result.timeZone)}
            </p>
            <p className="text-xs text-muted">
              {r.actor_name ?? (r.actor_user_id ? "A former user" : "System")}
              {r.actor_role ? ` (${r.actor_role})` : ""}
              {where ? ` · ${where}` : ""}
              {r.module ? ` · ${moduleLabelFor(r.module)}` : ""}
            </p>
            {r.reason ? <p className="mt-1 text-xs">Reason: {r.reason}</p> : null}
            {changes.length > 0 ? (
              <table className="mt-1.5 w-full text-xs">
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.field} className="align-top">
                      <th scope="row" className="w-[34%] py-0.5 pr-2 text-left font-semibold text-muted">
                        {c.label}
                      </th>
                      <td className="break-words py-0.5">
                        <span className={c.hidden ? "italic text-muted" : "text-muted line-through decoration-muted/60"}>{c.before}</span>
                        <span aria-hidden> → </span>
                        <span className="sr-only"> changed to </span>
                        <span className={c.hidden ? "italic text-muted" : "font-semibold"}>{c.after}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : r.action.endsWith(".update") ? (
              <p className="mt-1 text-xs text-muted">No visible field changed.</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
