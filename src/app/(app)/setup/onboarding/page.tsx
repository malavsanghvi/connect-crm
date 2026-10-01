import type { Metadata } from "next";

import { Alert, Card, NoAccess, PageHeader, QueryError, buttonClass } from "@/components/ui";
import { canImportEntity, entityDef } from "@/lib/import/registry";
import { isModuleEnabled } from "@/lib/modules";
import { parseProgressPayload } from "@/lib/onboarding/progress";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Guided onboarding · Setup" };

/**
 * Guided onboarding: one step at a time. Past donations first (optional): upload, check, group the payers
 * into households with as few questions as possible (comparing them with the households already in the
 * records), then create the households and their donations as numbered, undoable import runs. The work is
 * saved as it goes: leaving and coming back offers to continue where it stopped.
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
  const people = entityDef("people");
  const payments = entityDef("payments");
  const canPeople = Boolean(people && canImportEntity(session, people));
  const canPayments = Boolean(payments && canImportEntity(session, payments));
  if (!canPeople && !canPayments) {
    return (
      <>
        {header}
        <Card title="You don't have access to this area">
          <p className="text-[13px]">
            Guided onboarding loads households, people and donations, so it needs <strong>{people?.writePerms.join(" or ")}</strong> (households and people) or{" "}
            <strong>{payments?.writePerms.join(" or ")}</strong> (donations). Ask your center admin to grant you a role that includes one of them (Settings → Roles &amp; entitlements).
          </p>
        </Card>
      </>
    );
  }

  const got = await session.db.rpc("onboarding_current", { p_center: session.center.id });
  if (got.error) console.error("[onboarding] could not read the saved progress:", { code: got.error.code ?? null, message: String(got.error.message ?? "").slice(0, 300) });
  const payload = got.error ? null : parseProgressPayload(got.data);
  if (got.error || !payload) {
    return (
      <>
        {header}
        {got.error ? (
          <QueryError what="your saved progress" error={got.error} retryHref="/setup/onboarding" />
        ) : (
          <Alert tone="danger" title="Could not load your saved progress" action={<a className={buttonClass("bad", "xs")} href="/setup/onboarding">Try again</a>}>
            The database answered in a form this page does not understand. Reload the page; if it keeps happening, ask whoever looks after this system to check that the latest database update was applied.
          </Alert>
        )}
      </>
    );
  }

  const givingOn = isModuleEnabled(session, "giving");
  const donationsWhy = !givingOn
    ? "Pledges & donations is switched off for your community, so past donations cannot be loaded."
    : !canPayments
      ? `Loading past donations needs ${payments?.writePerms.join(" or ")}, which you do not have. You can skip this step and ask a treasurer to load them.`
      : null;
  return (
    <>
      {header}
      <OnboardingWizard
        centerName={session.center.short_name || session.center.name}
        timeZone={session.center.time_zone}
        initial={payload}
        donationsBlocked={donationsWhy}
        canCompareExisting={canAccess(session, "households")}
      />
    </>
  );
}
