"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert, Card, buttonClass } from "@/components/ui";

import { decideAction } from "../../settings/import/actions";
import { loadDecisionRowsAction, type DecisionRow } from "./actions";

/**
 * An import run stopped because some rows "need a decision": they look like records that are already there, but
 * nothing except the name says so, and a name alone never merges two records. The owner decides, one row at a time,
 * without leaving the wizard; the decision is recorded on the run (the same one the import tool's own page records)
 * and Create then carries on with the rest.
 */
export function DecisionPanel({
  runId,
  runNumber,
  entity,
  busy,
  onContinue,
}: {
  runId: string;
  runNumber: number;
  entity: "households" | "people";
  busy: boolean;
  /** Every row has a decision: import the rest. */
  onContinue: () => void;
}) {
  const [rows, setRows] = useState<DecisionRow[] | null>(null);
  const [more, setMore] = useState(0);
  const [i, setI] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadDecisionRowsAction(runId, entity).then((res) => {
      if (!alive) return;
      if (res.ok && res.data) {
        setRows(res.data.rows);
        setMore(res.data.more);
        setLoadError(null);
      } else {
        setLoadError(res.ok ? "Could not read the rows that need a decision — the answer was empty." : res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [runId, entity, attempt]);

  const isPerson = entity === "people";
  const link = (
    <Link className="crm-link" href={`/settings/import/${runId}?view=needs_decision`}>
      open import #{runNumber}
    </Link>
  );

  if (loadError) {
    return (
      <Card title="Some rows need your decision">
        <Alert
          tone="danger"
          action={
            <button
              type="button"
              className={buttonClass("bad", "xs")}
              onClick={() => {
                setLoadError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </button>
          }
        >
          {loadError} You can also {link} and decide there.
        </Alert>
      </Card>
    );
  }
  if (!rows) {
    return (
      <Card title="Some rows need your decision">
        <p className="text-[13px]" role="status" aria-live="polite">
          Looking at the rows that need a decision…
        </p>
      </Card>
    );
  }

  const decided = rows.filter((r) => r.decision).length;
  const current = rows[i] ?? null;
  const allDecided = rows.length > 0 && decided === rows.length;

  const decide = async (row: DecisionRow, decision: "create" | "skip") => {
    setSaving(true);
    setError(null);
    const res = await decideAction(runId, row.rowNo, decision);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const next = rows.map((r) => (r.rowNo === row.rowNo ? { ...r, decision } : r));
    setRows(next);
    const after = next.findIndex((r, k) => k > i && !r.decision);
    setI(after >= 0 ? after : next.findIndex((r) => !r.decision) >= 0 ? next.findIndex((r) => !r.decision) : i);
  };

  return (
    <Card
      title="Some rows need your decision"
      description={`Import #${runNumber} stopped before adding anything. ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "row looks" : "rows look"} like ${isPerson ? "people" : "households"} you may already have, and a name alone never merges two records.`}
    >
      {rows.length === 0 ? (
        <p className="text-[14px]">Every row has a decision. Import the rest to finish.</p>
      ) : current ? (
        <div>
          <p className="text-[13px] text-muted">
            Decision {Math.min(i + 1, rows.length)} of {rows.length} · {decided} made
            {more > 0 ? ` · ${more.toLocaleString("en-US")} more after these` : ""}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3 text-[13px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">In your file (row {current.rowNo})</p>
              <p className="font-semibold">{current.title}</p>
              {current.detail ? <p className="text-muted">{current.detail}</p> : null}
            </div>
            <div className="rounded-lg border border-line p-3 text-[13px]">
              <p className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">Already in your records</p>
              {current.candidates.length === 0 ? <p className="text-muted">The matching records could not be shown.</p> : null}
              <ul className="space-y-1.5">
                {current.candidates.map((c, k) => (
                  <li key={k}>
                    <p className="font-semibold">{c.title}</p>
                    {c.detail ? <p className="text-muted">{c.detail}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-[14px]">
            {current.why === "ambiguous"
              ? `The email or mobile in this row fits more than one record, so we cannot tell which ${isPerson ? "person" : "household"} it is.`
              : `Only the name matches: the email, mobile and address do not tell us it is the same ${isPerson ? "person" : "household"}.`}{" "}
            {isPerson
              ? "If you add it, it is added as a new person and both go to Merge review so you can compare them later. If you skip it, nothing is added for this row."
              : "It is added as a separate household and both go to Merge review so you can combine them later."}
          </p>
          {error ? (
            <div className="mt-2">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass(current.decision === "create" ? "ok" : "primary")} aria-pressed={current.decision === "create"} disabled={saving} onClick={() => void decide(current, "create")}>
              {isPerson ? "Add as a new person" : "Add as a separate household"}
            </button>
            {isPerson ? (
              <button type="button" className={buttonClass(current.decision === "skip" ? "warn" : "ghost")} aria-pressed={current.decision === "skip"} disabled={saving} onClick={() => void decide(current, "skip")}>
                Skip this row
              </button>
            ) : null}
            {i > 0 ? (
              <button type="button" className={buttonClass("ghost")} disabled={saving} onClick={() => setI(i - 1)}>
                Previous row
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button type="button" className={buttonClass(allDecided || rows.length === 0 ? (busy ? "off" : "primary") : "off")} disabled={busy || !(allDecided || rows.length === 0)} aria-busy={busy} onClick={onContinue}>
          {busy ? "Importing…" : more > 0 ? "Import these and look at the rest" : "Import the rest"}
        </button>
        {!allDecided && rows.length > 0 ? <span className="text-[13px] text-muted">Decide the {rows.length - decided} remaining first.</span> : null}
        <span className="text-[12px] text-muted">Prefer the full list? {link}.</span>
      </div>
    </Card>
  );
}
