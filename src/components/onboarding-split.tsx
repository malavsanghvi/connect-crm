import type { ReactNode } from "react";

import { PRODUCT_NAME } from "@/lib/brand";

/**
 * The public onboarding pages (/request-access, /start) use the sign-in page's
 * layout: a navy panel explaining the step, and the form beside it.
 */
export function OnboardingSplit({ title, lead, aside, children }: { title: string; lead: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[480px_minmax(0,1fr)]">
      <section className="flex flex-col gap-[18px] bg-navy px-8 py-10 text-white lg:p-14">
        <div className="flex h-[64px] w-[64px] items-center justify-center rounded-2xl bg-white">
          <span aria-hidden className="font-display text-2xl font-semibold text-navy">
            CC
          </span>
        </div>
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-wide text-navy-200">{PRODUCT_NAME}</p>
          <h1 className="mt-1 font-display text-[34px] font-semibold leading-[1.15]">{title}</h1>
        </div>
        <div className="max-w-[420px] text-base leading-normal text-navy-200">{lead}</div>
        <div className="hidden flex-grow lg:block" />
        {aside ? <div className="text-[13px] leading-relaxed text-navy-200">{aside}</div> : null}
      </section>
      <section className="px-6 py-10 sm:px-[56px] lg:py-14">
        <div className="flex w-full max-w-[560px] flex-col gap-4">{children}</div>
      </section>
    </main>
  );
}

export const onboardingInputClass =
  "min-h-[46px] w-full rounded-xl border border-line-input bg-white px-3.5 text-base text-ink placeholder:text-faint focus:border-navy focus:outline-2 focus:outline-offset-1 focus:outline-navy";

export function OnboardingError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {text}
    </p>
  );
}

export function OnboardingNotice({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p role="status" className="rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
      {text}
    </p>
  );
}
