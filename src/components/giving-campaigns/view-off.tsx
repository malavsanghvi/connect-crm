// What a view of Giving › Campaigns & opportunities says when it cannot open (New look): the module is switched off, the kind
// of organization never has it, or the person's roles do not reach it. The same words ModuleGate and NoAccess use, drawn
// without a session so the dev preview and the tests show them too. Never an empty page.

import Link from "next/link";

import { NoAccess, buttonClass } from "@/components/ui";
import type { CampaignView } from "@/lib/giving-campaigns/views";
import { notOfferedExplanation, notPartOfKindSentence } from "@/lib/kind";
import { moduleOffMessage } from "@/lib/modules";

export function ViewOff({
  view,
  communityName,
  kindLabel,
  canOpenSettings,
}: {
  view: CampaignView;
  communityName: string;
  kindLabel: string;
  canOpenSettings: boolean;
}) {
  if (view.state === "no_access") return <NoAccess area={view.label} access={view.access} />;
  if (view.state === "not_offered") {
    return (
      <div className="cc-card px-6 py-10 text-center" data-testid="view-not-offered">
        <p className="font-display text-[22px] font-semibold text-ink">{notPartOfKindSentence(view.label, kindLabel)}</p>
        <p role="status" className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
          {notOfferedExplanation(communityName, kindLabel)}
        </p>
      </div>
    );
  }
  return (
    <div className="cc-card px-6 py-10 text-center" data-testid="view-off">
      <p className="font-display text-[22px] font-semibold text-ink">{view.label} is switched off</p>
      <p role="status" className="mx-auto mt-2 max-w-lg text-[13px] text-muted">
        {moduleOffMessage(view.module, communityName, view.label)}
      </p>
      {canOpenSettings ? (
        <p className="mt-4">
          <Link href="/settings/modules" className={buttonClass("primary", "sm")}>
            Open Settings › Modules
          </Link>
        </p>
      ) : null}
    </div>
  );
}
