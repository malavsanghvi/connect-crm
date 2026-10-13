import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { TodayPage } from "@/components/giving-today/today-page";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { TODAY_COMMUNITY, sampleTodayModel } from "@/lib/giving-today/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

import type { PreviewRole } from "./fixtures";
import { GivingRecordPreview } from "./preview-client";

export const metadata: Metadata = { title: "Giving record and find · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-record" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-record"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/**
 * DEV ONLY. Giving slice 2 (docs/GIVING_REDESIGN.md): Today's large box with the Giving lane, the Record payment sheet and a family's
 * giving, over invented data for a neutral community club, without a database or a session. Try "200 check okafor" (two families),
 * "200 check adeyemi", "R-2026-0388", "refund R-2026-0388", "pledge 500 nguyen", "120" or "roof". `?type=` types it for you;
 * `?role=volunteer` is a finance volunteer (recorded, not applied). Recording here saves nothing. Returns notFound() in production.
 */
export default async function GivingRecordPreviewPage({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const role: PreviewRole = sp.role === "volunteer" ? "volunteer" : "treasurer";
  const type = typeof sp.type === "string" ? sp.type.slice(0, 120) : null;
  return (
    <PreviewShell community={TODAY_COMMUNITY} workspaces={sampleRail()}>
      <GivingRecordPreview role={role} type={type}>
        <TodayPage model={sampleTodayModel(role)} />
      </GivingRecordPreview>
    </PreviewShell>
  );
}
