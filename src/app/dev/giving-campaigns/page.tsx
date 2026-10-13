import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { CampaignsTab } from "@/components/giving-campaigns/campaigns-tab";
import { ViewOff } from "@/components/giving-campaigns/view-off";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { NoAccess } from "@/components/ui";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { CAMPAIGNS_COMMUNITY, sampleCampaignsModel, type CampaignsRole } from "@/lib/giving-campaigns/fixtures";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving Campaigns · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const ROLES: readonly CampaignsRole[] = ["treasurer", "viewer", "volunteer"];

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-campaigns" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-campaigns"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * DEV ONLY. Giving › Campaigns & opportunities (New look) inside the shell, with invented data for a neutral community club
 * that counts in Canadian dollars, drawn without a database or a session. `?view=opportunities|bolis|labh`, `?role=viewer|volunteer`,
 * `?kind=tradition` (a kind with Bolis and Labh), `?off=giving_opportunities,bolis` (modules switched off), `?new=campaign&name=…`
 * (the sheet the box opens). The buttons call the real Server Actions, which refuse without a session. notFound() in production.
 */
export default async function GivingCampaignsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const role = ROLES.find((r) => r === sp.role) ?? "treasurer";
  const kind = sp.kind === "tradition" ? LEGACY_KIND : NEUTRAL_KIND;
  const off = one(sp.off)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const model = sampleCampaignsModel({ role, kind, modulesOff: off, view: one(sp.view), newSheet: one(sp.new), name: one(sp.name) });
  const view = model.views.find((v) => v.key === model.active);
  let content = null;
  if (!view) content = <NoAccess area="Campaigns" access="campaigns" />;
  else if (view.state !== "on") content = <ViewOff view={view} communityName={CAMPAIGNS_COMMUNITY} kindLabel={kind.label} canOpenSettings />;
  else if (view.key === "bolis" || view.key === "labh") {
    content = (
      <section className="rounded-[18px] border border-line bg-white px-4 py-6 text-[14px] text-muted">
        In the product this view is the existing {view.label} screen ({view.key === "bolis" ? "the digital boli list; a row opens /bolis" : "upcoming special days and the menu"}). It needs the database, so the preview leaves it out.
      </section>
    );
  }
  return (
    <PreviewShell community={CAMPAIGNS_COMMUNITY} workspaces={sampleRail()}>
      <CampaignsTab model={model}>{content}</CampaignsTab>
    </PreviewShell>
  );
}
