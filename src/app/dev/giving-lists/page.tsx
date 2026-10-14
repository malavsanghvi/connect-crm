import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { PaymentsView } from "@/components/giving-lists/payments-view";
import { PledgesView } from "@/components/giving-lists/pledges-view";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { LISTS_COMMUNITY, ROWING_CLUB, samplePaymentsModel, samplePledgesModel, type ListsRole } from "@/lib/giving-lists/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving Pledges and Payments · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const ROLES: readonly ListsRole[] = ["treasurer", "approver", "volunteer"];

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-lists" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-lists"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/**
 * DEV ONLY. Giving › Pledges and Giving › Payments (New look) inside the shell, with invented data, drawn without a database or a
 * session. `?tab=payments` opens Payments; `?role=approver` a second approver who reads Giving, `?role=volunteer` a finance
 * volunteer (giving.record_offline); `?community=rowing` a non-faith club in euros without Zelle; `?off=giving_recurring,giving_bank`
 * switches add-ons off; `?paypal=email` connects PayPal by email only. `q`, `status`, `age`, `view`, `method`, `source` and
 * `rstatus` work as on the real tabs. The buttons call the real Server Actions, which refuse without a session.
 * Returns notFound() in production.
 */
export default async function GivingListsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const role = ROLES.find((r) => r === one("role")) ?? "treasurer";
  const community = one("community") === "rowing" ? ROWING_CLUB : LISTS_COMMUNITY;
  const off = (one("off") ?? "").split(",").filter(Boolean);
  return (
    <PreviewShell community={community.name} workspaces={sampleRail()}>
      {one("tab") === "payments" ? (
        <PaymentsView model={samplePaymentsModel(role, sp, community, { modulesOff: off, paypalEmailOnly: one("paypal") === "email" })} />
      ) : (
        <PledgesView model={samplePledgesModel(role, sp, community)} />
      )}
    </PreviewShell>
  );
}
