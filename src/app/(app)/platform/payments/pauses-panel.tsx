"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, Card, InfoBox, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { pauseSummary, riderPauseNote, type PausePlugin, type PausesView } from "@/lib/payments/change-control";

import { liftPauseAction, suspendPluginAction, type PauseResult } from "./actions";

// One row per way to pay: whether it runs, the pauses (for every community, or for one), and the buttons. Every pause or
// resume asks for a reason (kept in the audit log) and a fresh 2FA check; a refusal is shown next to the click, in plain English.

type Ask = { kind: "pause" | "resume"; plugin: PausePlugin; centerId: string | null; centerName: string | null };

export function PausesPanel({ view, tz }: { view: PausesView; tz: string }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const reasonId = useId();

  function open(a: Ask) {
    setReason("");
    setError(null);
    setAsk(a);
  }

  async function confirm() {
    if (!ask) return;
    if (!reason.trim()) return setError("Say why — the reason is kept in the audit log.");
    const what = `${ask.kind === "pause" ? "pause" : "resume"} ${ask.plugin.label}`;
    setWorking(true);
    setError(null);
    const call = () => (ask.kind === "pause" ? suspendPluginAction(ask.plugin.key, ask.centerId, reason) : liftPauseAction(ask.plugin.key, ask.centerId, reason));
    let res: PauseResult;
    try {
      res = stepUp ? await stepUp.run(call, what) : await call();
    } catch (err) {
      console.error(`[platform/payments] ${what} failed:`, err);
      res = { ok: false, error: `Could not ${what} — the server did not answer. Check the connection and try again. Nothing was changed.` };
    }
    setWorking(false);
    if (res.ok) {
      setAsk(null);
      toast?.show(res.message ?? "Done", "ok");
      router.refresh();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <InfoBox>
        A pause turns a way to pay off for members: it is not offered, and a new payment with it cannot start. Money that already arrived is recorded and
        matched as before, and nothing here reads a credential or moves money. An organization cannot undo a pause, not even by resetting its sandbox.
      </InfoBox>
      <Card padded={false}>
        <TableWrap>
          <table className="crm-table" aria-label="Ways to pay and their pauses">
            <thead>
              <tr>
                <th>Way to pay</th>
                <th>State</th>
                <th>Pauses</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {view.plugins.map((p) => (
                <tr key={p.key} data-plugin={p.key}>
                  <td>
                    <span className="font-bold">{p.label}</span>
                    {riderPauseNote(p.key, p.label) ? (
                      <p className="mt-1 max-w-[220px] text-[12px] text-muted" data-rider-note>
                        Hides it from members only. Stripe&apos;s own page may still show it; pause Card to stop Stripe payments.
                      </p>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={p.platform_pause || p.centers.length > 0 ? "danger" : "success"}>{pauseSummary(p)}</Badge>
                  </td>
                  <td className="min-w-[260px] text-[13px]">
                    {p.platform_pause ? (
                      <p>
                        Everyone · {formatDateTime(p.platform_pause.at, tz)} · {p.platform_pause.by ?? "a platform admin"} · “{p.platform_pause.reason}”
                      </p>
                    ) : null}
                    {p.centers.map((c) => (
                      <p key={c.id}>
                        {c.center_name} · {formatDateTime(c.at, tz)} · {c.by ?? "a platform admin"} · “{c.reason}”{" "}
                        <button type="button" className={buttonClass("ghost", "xs")} disabled={working}
                          onClick={() => open({ kind: "resume", plugin: p, centerId: c.center_id, centerName: c.center_name })}>
                          Resume for {c.center_name}
                        </button>
                      </p>
                    ))}
                    {!p.platform_pause && p.centers.length === 0 ? <span className="text-muted">Not paused</span> : null}
                  </td>
                  <td className="min-w-[280px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.platform_pause ? (
                        <button type="button" className={buttonClass("primary", "xs")} disabled={working}
                          onClick={() => open({ kind: "resume", plugin: p, centerId: null, centerName: null })}>
                          Resume for everyone
                        </button>
                      ) : (
                        <>
                          <button type="button" className={buttonClass("bad", "xs")} disabled={working}
                            onClick={() => open({ kind: "pause", plugin: p, centerId: null, centerName: null })}>
                            Pause for everyone
                          </button>
                          <label className="sr-only" htmlFor={`pick-${p.key}`}>
                            Community to pause {p.label} for
                          </label>
                          <select id={`pick-${p.key}`} className="crm-input w-44" value={pick[p.key] ?? ""}
                            onChange={(e) => setPick((cur) => ({ ...cur, [p.key]: e.target.value }))}>
                            <option value="">One community…</option>
                            {view.centers
                              .filter((c) => !p.centers.some((x) => x.center_id === c.id))
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                  {c.environment === "sandbox" ? " (sandbox)" : ""}
                                </option>
                              ))}
                          </select>
                          <button type="button" className={buttonClass("ghost", "xs")} disabled={working || !pick[p.key]}
                            onClick={() => {
                              const c = view.centers.find((x) => x.id === pick[p.key]);
                              if (c) open({ kind: "pause", plugin: p, centerId: c.id, centerName: c.name });
                            }}>
                            Pause for it
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="History" description="Every pause and resume, newest first, with who and why. Kept for good.">
        {view.history.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing has been paused yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-[13px]">
            {view.history.map((h) => (
              <li key={h.id}>
                <span className="font-semibold">{view.plugins.find((p) => p.key === h.plugin_key)?.label ?? h.plugin_key}</span>{" "}
                {h.platform_wide ? "for every community" : `for ${h.center_name ?? "a community"}`} · paused {formatDateTime(h.suspended_at, tz)} by{" "}
                {h.suspended_by ?? "a platform admin"} · “{h.reason}”
                {h.lifted_at ? (
                  <>
                    {" "}
                    · resumed {formatDateTime(h.lifted_at, tz)} by {h.lifted_by ?? "a platform admin"} · “{h.lift_reason}”
                  </>
                ) : (
                  <> · <span className="font-semibold text-danger">still paused</span></>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!ask}
        kicker="Platform › Payments"
        title={ask ? `${ask.kind === "pause" ? "Pause" : "Resume"} ${ask.plugin.label}${ask.centerName ? ` for ${ask.centerName}` : " for every community"}` : ""}
        confirmLabel={ask?.kind === "pause" ? "Pause" : "Resume"}
        tone={ask?.kind === "pause" ? "bad" : "primary"}
        pending={working}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setAsk(null)}
      >
        {ask?.kind === "pause" ? (
          <>
            <p>
              Members stop seeing {ask.plugin.label}{ask.centerName ? ` in ${ask.centerName}` : ""}, and a new payment, or a new Zelle report, with it cannot start.
              Nothing already recorded changes. This needs a fresh 2FA check.
            </p>
            {riderPauseNote(ask.plugin.key, ask.plugin.label) ? <p className="mt-2 font-semibold">{riderPauseNote(ask.plugin.key, ask.plugin.label)}</p> : null}
          </>
        ) : (
          <p>{ask?.plugin.label} is offered again. This needs a fresh 2FA check.</p>
        )}
        <label htmlFor={reasonId} className="mt-3 block text-[13px] font-semibold">
          Reason (kept in the audit log)
        </label>
        <textarea id={reasonId} className="crm-input mt-1 w-full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </div>
  );
}
