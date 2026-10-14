import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KpiGrid, PageHeader, Stat } from "@/components/ui";
import { devPreviewAllowed } from "@/lib/dev-preview";

export const metadata: Metadata = { title: "Spotlight · QuickBooks sync · Dev preview" };

/**
 * DEV ONLY. The top of Accounting › QuickBooks sync with invented numbers: the four tiles the tour lights (the real page,
 * src/app/(app)/accounting/qbo/page.tsx, carries the same data-spotlight key). Returns notFound() in production.
 */
export default function SpotlightBooksPreview() {
  if (!devPreviewAllowed()) notFound();
  return (
    <>
      <PageHeader title="Accounting" description="QuickBooks Online is the book of record · cash basis · the platform posts every money event once" tabs={false} />
      <div className="mb-4" data-spotlight="qbo-sync-status">
        <KpiGrid cols={4}>
          <Stat label="Posted today" value="3" hint="sales receipts, deposits, refunds" tone="success" />
          <Stat label="Pending" value="1" hint="waiting for the QuickBooks poster" tone="brown" />
          <Stat label="Exceptions" value="0" hint="all clear" tone="success" />
          <Stat label="Last sync" value="9:02 AM" hint="connection healthy" tone="navy" />
        </KpiGrid>
      </div>
    </>
  );
}
