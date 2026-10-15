import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TourInvite } from "@/components/spotlight/tour-invite";
import { Card, PageHeader, Tag, buttonClass } from "@/components/ui";
import { devPreviewAllowed } from "@/lib/dev-preview";

export const metadata: Metadata = { title: "Spotlight · Dev preview" };

/**
 * DEV ONLY. The treasurer's Home with invented data: the invitation card, and the "bank lines to match" row the tour starts from. The
 * row is drawn like the real one (src/components/home/my-tasks-card.tsx), which carries the same data-spotlight key. Returns notFound() in production.
 */
export default function SpotlightHomePreview() {
  if (!devPreviewAllowed()) notFound();
  return (
    <>
      <PageHeader title="Good morning, Grace" description="My tasks across every module you can act on" tabs={false} />
      <TourInvite />
      <Card title="My tasks" description="2 things need you" padded={false}>
        <div className="px-[18px] pb-2">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-soft py-3" data-spotlight="home-bank-task">
            <Tag color="brown">Deposits</Tag>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-snug text-ink">4 bank lines to match</p>
              <p className="text-[13px] leading-snug text-muted">Money in without a matched gift · 1 check or cash deposit</p>
            </div>
            <Link href="/dev/spotlight/bank" className={buttonClass("primary", "sm")}>
              Open
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3 py-3">
            <Tag color="brown">Write-off</Tag>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-snug text-ink">A write-off waits for a second approver</p>
              <p className="text-[13px] leading-snug text-muted">Asked for by a colleague</p>
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
