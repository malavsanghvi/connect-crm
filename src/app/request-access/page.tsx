import type { Metadata } from "next";
import Link from "next/link";

import { OnboardingSplit } from "@/components/onboarding-split";
import { SetupScreen } from "@/components/setup-screen";
import { PRODUCT_NAME } from "@/lib/brand";
import { readPublicEnv } from "@/lib/env";
import { loadOrgGroups } from "@/lib/org-choices-load";

import { RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request access" };
// The kinds of organization come from the database (the experiences catalog), so this page is never built ahead of time.
export const dynamic = "force-dynamic";

/** Public: an organization asks to use Weaver (ONBOARDING_PLAN §3). No sign-in. */
export default async function RequestAccessPage() {
  const check = readPublicEnv();
  if (!check.ok) return <SetupScreen problems={check.problems} />;
  const { groups } = await loadOrgGroups();
  return (
    <OnboardingSplit
      title="Bring your organization onto Weaver"
      lead={
        <>
          <p>
            Weaver helps associations and communities of every kind manage their members, events, giving and communications. Tell us about your
            organization. The {PRODUCT_NAME} team reviews every request, usually within 1–3 working days.
          </p>
          <p className="mt-3">
            If approved, you receive a single-use sandbox code: a private practice copy where you set everything up, connect services in test mode and try
            it with your team before going live.
          </p>
        </>
      }
      aside={
        <>
          Already have a sandbox code? <Link href="/start" className="font-semibold text-white underline">Redeem it here</Link>.
        </>
      }
    >
      <RequestForm groups={groups} />
    </OnboardingSplit>
  );
}
