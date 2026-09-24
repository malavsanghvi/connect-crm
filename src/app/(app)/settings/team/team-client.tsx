"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import { needsSecondApprover } from "@/lib/security";

import { inviteStaffAction, resendInvitationAction, resetStaff2faAction, type InviteResult } from "./actions";

type RoleOption = { key: string; name: string; description: string | null };

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {text}
    </p>
  );
}

/** The link to send, shown once, with a copy button. */
function LinkBox({ result }: { result: InviteResult }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-[12px] border border-success/30 bg-success-50 p-3 text-[13px] text-success-900" role="status">
      <p className="font-bold">Send this link to the person you invited</p>
      <p className="mt-1">
        Email and text sending are not connected yet, so Community Connect cannot send it for you. It works once, only for the address or number you
        entered, until {new Date(result.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. It is not shown again — resend
        the invitation for a new link.
      </p>
      <input readOnly value={result.link} data-testid="invitation-link" className="crm-input mt-2 font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          onClick={() => {
            navigator.clipboard.writeText(result.link).then(
              () => setCopied(true),
              (err) => {
                console.error("[team] copy failed:", err);
                toast?.show("Could not copy — select the link and copy it by hand.", "bad");
              },
            );
          }}
        >
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        {result.pendingRoles.length > 0 ? (
          <span>
            {result.pendingRoles.length === 1 ? "One role" : "Some roles"} ({result.pendingRoles.join(", ")}) will wait for a second administrator to approve
            them after the person accepts.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function InviteForm({ roles }: { roles: RoleOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const id = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setResult(null);
    const input = {
      firstName: String(fd.get("first_name") ?? ""),
      lastName: String(fd.get("last_name") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      roles: picked,
    };
    start(async () => {
      try {
        const call = () => inviteStaffAction(input);
        const res: ActionResult<InviteResult> = stepUp ? await stepUp.run(call, "Inviting staff") : await call();
        if (!res.ok || !res.data) {
          const msg = res.ok ? "Could not send the invitation — no link came back." : res.error;
          setError(msg);
          toast?.show(msg, "bad");
          return;
        }
        setResult(res.data);
        form.reset();
        setPicked([]);
        toast?.show(res.message ?? "Invitation created", "ok");
        router.refresh();
      } catch (err) {
        console.error("[team] invite failed:", err);
        setError("Could not send the invitation — the server did not respond. Reload to check whether it was created before trying again.");
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2.5" aria-busy={pending}>
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label htmlFor={`${id}-first`} className="crm-label">
            First name
          </label>
          <input id={`${id}-first`} name="first_name" autoComplete="off" className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${id}-last`} className="crm-label">
            Last name
          </label>
          <input id={`${id}-last`} name="last_name" autoComplete="off" className="crm-input" />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-email`} className="crm-label">
          Email
        </label>
        <input id={`${id}-email`} name="email" type="email" autoComplete="off" className="crm-input" placeholder="name@example.org" />
      </div>
      <div>
        <label htmlFor={`${id}-phone`} className="crm-label">
          Or mobile number
        </label>
        <input id={`${id}-phone`} name="phone" type="tel" autoComplete="off" className="crm-input" placeholder="(713) 555-0142" />
        <p className="crm-hint">With an email, they sign in with an emailed code. With only a mobile number, they need texted codes to work.</p>
      </div>
      <fieldset>
        <legend className="crm-label">Roles</legend>
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-[10px] border border-line p-2">
          {roles.map((r) => (
            <label key={r.key} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                name="roles"
                value={r.key}
                checked={picked.includes(r.key)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.key] : p.filter((k) => k !== r.key)))}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{r.name}</span>
                {needsSecondApprover(r.key) ? <span className="text-muted"> · needs a second approver</span> : null}
                {r.description ? <span className="block text-[12px] text-muted">{r.description}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Creating…" : "Create invitation"}
        </button>
      </div>
      <ErrorLine text={error} />
      {result ? <LinkBox result={result} /> : null}
    </form>
  );
}

export function ResendButton({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const [result, setResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        className={buttonClass("ghost", "xs")}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const call = () => resendInvitationAction(id);
              const res = stepUp ? await stepUp.run(call, "Resending the invitation") : await call();
              if (!res.ok || !res.data) {
                const msg = res.ok ? "Could not resend — no link came back." : res.error;
                setError(msg);
                toast?.show(msg, "bad");
                return;
              }
              setResult(res.data);
              toast?.show(res.message ?? "New link created", "ok");
              router.refresh();
            } catch (err) {
              console.error("[team] resend failed:", err);
              setError("Could not resend — the server did not respond. Try again.");
            }
          })
        }
      >
        {pending ? "Working…" : "Resend"}
      </button>
      <Modal
        open={result !== null || error !== null}
        kicker="Invitation"
        title={result ? "New invitation link" : "Could not resend"}
        confirmLabel="Done"
        error={error}
        onCancel={() => (setResult(null), setError(null))}
        onConfirm={() => (setResult(null), setError(null))}
      >
        {result ? <LinkBox result={result} /> : null}
      </Modal>
    </>
  );
}

export function ResetTwoFactorButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className={buttonClass("bad", "xs")} onClick={() => (setError(null), setReason(""), setOpen(true))}>
        Reset 2FA
      </button>
      <Modal
        open={open}
        kicker="Lost phone"
        title={`Reset ${name}'s 2FA?`}
        confirmLabel="Reset 2FA"
        tone="bad"
        pending={pending}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            if (!reason.trim()) {
              setError("Say why, and how you checked who they are — it goes in the audit log.");
              return;
            }
            try {
              const call = () => resetStaff2faAction(userId, reason);
              const res = stepUp ? await stepUp.run(call, "Resetting 2FA") : await call();
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setOpen(false);
              toast?.show(res.message ?? "2FA reset", "ok");
              router.refresh();
            } catch (err) {
              console.error("[team] reset 2FA failed:", err);
              setError("Could not reset 2FA — the server did not respond. Reload to check before trying again.");
            }
          })
        }
      >
        <p>
          Only do this after checking who they are (in person, or a call to a number you already have). Their authenticator apps are removed and they
          are signed out everywhere; they sign in with an emailed code and set up a new app.
        </p>
        <label htmlFor={reasonId} className="crm-label mt-3 block">
          Reason
        </label>
        <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input min-h-16" placeholder="Lost phone; identity checked in person" />
      </Modal>
    </>
  );
}
