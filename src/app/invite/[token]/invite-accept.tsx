"use client";

import { useState, type FormEvent } from "react";

import { signOutAction } from "@/app/auth-actions";
import { buttonClass } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/brand";
import { explainAuthError, normalizePhone } from "@/lib/security";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { acceptInvitationAction } from "./actions";

export type InvitePreview = {
  status: "pending" | "accepted" | "revoked" | "expired";
  centerName: string;
  contact: string;
  contactKind: "email" | "phone";
  roles: string[];
  expiresAt: string;
  invitedBy: string | null;
};

const inputClass =
  "min-h-[50px] w-full rounded-xl border border-line-input bg-white px-3.5 text-base text-ink placeholder:text-faint focus:border-navy focus:outline-2 focus:outline-offset-1 focus:outline-navy";

function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {text}
    </p>
  );
}

export function InviteAccept({
  token,
  preview,
  signedInAs,
  supabaseUrl,
  supabaseAnonKey,
}: {
  token: string;
  preview: InvitePreview;
  signedInAs: string | null;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  const supabase = getSupabaseBrowserClient({ supabaseUrl, supabaseAnonKey });
  const [step, setStep] = useState<"address" | "code">("address");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPhone = preview.contactKind === "phone";

  async function accept() {
    setError(null);
    setPending(true);
    try {
      const res = await acceptInvitationAction(token);
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      // A full navigation, so the portal renders with the new session cookie.
      window.location.assign(new URL("/account/security?welcome=1", window.location.origin).toString());
    } catch (err) {
      console.error("[invite] accept failed:", err);
      setError("Could not accept the invitation — the server did not respond. Try again.");
      setPending(false);
    }
  }

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    const value = isPhone ? normalizePhone(address) : address.trim().toLowerCase();
    if (!value || (!isPhone && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
      setError(isPhone ? "Enter your mobile number with its area code." : "Enter your email address.");
      return;
    }
    setPending(true);
    try {
      // The invitation is the reason this login may be created; accepting checks it is for this address.
      const { error: otpError } = isPhone
        ? await supabase.auth.signInWithOtp({ phone: value, options: { shouldCreateUser: true } })
        : await supabase.auth.signInWithOtp({ email: value, options: { shouldCreateUser: true } });
      if (otpError) {
        console.error("[invite] signInWithOtp failed:", otpError);
        setError(explainAuthError(otpError, "send a sign-in code"));
        return;
      }
      setAddress(value);
      setStep("code");
      setNotice(isPhone ? `We texted a code to ${value}.` : `We emailed a code to ${value}. It expires in a few minutes.`);
    } catch (err) {
      console.error("[invite] signInWithOtp threw:", err);
      setError("Could not send a code — the sign-in service could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = code.replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(t)) {
      setError("Enter the code (numbers only).");
      return;
    }
    setPending(true);
    try {
      const { error: verifyError } = isPhone
        ? await supabase.auth.verifyOtp({ phone: address, token: t, type: "sms" })
        : await supabase.auth.verifyOtp({ email: address, token: t, type: "email" });
      if (verifyError) {
        console.error("[invite] verifyOtp failed:", verifyError);
        setError(explainAuthError(verifyError, "sign you in"));
        setPending(false);
        return;
      }
      await accept();
    } catch (err) {
      console.error("[invite] verifyOtp threw:", err);
      setError("Could not sign you in — the sign-in service could not be reached. Try again.");
      setPending(false);
    }
  }

  const closed =
    preview.status === "accepted"
      ? "This invitation has already been used. If it was you, sign in as usual."
      : preview.status === "revoked"
        ? "This invitation was withdrawn. Ask the person who invited you for a new one."
        : preview.status === "expired"
          ? "This invitation has expired. Ask the person who invited you to send it again."
          : null;

  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[560px_minmax(0,1fr)]">
      <section className="flex flex-col gap-[18px] bg-navy px-8 py-10 text-white lg:p-14">
        <h1 className="font-display text-[34px] font-semibold leading-[1.15]">Join {preview.centerName}&apos;s team</h1>
        <p className="max-w-[460px] text-base leading-normal text-navy-200">
          {preview.invitedBy ? `${preview.invitedBy} invited you` : "You were invited"} to help run {preview.centerName} on {PRODUCT_NAME}
          {preview.roles.length > 0 ? ` as ${preview.roles.join(", ")}` : ""}.
        </p>
        <p className="text-[13px] leading-relaxed text-navy-200">
          The invitation is for {preview.contact}. Staff sign in with a one-time code — no password — and set up an authenticator app for
          two-step verification.
        </p>
      </section>
      <section className="px-6 py-10 sm:px-[72px] lg:py-14">
        <div className="flex w-full max-w-[400px] flex-col gap-4">
          <h2 className="font-display text-[28px] font-semibold text-ink">Accept the invitation</h2>
          {closed ? (
            <p role="status" className="rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown-900">
              {closed}
            </p>
          ) : signedInAs ? (
            <>
              <p className="text-[13px] text-muted">You are signed in as {signedInAs}.</p>
              <ErrorBox text={error} />
              <button type="button" disabled={pending} onClick={accept} className={`${buttonClass("primary", "lg")} w-full`}>
                {pending ? "Accepting…" : "Accept and continue"}
              </button>
              <form action={async () => void (await signOutAction())}>
                <button type="submit" className={buttonClass("ghost", "sm")}>
                  Not you? Sign out and use another account
                </button>
              </form>
            </>
          ) : step === "address" ? (
            <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
              <label htmlFor="invite-address" className="flex flex-col gap-1.5 text-[13px] text-muted">
                {isPhone ? `Your mobile number (${preview.contact})` : `Your email (${preview.contact})`}
                <input
                  id="invite-address"
                  type={isPhone ? "tel" : "email"}
                  autoComplete={isPhone ? "tel" : "email"}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputClass}
                  autoFocus
                />
              </label>
              <ErrorBox text={error} />
              <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
                {pending ? "Sending code…" : "Send code"}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} noValidate className="flex flex-col gap-4">
              {notice ? (
                <p role="status" className="text-[13px] text-muted">
                  {notice}
                </p>
              ) : null}
              <label htmlFor="invite-code" className="flex flex-col gap-1.5 text-[13px] text-muted">
                Code
                <input
                  id="invite-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={12}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={`${inputClass} font-mono text-xl tracking-[0.2em]`}
                  autoFocus
                />
              </label>
              <ErrorBox text={error} />
              <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
                {pending ? "Checking…" : "Verify and accept"}
              </button>
              <button type="button" disabled={pending} onClick={() => (setStep("address"), setCode(""))} className={buttonClass("ghost", "sm")}>
                Use a different {isPhone ? "number" : "email"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
