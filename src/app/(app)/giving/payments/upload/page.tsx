import type { Metadata } from "next";
import Link from "next/link";

import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { DonationUpload } from "@/components/giving-upload/donation-upload";
import { Alert, NoAccess } from "@/components/ui";
import { CommandDbError } from "@/lib/commands/types";
import { earlierDonationUploads, uploadSetting } from "@/lib/data/giving-upload";
import { failure } from "@/lib/errors";
import { givingTabs } from "@/lib/giving-today/tabs";
import { dateExample, type EarlierUpload } from "@/lib/giving-upload/sheet";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { prepareDonationUploadAction, recordDonationUploadAction } from "./actions";

export const metadata: Metadata = { title: "Upload donations" };

/**
 * Giving › Payments › Upload (GV-U slice C; NEEDS OWNER OK): many offline payments from one spreadsheet, each through the rules of
 * recording a payment by hand. giving.record_offline or giving.manage, as Record payment. The Giving layout already says "switched
 * off" when Giving is off.
 */
export default async function DonationUploadPage() {
  const session = await getSession();
  const header = (
    <header className="mb-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link href="/giving/payments" className="text-[13px] font-semibold text-navy">
          ← Payments
        </Link>
        <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">Upload donations</h1>
        <p className="m-0 text-[14px] text-muted">Many payments at once, from a spreadsheet: a collection&apos;s checks, bank transfers, a list from another system.</p>
      </div>
      <GivingTabRow tabs={givingTabs(session)} active="payments" />
    </header>
  );
  if (!canAccess(session, "recordPayment")) {
    return (
      <>
        {header}
        <NoAccess area="Uploading donations" access="recordPayment" />
      </>
    );
  }
  const s = uploadSetting(session);
  let earlier: EarlierUpload[] = [];
  let problem: string | null = null;
  try {
    earlier = await earlierDonationUploads(session);
  } catch (error) {
    problem = failure("Could not read the earlier uploads; uploading still works", error instanceof CommandDbError ? error.dbError : error).error;
  }
  return (
    <>
      {header}
      {problem ? (
        <div className="mb-3">
          <Alert tone="warning">{problem}</Alert>
        </div>
      ) : null}
      <DonationUpload
        setting={{
          currency: s.currency,
          locale: s.locale,
          timeZone: s.timeZone,
          labels: s.labels,
          household: s.household,
          dateExample: dateExample(s.conv),
          canAllocate: canAccess(session, "allocatePayment"),
          templateCsv: "/giving/payments/upload/template",
          templateXlsx: "/giving/payments/upload/template?format=xlsx",
          importHref: canAccess(session, "dataImport") ? "/settings/import" : null,
        }}
        backend={{ prepare: prepareDonationUploadAction, record: recordDonationUploadAction }}
        earlier={earlier}
      />
    </>
  );
}
