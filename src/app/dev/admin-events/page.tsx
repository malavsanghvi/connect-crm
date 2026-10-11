import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EventOverview } from "@/components/events-v2/event-workspace";
import { PreviewNiva } from "@/components/events-v2/preview-niva";
import { AppShell } from "@/components/shell/app-shell";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { sampleOverview, sampleSession } from "@/lib/events/workspace-fixtures";

export const metadata: Metadata = { title: "Event workspace · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * DEV ONLY. The new-look Events workspace (board admin-v2/Events.dc.html) inside the v2 shell, with invented sample data for a
 * neutral community club and no database or session. `?lang=es` starts the reminder on another language tab (Spanish needs
 * translating in this sample). Returns notFound() in production (and the proxy lets /dev through without a session only outside it).
 */
export default async function AdminEventsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const lang = typeof sp.lang === "string" ? sp.lang : undefined;
  return (
    <AppShell session={sampleSession()} tasks={null} look="v2">
      <p className="sr-only">Dev preview with sample data</p>
      <PreviewNiva>
        <EventOverview {...sampleOverview()} initialLanguage={lang} />
      </PreviewNiva>
    </AppShell>
  );
}
