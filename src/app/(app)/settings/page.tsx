import { redirect } from "next/navigation";

import { NoAccess, PageHeader } from "@/components/ui";
import { visibleNav } from "@/lib/permissions";
import { getSession } from "@/lib/session";

/** /settings opens the first Settings tab this person can use. */
export default async function SettingsIndex() {
  const session = await getSession();
  const settings = visibleNav(session).find((m) => m.key === "settings");
  if (settings) redirect(settings.href);
  return (
    <>
      <PageHeader title="Settings" />
      <NoAccess area="Settings" access="centerSettings" />
    </>
  );
}
