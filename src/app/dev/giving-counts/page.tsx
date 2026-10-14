import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { CountsView } from "@/components/giving-counts/counts-view";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { sampleCountsModel } from "@/lib/giving-counts/fixtures";
import { LISTS_COMMUNITY, ROWING_CLUB, type ListsRole } from "@/lib/giving-lists/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving counts · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const ROLES: readonly ListsRole[] = ["treasurer", "approver", "volunteer"];

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-counts" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-counts"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/**
 * DEV ONLY. Giving › the counts tab (New look, slice 5) inside the shell, with invented data, drawn without a database or a
 * session. `?role=volunteer` a finance volunteer (giving.record_offline), `?role=approver` a person who reads Giving only;
 * `?community=rowing` a non-faith club in euros; `?off=giving_bank` Bank reconciliation off (Mark deposited only),
 * `?off=giving_counts` the tab switched off; `?view=waiting|deposited` as on the real tab. The sheets call the real Server
 * Actions, which refuse without a session. Returns notFound() in production.
 */
export default async function GivingCountsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const role = ROLES.find((r) => r === one("role")) ?? "treasurer";
  const community = one("community") === "rowing" ? ROWING_CLUB : LISTS_COMMUNITY;
  const off = (one("off") ?? "").split(",").filter(Boolean);
  return (
    <PreviewShell community={community.name} workspaces={sampleRail()}>
      <CountsView model={sampleCountsModel(role, sp, community, { modulesOff: off })} />
    </PreviewShell>
  );
}
