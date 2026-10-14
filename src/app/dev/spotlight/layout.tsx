import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { DemoBanner } from "@/components/demo-banner";
import type { RailWorkspace } from "@/components/shell/workspace-rail";
import { SpotlightProvider } from "@/components/spotlight/spotlight-provider";
import { TourMenuItem } from "@/components/spotlight/tour-menu";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { WORKSPACES } from "@/lib/workspaces";

import { previewTour } from "./preview-tour";

function sampleRail(): RailWorkspace[] {
  return WORKSPACES.filter((w) => !["learning", "store", "platform"].includes(w.key)).map((w) => ({
    key: w.key,
    label: w.label,
    href: w.key === "giving" ? "/dev/spotlight/bank" : w.key === "today" ? "/dev/spotlight" : "/dev/spotlight",
    icon: w.icon,
    placement: w.placement,
    paths: w.key === "giving" ? ["/dev/spotlight/bank", "/dev/spotlight/books"] : w.key === "today" ? ["/dev/spotlight"] : [`/__preview/${w.key}`],
    tabs: [],
  }));
}

/**
 * DEV ONLY. Spotlight (docs/SPOTLIGHT.md) in a frame like the portal's: the sample treasurer has the tour, the demo banner carries
 * "Take the tour", and the Tour item sits at the top of the page. The pages are /dev/spotlight (Home), /bank and /books, drawn with invented
 * data and no database. Returns notFound() in production.
 */
export default function SpotlightPreviewLayout({ children }: { children: ReactNode }) {
  if (!devPreviewAllowed()) notFound();
  return (
    <SpotlightProvider userId="dev-preview" tours={[previewTour()]}>
      <DemoBanner info={{ role: "Treasurer", name: "Grace Lindqvist", centerName: "Lakeside Community Club", secondsLeft: 6000 }} />
      <PreviewShell community="Lakeside Community Club" workspaces={sampleRail()}>
        <div className="mb-3 flex justify-end">
          <TourMenuItem variant="bar" />
        </div>
        {children}
      </PreviewShell>
    </SpotlightProvider>
  );
}
