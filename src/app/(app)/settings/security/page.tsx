import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { readRuleSettings, readSecuritySettings, rulesVersion } from "@/lib/settings-rules";

import { SecurityForm } from "./security-form";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SecurityPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Sign-in, verification and device rules for members, volunteers and admins" />;
  if (!canAccess(session, "security")) {
    return (
      <>
        {header}
        <NoAccess area="Security settings" access="security" />
      </>
    );
  }
  const { center } = session;
  return (
    <>
      {header}
      <SecurityForm
        initial={readSecuritySettings(center.rules)}
        version={rulesVersion(center.rules)}
        childLoginAge={readRuleSettings(center.rules).childLoginAge}
        canEdit={can(session, "settings.manage")}
      />
    </>
  );
}
