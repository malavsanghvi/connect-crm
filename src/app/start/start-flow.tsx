"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";

import { OnboardingError, OnboardingNotice, onboardingInputClass } from "@/components/onboarding-split";
import { buttonClass } from "@/components/ui";
import { slugProblem, type StartStatus, type StartStep } from "@/lib/platform-onboarding";
import { explainAuthError } from "@/lib/security";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import {
  acceptStartTermsAction,
  checkStartCodeAction,
  checkTotpAction,
  confirmTotpAction,
  createSandboxAction,
  forgetStartCodeAction,
  sendStartPhoneCodeAction,
  startTotpAction,
  verifyStartPhoneCodeAction,
  type StartEnrollment,
} from "./actions";

const label = "flex flex-col gap-1.5 text-[13px] text-muted";
const reload = () => window.location.assign("/start");

function StartOver({ signOut, text = "Use a different code" }: { signOut: boolean; text?: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <OnboardingError text={error} />
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={async () => {
          const res = await forgetStartCodeAction(signOut);
          if (!res.ok) return setError(res.error);
          reload();
        }}
      >
        {text}
      </button>
    </>
  );
}

function CodeStep() {
  const [state, action, pending] = useActionState(checkStartCodeAction, null);
  useEffect(() => {
    if (state?.ok) reload();
  }, [state]);
  if (state?.ok) {
    return <OnboardingNotice text="Code accepted — loading the next step…" />;
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h2 className="font-display text-[28px] font-semibold text-ink">Enter your sandbox code</h2>
      <label className={label}>
        Sandbox code (from the email)
        <input name="code" required autoFocus autoComplete="off" placeholder="CC-SBX-7K4M-Q2PD" className={`${onboardingInputClass} font-mono tracking-[0.12em]`} />
      </label>
      <OnboardingError text={state && !state.ok ? state.error : null} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

function SignInStep({ supabaseUrl, supabaseAnonKey }: { supabaseUrl: string; supabaseAnonKey: string }) {
  const supabase = getSupabaseBrowserClient({ supabaseUrl, supabaseAnonKey });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError("Enter the email address the code was sent to.");
    setPending(true);
    try {
      // The sandbox code is the reason this login may be created; the database checks it belongs to this email.
      const { error: otpError } = await supabase.auth.signInWithOtp({ email: address, options: { shouldCreateUser: true } });
      if (otpError) {
        console.error("[start] signInWithOtp failed:", otpError);
        return setError(explainAuthError(otpError, "send a sign-in code"));
      }
      setEmail(address);
      setSent(true);
    } catch (err) {
      console.error("[start] signInWithOtp threw:", err);
      setError("Could not send a code — the sign-in service could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const t = code.replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(t)) return setError("Enter the code from the email (numbers only).");
    setPending(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: t, type: "email" });
      if (verifyError) {
        console.error("[start] verifyOtp failed:", verifyError);
        setPending(false);
        return setError(explainAuthError(verifyError, "sign you in"));
      }
      reload();
    } catch (err) {
      console.error("[start] verifyOtp threw:", err);
      setError("Could not sign you in — the sign-in service could not be reached. Try again.");
      setPending(false);
    }
  }

  if (!sent) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <h2 className="font-display text-[28px] font-semibold text-ink">Sign in with your email</h2>
        <p className="text-[13px] text-muted">Use the email address the sandbox code was sent to. We email you a one-time sign-in code — there is no password.</p>
        <label className={label}>
          Email
          <input name="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={onboardingInputClass} />
        </label>
        <OnboardingError text={error} />
        <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
          {pending ? "Sending code…" : "Send sign-in code"}
        </button>
        <StartOver signOut={false} />
      </form>
    );
  }
  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <h2 className="font-display text-[28px] font-semibold text-ink">Check your email</h2>
      <OnboardingNotice text={`We emailed a sign-in code to ${email}. It expires in a few minutes.`} />
      <label className={label}>
        Code from the email
        <input name="email_code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} className={`${onboardingInputClass} font-mono text-xl tracking-[0.2em]`} />
      </label>
      <OnboardingError text={error} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      <button type="button" disabled={pending} onClick={() => (setSent(false), setCode(""))} className={buttonClass("ghost", "sm")}>
        Use a different email
      </button>
    </form>
  );
}

function PhoneStep({ initial }: { initial: string | null }) {
  const [phone, setPhone] = useState(initial ? `+${initial.replace(/^\+/, "")}` : "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setPending(true);
        const res = sentTo ? await verifyStartPhoneCodeAction(sentTo, code) : await sendStartPhoneCodeAction(phone);
        setPending(false);
        if (!res.ok) return setError(res.error);
        if (!sentTo) return setSentTo((res.data as { phone: string }).phone);
        reload();
      }}
    >
      <h2 className="font-display text-[28px] font-semibold text-ink">Verify your mobile</h2>
      <p className="text-[13px] text-muted">We text a code to your mobile. It is a backup way to reach you about your organization&apos;s account.</p>
      {!sentTo ? (
        <label className={label}>
          Mobile number
          <input name="phone" type="tel" autoComplete="tel" autoFocus value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(713) 555-0142" className={onboardingInputClass} />
        </label>
      ) : (
        <>
          <OnboardingNotice text={`We texted a code to ${sentTo}.`} />
          <label className={label}>
            Code from the text message
            <input name="phone_code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} className={`${onboardingInputClass} font-mono text-xl tracking-[0.2em]`} />
          </label>
        </>
      )}
      <OnboardingError text={error} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Working…" : sentTo ? "Verify" : "Text me a code"}
      </button>
      {sentTo ? (
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => (setSentTo(null), setCode(""))}>
          Use a different number
        </button>
      ) : null}
    </form>
  );
}

function AuthenticatorStep() {
  const [enrollment, setEnrollment] = useState<StartEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-[28px] font-semibold text-ink">Set up an authenticator app</h2>
        <p className="text-[13px] text-muted">
          Owners use two-step verification (2FA): a 6-digit code from an app such as Google Authenticator, Microsoft Authenticator or 1Password, at sign-in and
          before sensitive changes.
        </p>
        <OnboardingError text={error} />
        <button
          type="button"
          disabled={pending}
          className={`${buttonClass("primary", "lg")} w-full`}
          onClick={async () => {
            setPending(true);
            setError(null);
            const res = await startTotpAction();
            setPending(false);
            if (!res.ok) return setError(res.error);
            setEnrollment(res.data ?? null);
          }}
        >
          {pending ? "Preparing…" : "Set up an authenticator app"}
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await confirmTotpAction(enrollment.factorId, code);
        setPending(false);
        if (!res.ok) return setError(res.error);
        reload();
      }}
    >
      <h2 className="font-display text-[28px] font-semibold text-ink">Scan the QR code</h2>
      {/* The QR code is an SVG data URL from the sign-in service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qrSvg} alt="QR code for your authenticator app" className="h-[180px] w-[180px] rounded-lg border border-line bg-white p-2" />
      <p className="text-[13px] text-muted">
        Or type this setup key: <code data-testid="totp-secret" className="break-all rounded bg-subtle px-1 font-mono">{enrollment.secret}</code>
      </p>
      <label className={label}>
        Code from the app
        <input name="totp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} className={`${onboardingInputClass} font-mono text-xl tracking-[0.2em]`} />
      </label>
      <OnboardingError text={error} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Checking…" : "Turn on 2FA"}
      </button>
      <p className="rounded-[10px] bg-canvas px-3 py-2 text-[12px] text-muted">
        Printed recovery codes are not offered yet: the sign-in service has no safe way to accept them. If you lose your phone, the Community Connect team can
        reset your 2FA after checking who you are.
      </p>
    </form>
  );
}

function TotpCheckStep() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await checkTotpAction(code);
        setPending(false);
        if (!res.ok) return setError(res.error);
        reload();
      }}
    >
      <h2 className="font-display text-[28px] font-semibold text-ink">Two-step verification</h2>
      <p className="text-[13px] text-muted">Your account already has an authenticator app. Enter its 6-digit code to continue.</p>
      <label className={label}>
        Code from your authenticator app
        <input name="totp" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} className={`${onboardingInputClass} font-mono text-xl tracking-[0.2em]`} />
      </label>
      <OnboardingError text={error} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Checking…" : "Verify"}
      </button>
    </form>
  );
}

function TermsStep({ status }: { status: StartStatus }) {
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status.terms_published || !status.terms) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-[28px] font-semibold text-ink">Sandbox terms</h2>
        <OnboardingError text="The Community Connect sandbox terms have not been published yet, so the sandbox cannot be created. Community Connect has been told; we will email you when you can continue. Your progress so far is kept." />
      </div>
    );
  }
  const terms = status.terms;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-[28px] font-semibold text-ink">{terms.title}</h2>
      <p className="text-[12px] text-muted">Version {terms.version}</p>
      <div data-testid="sandbox-terms" className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-white p-4 text-[13px] leading-relaxed text-ink">
        {terms.body_md}
      </div>
      <label className="flex items-start gap-2 text-[14px] text-ink">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
        <span>I accept the sandbox terms on behalf of {status.org_name ?? "my organization"}.</span>
      </label>
      <OnboardingError text={error} />
      <button
        type="button"
        disabled={pending || !agreed}
        className={`${buttonClass("primary", "lg")} w-full`}
        onClick={async () => {
          setPending(true);
          setError(null);
          const res = await acceptStartTermsAction(terms.id);
          setPending(false);
          if (!res.ok) return setError(res.error);
          reload();
        }}
      >
        {pending ? "Saving…" : "Accept and continue"}
      </button>
    </div>
  );
}

function CreateStep({ status }: { status: StartStatus }) {
  const [slug, setSlug] = useState(status.suggested_slug ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = slug ? slugProblem(slug) : null;
  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const p = slugProblem(slug);
        if (p) return setError(p);
        setPending(true);
        const res = await createSandboxAction(slug);
        if (!res.ok) {
          setPending(false);
          return setError(res.error);
        }
        window.location.assign(res.data!.url);
      }}
    >
      <h2 className="font-display text-[28px] font-semibold text-ink">Create your sandbox</h2>
      <p className="text-[13px] text-muted">
        For <strong className="text-ink">{status.org_name}</strong>. Choose the short web name your organization will use; the sandbox gets “-sandbox” added.
        You become the organization&apos;s owner.
      </p>
      <label className={label}>
        Web name
        <input name="slug" autoFocus value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className={`${onboardingInputClass} font-mono`} />
      </label>
      <p className="text-[12px] text-muted">
        Sandbox: <span className="font-mono">{slug || "…"}-sandbox</span> · production later: <span className="font-mono">{slug || "…"}</span>
      </p>
      <OnboardingError text={error ?? problem} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Creating your sandbox…" : "Create my sandbox"}
      </button>
    </form>
  );
}

export function StartFlow({
  step,
  status,
  email,
  supabaseUrl,
  supabaseAnonKey,
}: {
  step: StartStep;
  status: StartStatus | null;
  code: string | null;
  email: string | null;
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  switch (step) {
    case "code":
      return <CodeStep />;
    case "signin":
      return <SignInStep supabaseUrl={supabaseUrl} supabaseAnonKey={supabaseAnonKey} />;
    case "wrong_email":
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-[28px] font-semibold text-ink">This code is for another email</h2>
          <OnboardingError text={`You are signed in as ${email ?? "another account"}, but this code was sent to ${status?.code_email ?? "a different address"}. Sign out and sign in with that email.`} />
          <StartOver signOut={false} text="Use a different code" />
          <button type="button" className={buttonClass("primary", "md")} onClick={async () => {
            const supabase = getSupabaseBrowserClient({ supabaseUrl, supabaseAnonKey });
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) console.error("[start] sign out failed:", error);
            reload();
          }}>
            Sign out and use the right email
          </button>
        </div>
      );
    case "phone":
      return <PhoneStep initial={status?.phone ?? null} />;
    case "authenticator":
      return <AuthenticatorStep />;
    case "totp_check":
      return <TotpCheckStep />;
    case "terms":
      return <TermsStep status={status!} />;
    case "create":
      return <CreateStep status={status!} />;
    case "done":
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-[28px] font-semibold text-ink">Your sandbox is ready</h2>
          <OnboardingNotice text={`You already used this code to create ${status?.center_slug}.`} />
          <a href="/" className={buttonClass("primary", "lg")}>
            Open the portal
          </a>
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-[28px] font-semibold text-ink">This code cannot be used</h2>
          <OnboardingError
            text={
              status?.code_status === "expired"
                ? "This code has expired. Ask Community Connect to send you a new one."
                : status?.code_status === "used"
                  ? "This code has already been used."
                  : "That code is not valid. Ask Community Connect for a new one."
            }
          />
          <StartOver signOut={false} />
        </div>
      );
  }
}
