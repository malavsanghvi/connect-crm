"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ENTITY_WORDS, manageRows, type CustomEntity, type OkPayload } from "@/lib/people-v2/custom-fields";

import { useFamilyActions } from "../family/actions";

import { VisibilityMark } from "./custom-row";
import { SheetFrame } from "./sheet-frame";

// "Manage" (for people who hold settings.manage): the fields of one kind of record, with Archive and Restore. Archiving hides a field from
// every card and keeps every value; it can be restored; nothing is deleted. These call the Settings screen's own save action. The order
// of the fields is changed in Settings: that action has no order input, so this sheet links there rather than adding a new write.

type Status = "active" | "archived";

export function ManageSheet({ entity, payload, onClose, onAdd }: { entity: CustomEntity; payload: OkPayload; onClose: () => void; onAdd: () => void }) {
  const actions = useFamilyActions();
  const router = useRouter();
  const rows = manageRows(payload[entity]);
  // What was just changed, until the page has read the new state.
  const [now, setNow] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const noun = ENTITY_WORDS[entity];

  async function change(id: string, label: string, status: Status) {
    if (busy) return;
    setBusy(id);
    setProblem(null);
    const verb = status === "archived" ? "archive" : "restore";
    try {
      const res = await actions.custom.setStatus({ id, status });
      if (res.ok) {
        setNow((n) => ({ ...n, [id]: status }));
        router.refresh();
      } else setProblem({ id, text: res.error.startsWith("Could not") ? res.error : `Could not ${verb} “${label}” — ${res.error}` });
    } catch (error) {
      console.error("[custom fields] the field status did not change:", error);
      setProblem({ id, text: `Could not ${verb} “${label}” — the server did not respond. Nothing was changed. Try again.` });
    }
    setBusy(null);
  }

  return (
    <SheetFrame title={`Fields for every ${noun.one}`} onClose={onClose} testId="manage-fields-sheet">
      <p className="m-0 mt-1.5 text-[13.5px] leading-snug text-muted">
        Archiving hides a field from every card and keeps every value; it can be restored. Nothing is deleted.
      </p>
      {rows.length === 0 ? (
        <p className="m-0 mt-4 text-[14px] text-muted">There are no {noun.one} fields yet.</p>
      ) : (
        <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0" data-testid="manage-rows">
          {rows.map((r) => {
            const archived = (now[r.id] ?? (r.archived ? "archived" : "active")) === "archived";
            return (
              <li key={r.id} className="rounded-xl border border-line px-3.5 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`m-0 text-[14.5px] font-bold ${archived ? "text-muted" : "text-ink"}`} dir="auto">
                      {r.label}
                      <VisibilityMark visibility={r.visibility} />
                      {archived ? <span className="ml-2 text-[12px] font-semibold text-muted">Archived</span> : null}
                    </p>
                    <p className="m-0 text-[12.5px] text-muted">{r.detail}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => change(r.id, r.label, archived ? "active" : "archived")}
                    aria-label={`${archived ? "Restore" : "Archive"} ${r.label}`}
                    className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[13.5px] font-bold text-ink hover:border-[var(--v2-blue)] disabled:opacity-60"
                  >
                    {busy === r.id ? "…" : archived ? "Restore" : "Archive"}
                  </button>
                </div>
                {problem?.id === r.id ? (
                  <p role="alert" className="m-0 mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                    {problem.text}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {payload.settingsHref ? (
        <p className="m-0 mt-3 text-[13px] text-muted">
          To change the order, or a field&apos;s name, choices or who sees it, use{" "}
          <Link href={payload.settingsHref} className="font-bold text-[var(--v2-blue)] underline">
            Settings › Custom fields
          </Link>
          .
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)]"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
        >
          + Add a field
        </button>
      </div>
    </SheetFrame>
  );
}
