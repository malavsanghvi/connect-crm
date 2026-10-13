import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CampaignsTab } from "@/components/giving-campaigns/campaigns-tab";
import { ViewOff } from "@/components/giving-campaigns/view-off";
import { NoAccess } from "@/components/ui";
import { loadCampaignsModel } from "@/lib/data/giving-campaigns";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { LabhFulfilment } from "../labh/fulfilment";

import { BolisView } from "./bolis-view";

export const metadata: Metadata = { title: "Giving · Campaigns & opportunities" };

/**
 * Giving › Campaigns & opportunities in the New look (docs/GIVING_REDESIGN.md section 4, slice 6): views Campaigns, Opportunities,
 * Bolis and Labh, quick create, the full screens one click away. The classic look keeps its address: Campaigns under
 * Opportunities, as before.
 */
export default async function CampaignsRoute({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  if (parseLook((await cookies()).get(LOOK_COOKIE)?.value) !== "v2") {
    redirect(hrefWith("/giving/opportunities/campaigns", sp, {}));
  }
  const session = await getSession();
  const model = await loadCampaignsModel(session, { view: param(sp, "view"), newSheet: param(sp, "new"), name: param(sp, "name") });
  const view = model.views.find((v) => v.key === model.active);

  let content = null;
  if (!view) content = <NoAccess area="Campaigns" access="campaigns" />;
  else if (view.state !== "on") {
    content = <ViewOff view={view} communityName={model.communityName} kindLabel={model.kindLabel} canOpenSettings={model.canOpenSettings} />;
  } else if (view.key === "bolis") content = <BolisView session={session} label={view.label} />;
  else if (view.key === "labh") content = <LabhFulfilment session={session} retryHref="/giving/campaigns?view=labh" />;

  return <CampaignsTab model={model}>{content}</CampaignsTab>;
}
