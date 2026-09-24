"use client";

import { useState, type FormEvent } from "react";

import { buttonClass } from "@/components/ui";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Step = "email" | "code";

function explainAuthError(error: { message?: string; status?: number; code?: string }, stage: Step): string {
  const msg = error.message ?? "";
  if (error.status === 429 || /rate limit|too many/i.test(msg)) {
    return "Too many codes were requested for this email. Wait a minute, then try again.";
  }
  if (/signups? not allowed|user not found|otp_disabled/i.test(msg) || error.code === "otp_disabled") {
    return "No Connect account uses this email. Use the email on your Connect account, or ask your center admin to set one up.";
  }
  if (stage === "code" && (/expired|invalid|token/i.test(msg) || error.code === "otp_expired")) {
    return "That code is wrong or has expired. Check the most recent email, or send a new code.";
  }
  if (/fetch|network/i.test(msg)) {
    return "The sign-in service could not be reached. Check your connection and try again.";
  }
  return msg || "Something went wrong. Please try again.";
}

export function LoginForm({
  supabaseUrl,
  supabaseAnonKey,
  next,
}: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  next: string;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supabase = getSupabaseBrowserClient({ supabaseUrl, supabaseAnonKey });

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    const address = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address.");
      return;
    }
    setPending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        // Staff consoles never create accounts: the member app links logins to people.
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        console.error("[login] signInWithOtp failed:", otpError);
        setError(`Could not send a sign-in code — ${explainAuthError(otpError, "email")}`);
        return;
      }
      setEmail(address);
      setStep("code");
      setNotice(`We emailed a sign-in code to ${address}. It expires in a few minutes.`);
    } catch (err) {
      console.error("[login] signInWithOtp threw:", err);
      setError("Could not send a sign-in code — the sign-in service could not be reached. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const token = code.replace(/\s+/g, "");
    // Supabase's code length is a project setting (6–10 digits); accept any of them.
    if (!/^\d{6,10}$/.test(token)) {
      setError("Enter the code from the email (numbers only).");
      return;
    }
    setPending(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: "email" });
      if (verifyError) {
        console.error("[login] verifyOtp failed:", verifyError);
        setError(`Could not sign you in — ${explainAuthError(verifyError, "code")}`);
        setPending(false);
        return;
      }
      // Full navigation so the server renders with the new session cookie.
      window.location.assign(next);
    } catch (err) {
      console.error("[login] verifyOtp threw:", err);
      setError("Could not sign you in — the sign-in service could not be reached. Try again.");
      setPending(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} noValidate>
        <h2 className="font-display text-xl font-semibold text-ink">Sign in</h2>
        <label htmlFor="email" className="crm-label mt-4">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="crm-input"
        />
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={`${buttonClass("primary")} mt-5 w-full`}>
          {pending ? "Sending code…" : "Email me a code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} noValidate>
      <h2 className="font-display text-xl font-semibold text-ink">Enter your code</h2>
      {notice ? (
        <p role="status" className="mt-2 text-sm text-muted">
          {notice}
        </p>
      ) : null}
      <label htmlFor="code" className="crm-label mt-4">
        Code from the email
      </label>
      <input
        id="code"
        name="code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,12}"
        maxLength={12}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="crm-input text-center font-mono text-2xl tracking-[0.4em]"
      />
      {error ? (
        <p role="alert" className="mt-3 rounded-lg border border-maroon/30 bg-maroon-50 px-3 py-2 text-sm text-maroon">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`${buttonClass("primary")} mt-5 w-full`}>
        {pending ? "Checking…" : "Sign in"}
      </button>
      <div className="mt-3 flex flex-wrap justify-between gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
            setNotice(null);
          }}
          className={buttonClass("ghost", "sm")}
        >
          Use a different email
        </button>
        <button type="button" disabled={pending} onClick={() => sendCode()} className={buttonClass("ghost", "sm")}>
          Send a new code
        </button>
      </div>
    </form>
  );
}
