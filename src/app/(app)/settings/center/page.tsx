import type { Metadata } from "next";

import { Card, DefinitionList, NoAccess, PageHeader } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { CenterSettingsForm } from "./center-settings-form";

export const metadata: Metadata = { title: "Center settings" };

export default async function CenterSettingsPage() {
  const session = await getSession();
  const header = (
    <PageHeader title="Center settings" description="Tenant configuration: branding, which features are switched on, and the center's rules. A center adopts Connect through configuration, not code." />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Center settings" access="centerSettings" />
      </>
    );
  }
  const { center } = session;
  return (
    <>
      {header}
      <Card title={center.name} className="mb-6">
        <DefinitionList
          items={[
            { label: "Slug", value: <span className="font-mono">{center.slug}</span> },
            { label: "Short name", value: center.short_name ?? "—" },
            { label: "Time zone", value: center.time_zone },
            { label: "Currency", value: center.currency },
            { label: "Status", value: center.status },
          ]}
        />
      </Card>
      <Card title="Configuration">
        <CenterSettingsForm
          branding={isPlainObject(center.branding) ? center.branding : {}}
          flags={isPlainObject(center.feature_flags) ? center.feature_flags : {}}
          rules={isPlainObject(center.rules) ? center.rules : {}}
        />
      </Card>
    </>
  );
}
