import type { Metadata } from "next";
import Link from "next/link";

import { OnboardingSplit } from "@/components/onboarding-split";
import { SetupScreen } from "@/components/setup-screen";
import { readPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { START_STEPS, startStep, startStepIndex, type StartStatus } from "@/lib/platform-onboarding";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { StartFlow } from "./start-flow";
import { readStartCode } from "./start-code";

export const metadata: Metadata = { title: "Start your sandbox" };

/**
 * /start: redeem a sandbox code (ONBOARDING_PLAN §3) — code, email sign-in,
 * mobile, authenticator app, sandbox terms, then the sandbox is created with
 * the redeemer as owner and its Setup checklist opens.
 */
export default async function StartPage() {
  const check = readPublicEnv();
  if (!check.ok) return <SetupScreen problems={check.problems} />;
  const code = await readStartCode();
  let status: StartStatus | null = null;
  let email: string | null = null;
  let problem: string | null = null;
  let signedIn = false;
  try {
    const db = await createSupabaseServerClient();
    const { data: claims } = await db.auth.getClaims();
    signedIn = Boolean(claims?.claims?.sub);
    email = typeof claims?.claims?.email === "string" ? claims.claims.email : null;
    if (signedIn && code) {
      const res = await db.rpc("sandbox_start_status", { p_code: code });
      if (res.error) {
        console.error("[start] could not read the progress:", res.error);
        problem = `Could not load your progress — ${explainError(res.error)}. Reload to try again.`;
      } else {
        status = res.data as unknown as StartStatus;
      }
    }
  } catch (error) {
    console.error("[start] loading the page failed:", error);
    problem = `Could not load your progress — ${explainError(error)}. Reload to try again.`;
  }
  const step = problem ? "signin" : startStep(Boolean(code), signedIn, status);
  const current = startStepIndex(step);

  return (
    <OnboardingSplit
      title="Start your sandbox"
      lead={
        <>
          <p>Your sandbox is a private practice copy of Community Connect for your organization. Payments run in test mode and messages reach only test recipients.</p>
          <ol className="mt-4 flex flex-col gap-1.5" aria-label="Steps">
            {START_STEPS.map((s, i) => (
              <li key={s.key} className={i + 1 === current ? "font-semibold text-white" : i + 1 < current ? "text-navy-200 line-through" : "text-navy-200"}>
                {i + 1}. {s.label}
              </li>
            ))}
          </ol>
        </>
      }
      aside={
        <>
          No code yet? <Link href="/request-access" className="font-semibold text-white underline">Request access</Link>. The code arrives by email after Community
          Connect approves your request.
        </>
      }
    >
      {problem ? (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
      <StartFlow step={step} status={status} code={code} email={email} supabaseUrl={check.env.supabaseUrl} supabaseAnonKey={check.env.supabaseAnonKey} />
    </OnboardingSplit>
  );
}
