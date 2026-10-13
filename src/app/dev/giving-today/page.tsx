import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { TodayPage } from "@/components/giving-today/today-page";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { TODAY_COMMUNITY, sampleTodayModel, type TodayRole } from "@/lib/giving-today/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving Today · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-today" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-today"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

const ROLES: readonly TodayRole[] = ["treasurer", "approver", "volunteer"];

/**
 * DEV ONLY. Giving › Today (New look) inside the shell, with invented data for a neutral community club, drawn without a
 * database or a session. `?role=approver` shows a second approver who holds only giving.approve, `?role=volunteer` a finance
 * volunteer (giving.record_offline); `?show=bank` opens with a tile chosen. The buttons call the real Server Actions, which
 * refuse without a session. Returns notFound() in production.
 */
export default async function GivingTodayPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const role = ROLES.find((r) => r === sp.role) ?? "treasurer";
  const show = typeof sp.show === "string" ? sp.show : undefined;
  return (
    <PreviewShell community={TODAY_COMMUNITY} workspaces={sampleRail()}>
      <TodayPage model={sampleTodayModel(role, { show })} />
    </PreviewShell>
  );
}
