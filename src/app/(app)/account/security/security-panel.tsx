"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";

import {
  confirmTotpEnrollmentAction,
  removeTotpFactorAction,
  sendPhoneCodeAction,
  signOutEverywhereAction,
  startTotpEnrollmentAction,
  verifyPhoneCodeAction,
  verifyStepUpAction,
  type Enrollment,
} from "@/app/security-actions";
import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { BlockGrid, Card, InfoBox, StatusText, buttonClass } from "@/components/ui";
import { formatPhone } from "@/lib/security";

export type SecurityStatus = {
  hasTotp: boolean;
  phone: string | null;
  phoneVerified: boolean;
  isStaff: boolean;
  required: boolean;
  policyRequires: boolean;
};
export type FactorView = { id: string; name: string; createdAt: string };

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {text}
    </p>
  );
}

function CodeInput({ id, value, onChange, label }: { id: string; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <>
      <label htmlFor={id} className="crm-label">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={9}
        placeholder="6-digit code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cc-code-input"
      />
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The setup key in groups of four, easier to type into an app by hand. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function SecurityPanel({
  status,
  factors,
  aal,
  stepUpFresh,
  next,
  required,
  community,
  sessionHours,
  idleMinutes,
}: {
  status: SecurityStatus;
  factors: FactorView[];
  aal: string;
  stepUpFresh: boolean;
  next: string;
  required: boolean;
  community: string;
  sessionHours: number;
  idleMinutes: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const ids = { verify: useId(), enroll: useId(), phone: useId(), phoneCode: useId() };
  const [pending, start] = useTransition();

  const [verifyCode, setVerifyCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const [removing, setRemoving] = useState<FactorView | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [phoneInput, setPhoneInput] = useState(status.phone ?? "");
  const [phoneSentTo, setPhoneSentTo] = useState<string | null>(null);
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const has2fa = factors.length > 0;
  const needsChallenge = has2fa && aal !== "aal2";

  function done(message: string | undefined, fallback: string) {
    toast?.show(message ?? fallback, "ok");
    if (required && next !== "/account/security") router.push(next);
    else router.refresh();
  }

  function verifyNow(e: FormEvent) {
    e.preventDefault();
    setVerifyError(null);
    start(async () => {
      try {
        const res = await verifyStepUpAction(verifyCode);
        if (!res.ok) return setVerifyError(res.error);
        setVerifyCode("");
        done(res.message, "Verified");
      } catch (err) {
        console.error("[account/security] verify failed:", err);
        setVerifyError("Could not check the code — the server did not respond. Try again.");
      }
    });
  }

  function startEnroll() {
    setEnrollError(null);
    start(async () => {
      try {
        const res = await startTotpEnrollmentAction();
        if (!res.ok || !res.data) return setEnrollError(res.ok ? "Could not start — the sign-in service returned nothing." : res.error);
        setEnrollment(res.data);
        setEnrollCode("");
      } catch (err) {
        console.error("[account/security] enroll start failed:", err);
        setEnrollError("Could not start setting up the app — the server did not respond. Try again.");
      }
    });
  }

  function confirmEnroll(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setEnrollError(null);
    start(async () => {
      try {
        const res = await confirmTotpEnrollmentAction(enrollment.factorId, enrollCode);
        if (!res.ok) return setEnrollError(res.error);
        setEnrollment(null);
        setEnrollCode("");
        done(res.message, "2FA is on");
      } catch (err) {
        console.error("[account/security] enroll confirm failed:", err);
        setEnrollError("Could not turn on 2FA — the server did not respond. Reload to see whether it is on before trying again.");
      }
    });
  }

  function confirmRemove() {
    if (!removing) return;
    const factor = removing;
    setRemoveError(null);
    start(async () => {
      try {
        const call = () => removeTotpFactorAction(factor.id);
        const res = stepUp ? await stepUp.run(call, "Removing an authenticator app") : await call();
        if (!res.ok) return setRemoveError(res.error);
        setRemoving(null);
        toast?.show(res.message ?? "Removed", "ok");
        router.refresh();
      } catch (err) {
        console.error("[account/security] remove failed:", err);
        setRemoveError("Could not remove the app — the server did not respond. Reload to check before trying again.");
      }
    });
  }

  function sendPhone(e: FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    start(async () => {
      try {
        const res = await sendPhoneCodeAction(phoneInput);
        if (!res.ok || !res.data) return setPhoneError(res.ok ? "Could not send a code." : res.error);
        setPhoneSentTo(res.data.phone);
        setPhoneCode("");
        toast?.show(res.message ?? "Code sent", "ok");
      } catch (err) {
        console.error("[account/security] phone send failed:", err);
        setPhoneError("Could not send a code — the server did not respond. Try again.");
      }
    });
  }

  function verifyPhone(e: FormEvent) {
    e.preventDefault();
    if (!phoneSentTo) return;
    setPhoneError(null);
    start(async () => {
      try {
        const res = await verifyPhoneCodeAction(phoneSentTo, phoneCode);
        if (!res.ok) return setPhoneError(res.error);
        setPhoneSentTo(null);
        setPhoneCode("");
        toast?.show(res.message ?? "Phone verified", "ok");
        router.refresh();
      } catch (err) {
        console.error("[account/security] phone verify failed:", err);
        setPhoneError("Could not verify the number — the server did not respond. Try again.");
      }
    });
  }

  function signOutEverywhere() {
    setSessionsError(null);
    start(async () => {
      try {
        const res = await signOutEverywhereAction();
        if (!res.ok) return setSessionsError(res.error);
        window.location.assign(new URL("/login", window.location.origin).toString());
      } catch (err) {
        console.error("[account/security] sign out everywhere failed:", err);
        setSessionsError("Could not sign out everywhere — the server did not respond. Try again.");
      }
    });
  }

  return (
    <BlockGrid>
      <Card
        span={7}
        title="Two-step verification (2FA)"
        description="A code from an authenticator app on your phone, at sign-in and before sensitive changes"
        actions={has2fa ? <StatusText tone="ok">On</StatusText> : <StatusText tone={status.required ? "bad" : "warn"}>Off</StatusText>}
      >
        <div className="flex flex-col gap-4">
          {needsChallenge ? (
            <form onSubmit={verifyNow} noValidate className="rounded-[12px] border border-navy/20 bg-navy-50 p-3">
              <p className="mb-2 text-[13px] font-bold text-navy">This session has not passed 2FA yet</p>
              <CodeInput id={ids.verify} value={verifyCode} onChange={setVerifyCode} label="Code from your authenticator app" />
              <div className="mt-2">
                <button type="submit" disabled={pending} className={buttonClass("primary")}>
                  {pending ? "Checking…" : "Verify"}
                </button>
              </div>
              <ErrorLine text={verifyError} />
            </form>
          ) : has2fa ? (
            <p className="text-[13px] text-muted">
              {stepUpFresh ? "You passed a 2FA check in the last 5 minutes." : "This session passed 2FA."} Sensitive changes — role grants, refunds
              and write-offs, the month lock, module switches, merges, exports — ask for a fresh code when your last one is more than 5 minutes old.
              {status.isStaff && !status.policyRequires ? (
                <span data-testid="step-up-with-app-note">
                  {" "}
                  {community} does not require 2FA for staff yet, but because you have an authenticator app, those changes still ask for your code.
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-[13px] text-muted">
              {status.isStaff
                ? status.policyRequires
                  ? `${community} requires 2FA for staff. Add an authenticator app to use the portal.`
                  : `Staff should add an authenticator app now: ${community} can require it for everyone, and sensitive changes ask for a code once you have one.`
                : "Add an authenticator app to protect your account."}
            </p>
          )}

          {factors.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {factors.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-canvas px-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{f.name}</span>
                    <span className="text-muted">Added {formatDate(f.createdAt)}</span>
                  </span>
                  <button type="button" className={buttonClass("bad", "xs")} onClick={() => (setRemoveError(null), setRemoving(f))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {enrollment ? (
            <form onSubmit={confirmEnroll} noValidate className="flex flex-col gap-3 rounded-[12px] border border-line p-3">
              <p className="text-[13px] font-bold text-ink">1 · Scan this code with your authenticator app</p>
              {/* A data: URI SVG from the sign-in service; next/image does not apply. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrollment.qrSvg} alt="QR code to add Community Connect to your authenticator app" width={180} height={180} className="rounded-[8px] bg-white p-1" />
              <p className="text-[12px] text-muted">
                Can&apos;t scan? Enter this setup key instead:{" "}
                <code data-testid="totp-secret" className="break-all rounded bg-subtle px-1 font-mono text-[12px] text-ink">
                  {grouped(enrollment.secret)}
                </code>
              </p>
              <div>
                <p className="mb-1 text-[13px] font-bold text-ink">2 · Enter the 6-digit code the app shows</p>
                <CodeInput id={ids.enroll} value={enrollCode} onChange={setEnrollCode} label="Code from the app" />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={buttonClass("primary")}>
                  {pending ? "Checking…" : "Turn on 2FA"}
                </button>
                <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => setEnrollment(null)}>
                  Cancel
                </button>
              </div>
              <ErrorLine text={enrollError} />
            </form>
          ) : (
            <div>
              <button type="button" disabled={pending} onClick={startEnroll} className={buttonClass(has2fa ? "ghost" : "primary")}>
                {pending ? "Starting…" : has2fa ? "Add another authenticator app" : "Set up an authenticator app"}
              </button>
              <ErrorLine text={enrollError} />
            </div>
          )}
        </div>
      </Card>

      <Card
        span={5}
        title="Mobile phone"
        description="Verified with a texted code; used to reach you and, later, as a backup sign-in"
        actions={
          status.phone && status.phoneVerified ? <StatusText tone="ok">Verified</StatusText> : <StatusText tone="warn">Not verified</StatusText>
        }
      >
        <div className="flex flex-col gap-3">
          {status.phone ? (
            <InfoBox>
              {formatPhone(status.phone)} · {status.phoneVerified ? "verified" : "not verified"}
            </InfoBox>
          ) : null}
          {phoneSentTo ? (
            <form onSubmit={verifyPhone} noValidate className="flex flex-col gap-2">
              <p className="text-[13px] text-muted">We texted a code to {formatPhone(phoneSentTo)}.</p>
              <CodeInput id={ids.phoneCode} value={phoneCode} onChange={setPhoneCode} label="Code from the text message" />
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={pending} className={buttonClass("primary")}>
                  {pending ? "Checking…" : "Verify number"}
                </button>
                <button type="button" disabled={pending} className={buttonClass("ghost")} onClick={() => setPhoneSentTo(null)}>
                  Use a different number
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={sendPhone} noValidate className="flex flex-col gap-2">
              <label htmlFor={ids.phone} className="crm-label">
                {status.phone ? "Change or re-verify your number" : "Your mobile number"}
              </label>
              <input
                id={ids.phone}
                type="tel"
                autoComplete="tel"
                placeholder="(713) 555-0142"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="crm-input"
              />
              <div>
                <button type="submit" disabled={pending} className={buttonClass("ghost")}>
                  {pending ? "Sending…" : "Text me a code"}
                </button>
              </div>
            </form>
          )}
          <ErrorLine text={phoneError} />
        </div>
      </Card>

      <Card span={7} title="Sessions" description="Where you are signed in">
        <div className="flex flex-col gap-3 text-[13px]">
          <p className="text-muted">
            You stay signed in on this device until you sign out. {community}&apos;s recorded policy for staff is {sessionHours}-hour sessions and a{" "}
            {idleMinutes}-minute idle timeout; the sign-in service does not enforce that length yet, so sign out on shared computers.
          </p>
          <div>
            <button type="button" disabled={pending} onClick={signOutEverywhere} className={buttonClass("warn")}>
              Sign out everywhere
            </button>
          </div>
          <ErrorLine text={sessionsError} />
        </div>
      </Card>

      <Card span={5} title="Lost your phone?" description="How to get back in">
        <p className="text-[13px] text-muted">
          Sign in with the code emailed to you, then ask another administrator of {community} to reset your 2FA (Settings › Team), or contact
          the Community Connect team, who will check who you are first. The reset is recorded in the audit log. Then set up the app again here.
          Printed recovery codes are not offered: the sign-in service has no safe way to accept them yet.
        </p>
      </Card>

      <Modal
        open={removing !== null}
        kicker="Please confirm"
        title={`Remove ${removing?.name ?? "this app"}?`}
        confirmLabel="Remove app"
        tone="bad"
        pending={pending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={confirmRemove}
      >
        {factors.length <= 1
          ? status.policyRequires && status.isStaff
            ? `It is your only authenticator app. ${community} requires 2FA for staff, so you will have to set up a new one before using the portal again.`
            : "It is your only authenticator app: 2FA will be off until you add another."
          : "Codes from that app will stop working."}
      </Modal>
    </BlockGrid>
  );
}
