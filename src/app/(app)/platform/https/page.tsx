import type { Metadata } from "next";

import { HttpsStatusPanel } from "@/components/https/https-status-panel";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";

export const metadata: Metadata = { title: "HTTPS · Platform" };
export const dynamic = "force-dynamic";

export default async function PlatformHttpsPage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Portal address and HTTPS · certificates are requested and renewed automatically" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  return (
    <>
      {header}
      <HttpsStatusPanel timeZone={session.center.time_zone} />
    </>
  );
}
