import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { BankTab } from "@/components/giving-bank/bank-tab";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { BANK_COMMUNITIES, sampleBankModel, type BankCommunity, type BankRole } from "@/lib/giving-bank/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Giving Bank · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const ROLES: readonly BankRole[] = ["treasurer", "volunteer", "viewer", "approver"];
const COMMUNITIES: readonly BankCommunity[] = ["club", "allotment"];

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/giving-bank" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/giving-bank"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/**
 * DEV ONLY. Giving › Bank (New look) inside the shell, with invented data, drawn without a database or a session. `?view=` match,
 * deposits, zelle, payouts or history (`&show=ignored` or `out`); `?role=volunteer` a finance volunteer (matches, cannot set aside),
 * `?role=viewer` someone with giving.view only (lines without buttons), `?role=approver` someone without access;
 * `?community=allotment` a non-faith society in pounds without Zelle; `?accounting=off` hides Card payouts; `?bank=off` shows the
 * switched-off message. The buttons call the real Server Actions, which refuse without a session. Returns notFound() in production.
 */
export default async function GivingBankPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const role = ROLES.find((r) => r === sp.role) ?? "treasurer";
  const community = COMMUNITIES.find((c) => c === sp.community) ?? "club";
  const model = sampleBankModel({ community, role, view: one(sp.view), show: one(sp.show), accounting: sp.accounting !== "off", bankOff: sp.bank === "off" });
  return (
    <PreviewShell community={BANK_COMMUNITIES[community].name} workspaces={sampleRail()}>
      <BankTab
        model={model}
        importer={<p className="m-0 text-[14px] text-muted">The statement importer appears here (the real page uses today&apos;s importer).</p>}
      />
    </PreviewShell>
  );
}
