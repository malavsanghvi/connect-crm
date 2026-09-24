import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { readOnboardingFields, rulesVersion } from "@/lib/settings-rules";

import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Onboarding fields · Settings" };

export default async function OnboardingFieldsPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="What onboarding and profiles ask · privacy choices are always asked as opt-in or opt-out" />;
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Onboarding fields" access="centerSettings" />
      </>
    );
  }
  const { center } = session;
  return (
    <>
      {header}
      <OnboardingForm initial={readOnboardingFields(center.rules)} version={rulesVersion(center.rules)} canEdit />
    </>
  );
}
