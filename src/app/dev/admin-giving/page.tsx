import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GivingPage } from "@/components/giving-workspace/giving-page";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { SAMPLE_CARDS, SAMPLE_COMMUNITY, SAMPLE_DRAFTS, sampleFlowState, sampleModel } from "@/lib/giving-workspace/fixtures";
import { WORKSPACES } from "@/lib/workspaces";

import { PreviewShell } from "./preview-shell";

export const metadata: Metadata = { title: "Giving · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** The rail of a treasurer at a community club (no Learning, Store or Platform), with Giving lit for this preview's address. */
function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/admin-giving" : "/",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/admin-giving"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/**
 * DEV ONLY. The Giving workspace page (New look) inside the shell, with invented data for a neutral community club, drawn
 * without a database or a session so its look can be checked and screenshotted. `?state=card` shows the second household
 * picked: no open pledge, so the card asks whether it is the right household, with the second person's checks open.
 * `?state=empty` shows the page before anything is asked; `?record=card` shows a community that ticked recording from the card.
 * Returns notFound() in production (and the proxy lets /dev through without a session only outside production).
 */
export default async function AdminGivingPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const state = typeof sp.state === "string" ? sp.state : "";
  const initial = state === "empty" ? undefined : state === "card" ? sampleFlowState("second", { evidenceOpen: true }) : sampleFlowState("first");
  return (
    <PreviewShell community={SAMPLE_COMMUNITY} workspaces={sampleRail()}>
      <GivingPage model={sampleModel({ recordByCard: sp.record === "card" })} initial={initial} demo={{ cards: SAMPLE_CARDS, drafts: SAMPLE_DRAFTS }} />
    </PreviewShell>
  );
}
