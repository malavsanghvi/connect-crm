import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/admin-giving/preview-shell";
import { AccountMappingView } from "@/components/books/account-mapping";
import { PageHeader } from "@/components/ui";
import { sampleAccountMapping, type MappingSample } from "@/lib/books/mapping-fixtures";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { TODAY_COMMUNITY } from "@/lib/giving-today/fixtures";

export const metadata: Metadata = { title: "Account mapping · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const SAMPLES: readonly MappingSample[] = ["in_use", "setup", "mine"];

/**
 * DEV ONLY. Giving › Books › Account mapping (New look) with invented data, drawn without a database or a session.
 * `?state=in_use` (default): the mapping is approved and a dues account waits for a second person; `?state=setup`: nothing
 * approved yet, one person chooses; `?state=mine`: the waiting change is the viewer's own (only withdraw is offered). The
 * buttons call the real Server Actions, which refuse without a session. Returns notFound() in production.
 */
export default async function AccountMappingPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const sample = SAMPLES.find((s) => s === sp.state) ?? "in_use";
  return (
    <PreviewShell community={TODAY_COMMUNITY} workspaces={[]}>
      <PageHeader title="Books" description="Account mapping · which QuickBooks account each fund and kind of money posts to, and every change to it" />
      <AccountMappingView data={sampleAccountMapping(sample)} timeZone="America/Chicago" />
    </PreviewShell>
  );
}
