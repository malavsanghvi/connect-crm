"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Toggle } from "@/components/controls";
import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { StatusText, TableWrap } from "@/components/ui";
import { switchBlocker, type ModuleRow } from "@/lib/modules";

import { setModuleEnabledAction } from "./actions";

export type ModuleRowView = ModuleRow & { changedLine: string | null };

type Pending = { key: string; label: string; turnOn: boolean };

export function ModulesForm({ rows, canSwitch }: { rows: ModuleRowView[]; canSwitch: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const reasonId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rowNote, setRowNote] = useState<{ key: string; text: string } | null>(null);
  const [working, startTransition] = useTransition();
  const label = (k: string) => rows.find((r) => r.key === k)?.label ?? k;

  function ask(row: ModuleRowView, turnOn: boolean) {
    const blocked = switchBlocker(row.key, turnOn, rows);
    if (blocked) {
      setRowNote({ key: row.key, text: blocked });
      toast?.show(blocked, "bad");
      return;
    }
    setRowNote(null);
    setReason("");
    setError(null);
    setPending({ key: row.key, label: row.label, turnOn });
  }

  function confirm() {
    if (!pending) return;
    if (!reason.trim()) {
      setError("Say why — the reason is kept in the audit log.");
      return;
    }
    const { key, turnOn } = pending;
    startTransition(async () => {
      const call = () => setModuleEnabledAction(key, turnOn, reason);
      // Module switches need a fresh 2FA check (CCSTP): step-up modal, then one retry.
      const res = stepUp ? await stepUp.run(call, `Switching ${label(key)} ${turnOn ? "on" : "off"}`) : await call();
      if (!res.ok) {
        setError(res.error);
        toast?.show(res.error, "bad");
        return;
      }
      setPending(null);
      toast?.show(res.message ?? "Saved", "ok");
      router.refresh();
    });
  }

  return (
    <>
      <TableWrap>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Module</th>
              <th>Depends on</th>
              <th className="w-[130px]">Status</th>
              <th className="w-[150px]">Switch</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="min-w-[18rem]">
                  <p className="font-bold">{r.label}</p>
                  <p className="text-xs text-muted">{r.description}</p>
                  {r.changedLine ? (
                    <p className="mt-0.5 text-xs text-muted">
                      {r.changedLine}
                      {r.reason ? ` · Reason: ${r.reason}` : ""}
                    </p>
                  ) : null}
                  {rowNote?.key === r.key ? (
                    <p role="alert" className="mt-1 text-xs font-semibold text-danger">
                      {rowNote.text}
                    </p>
                  ) : null}
                </td>
                <td className="text-[13px]">{r.dependsOn.length > 0 ? r.dependsOn.map(label).join(", ") : "—"}</td>
                <td>
                  {r.core ? (
                    <StatusText tone="ok">Always on</StatusText>
                  ) : r.enabled ? (
                    <StatusText tone="ok">On</StatusText>
                  ) : (
                    <StatusText tone="bad">Off</StatusText>
                  )}
                </td>
                <td>
                  {r.core ? (
                    <span className="text-[13px] text-muted">Always on</span>
                  ) : (
                    <Toggle
                      label={`${r.label} module`}
                      checked={r.enabled}
                      disabled={!canSwitch || working}
                      onChange={(next) => ask(r, next)}
                      onNote="On"
                      offNote="Off"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Modal
        open={pending !== null}
        kicker="Modules"
        title={pending ? `Switch ${pending.turnOn ? "on" : "off"} ${pending.label}?` : ""}
        confirmLabel={pending?.turnOn ? "Switch on" : "Switch off"}
        tone={pending?.turnOn ? "ok" : "warn"}
        pending={working}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
      >
        {pending ? (
          <>
            <p>
              {pending.turnOn
                ? `${pending.label} comes back in the portal and the member app for everyone with access.`
                : `${pending.label} disappears from the portal and the member app, and the database refuses its data until it is switched back on. Nothing is deleted.`}
            </p>
            <label htmlFor={reasonId} className="crm-label mt-3 block">
              Reason (kept in the audit log)
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="crm-input w-full"
              placeholder="e.g. The store is closed for the summer"
            />
          </>
        ) : null}
      </Modal>
    </>
  );
}
