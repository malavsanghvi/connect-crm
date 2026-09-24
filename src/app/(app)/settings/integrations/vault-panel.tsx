"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass, Card, EmptyState, StatusText, TableWrap } from "@/components/ui";
import { fingerprintLabel, secretNameProblem, secretValueProblem, SECRET_NAME_SUGGESTIONS, vaultActionCopy, type VaultAction } from "@/lib/vault";

import { revokeSecretAction, setSecretAction, type VaultResult } from "./actions";
import { useStepUp } from "./step-up";

export type SecretView = { name: string; fingerprint: string; setBy: string; setAt: string; rotatedAt: string | null };
export type ConnectionView = {
  id: string;
  provider: string;
  label: string;
  status: { label: string; tone: "ok" | "warn" | "bad" };
  secrets: SecretView[];
};

type Pending = { action: VaultAction; connection: ConnectionView; name: string };

export function VaultPanel({
  connections,
  canManage,
  manageHint,
  env,
}: {
  connections: ConnectionView[];
  canManage: boolean;
  /** Why the buttons are missing, when they are. */
  manageHint: string | null;
  env: { supabaseUrl: string; supabaseAnonKey: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp(env);
  const nameId = useId();
  const valueId = useId();
  const reasonId = useId();
  const [pending, setPending] = useState<Pending | null>(null);
  const [hidden, setHidden] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  function open(action: VaultAction, connection: ConnectionView, secretName = "") {
    setPending({ action, connection, name: secretName });
    setName(secretName || (SECRET_NAME_SUGGESTIONS[connection.provider]?.[0] ?? ""));
    setValue("");
    setReason(action === "rotate" ? "Scheduled key rotation" : "");
    setError(null);
  }

  function close() {
    setPending(null);
    setValue("");
    setError(null);
  }

  async function confirm() {
    if (!pending) return;
    const { action, connection } = pending;
    const secretName = action === "add" ? name.trim().toLowerCase() : pending.name;
    if (action !== "disconnect") {
      const problem = (action === "add" ? secretNameProblem(secretName) : null) ?? secretValueProblem(value);
      if (problem) return setError(problem);
    }
    if (!reason.trim()) return setError("Say why — the reason is kept in the audit log.");
    const run = (): Promise<VaultResult> =>
      action === "disconnect"
        ? revokeSecretAction(connection.id, secretName, reason)
        : setSecretAction(connection.id, secretName, value, reason, action === "add" ? "add" : action);
    setWorking(true);
    setError(null);
    try {
      let res = await run();
      if (!res.ok && res.stepUp) {
        setHidden(true);
        const verified = await stepUp.request(action === "disconnect" ? `remove "${secretName}"` : `save "${secretName}"`);
        setHidden(false);
        if (!verified) {
          setError("Nothing was changed — the 2FA check was not completed.");
          return;
        }
        res = await run();
      }
      if (!res.ok) {
        setError(res.error);
        toast?.show(res.error, "bad");
        return;
      }
      close();
      toast?.show(res.message ?? "Saved", "ok");
      router.refresh();
    } catch (err) {
      console.error("[integrations] vault action failed:", err);
      setError("Could not reach the server — check the connection and try again. Nothing was changed.");
    } finally {
      setWorking(false);
      setHidden(false);
    }
  }

  const copy = pending ? vaultActionCopy(pending.action, pending.name || name, pending.connection.label) : null;

  return (
    <>
      <Card
        title="Connections and secrets"
        description="Keys and tokens are kept encrypted in the vault. Nobody can read one back here, including administrators and Community Connect staff: only the last 4 characters are shown. Changing one needs a fresh 2FA check and a reason."
        padded={false}
      >
        {manageHint ? <p className="px-3 pb-2 text-[13px] text-muted">{manageHint}</p> : null}
        {connections.length === 0 ? (
          <EmptyState title="No services connected yet">
            Connections appear here once a service (payments, QuickBooks, email, texting) is connected. Their secrets are then managed on this page.
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Connection</th>
                  <th>Secret</th>
                  <th>Fingerprint</th>
                  <th>Set by</th>
                  <th>Set</th>
                  <th>Rotated</th>
                  <th className="w-[1%]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.flatMap((c) => {
                  const head = (
                    <tr key={`${c.id}-head`}>
                      <td className="font-bold" rowSpan={Math.max(c.secrets.length, 1) + (canManage ? 1 : 0)}>
                        {c.label}
                        <div className="mt-0.5">
                          <StatusText tone={c.status.tone}>{c.status.label}</StatusText>
                        </div>
                      </td>
                      {c.secrets.length === 0 ? (
                        <td colSpan={6} className="text-muted">
                          No secrets stored for this connection.
                        </td>
                      ) : (
                        secretCells(c, c.secrets[0], canManage, open)
                      )}
                    </tr>
                  );
                  const rest = c.secrets.slice(1).map((s) => <tr key={`${c.id}-${s.name}`}>{secretCells(c, s, canManage, open)}</tr>);
                  const add = canManage ? (
                    <tr key={`${c.id}-add`}>
                      <td colSpan={6}>
                        <button type="button" className={buttonClass("ghost", "xs")} onClick={() => open("add", c)}>
                          + Add a secret
                        </button>
                      </td>
                    </tr>
                  ) : null;
                  return [head, ...rest, ...(add ? [add] : [])];
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={pending !== null && !hidden}
        kicker="Credential vault"
        title={copy?.title ?? ""}
        confirmLabel={copy?.confirm ?? "Save"}
        tone={pending?.action === "disconnect" ? "bad" : "primary"}
        pending={working}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={close}
      >
        {pending && copy ? (
          <>
            <p>{copy.body}</p>
            {pending.action === "add" ? (
              <>
                <label htmlFor={nameId} className="crm-label mt-3 block">
                  Name
                </label>
                <input
                  id={nameId}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="crm-input w-full"
                  list={`${nameId}-list`}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="api_key"
                />
                <datalist id={`${nameId}-list`}>
                  {(SECRET_NAME_SUGGESTIONS[pending.connection.provider] ?? []).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </>
            ) : null}
            {pending.action !== "disconnect" ? (
              <>
                <label htmlFor={valueId} className="crm-label mt-3 block">
                  {pending.action === "rotate" ? "New value" : "Value"}
                </label>
                <input
                  id={valueId}
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="crm-input w-full font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  data-1p-ignore
                  placeholder="Paste the key"
                />
              </>
            ) : null}
            <label htmlFor={reasonId} className="crm-label mt-3 block">
              Reason (kept in the audit log)
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
              className="crm-input w-full"
              placeholder={pending.action === "disconnect" ? "e.g. We stopped using this service" : "e.g. Connecting the test account"}
            />
          </>
        ) : null}
      </Modal>
      {stepUp.modal}
    </>
  );
}

function secretCells(c: ConnectionView, s: SecretView, canManage: boolean, open: (a: VaultAction, c: ConnectionView, n?: string) => void) {
  return (
    <>
      <td className="font-mono text-[13px]">{s.name}</td>
      <td className="font-mono text-[13px]">{fingerprintLabel(s.fingerprint)}</td>
      <td>{s.setBy}</td>
      <td className="whitespace-nowrap text-[13px]">{s.setAt}</td>
      <td className="whitespace-nowrap text-[13px]">{s.rotatedAt ?? "—"}</td>
      <td className="whitespace-nowrap">
        {canManage ? (
          <div className="flex gap-1.5">
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => open("replace", c, s.name)} aria-label={`Replace ${s.name}`}>
              Replace
            </button>
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => open("rotate", c, s.name)} aria-label={`Rotate ${s.name}`}>
              Rotate
            </button>
            <button type="button" className={buttonClass("bad", "xs")} onClick={() => open("disconnect", c, s.name)} aria-label={`Disconnect ${s.name}`}>
              Disconnect
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-muted">View only</span>
        )}
      </td>
    </>
  );
}
