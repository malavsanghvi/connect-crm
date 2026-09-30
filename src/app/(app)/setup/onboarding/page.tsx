import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Guided onboarding · Setup" };

/**
 * Guided onboarding: one step at a time. Past donations first (optional): upload, check, group the payers
 * into households with as few questions as possible, then create the households and their donations as
 * numbered, undoable import runs.
 */
export default async function OnboardingPage() {
  const session = await getSession();
  const header = <PageHeader title="Guided onboarding" description="Load your past donations and families, one step at a time" />;
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Guided onboarding" access="dataImport" />
      </>
    );
  }
  return (
    <>
      {header}
      <OnboardingWizard centerName={session.center.short_name || session.center.name} />
    </>
  );
}
