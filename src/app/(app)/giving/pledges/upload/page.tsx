import type { Metadata } from "next";
import Link from "next/link";

import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { PledgeUpload } from "@/components/giving-upload/pledge-upload";
import { Alert, NoAccess } from "@/components/ui";
import { CommandDbError } from "@/lib/commands/types";
import { earlierPledgeUploads, uploadSetting } from "@/lib/data/giving-upload";
import { failure } from "@/lib/errors";
import { dueRuleSentence } from "@/lib/giving-due";
import { givingTabs } from "@/lib/giving-today/tabs";
import { dateExample, type EarlierUpload } from "@/lib/giving-upload/sheet";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { cancelPledgeUploadAction, preparePledgeUploadAction, recordPledgeUploadAction } from "./actions";

export const metadata: Metadata = { title: "Upload pledges" };

/**
 * Giving › Pledges › Upload (GV-U slice B; NEEDS OWNER OK): many pledges from one spreadsheet, each through the rules of recording a
 * pledge by hand. giving.manage, as Record pledge. The Giving layout already says "switched off" when Giving is off.
 */
export default async function PledgeUploadPage() {
  const session = await getSession();
  const header = (
    <header className="mb-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Link href="/giving/pledges" className="text-[13px] font-semibold text-navy">
          ← Pledges
        </Link>
        <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">Upload pledges</h1>
        <p className="m-0 text-[14px] text-muted">Many pledges at once, from a spreadsheet: pledge cards, an event&apos;s sign-up sheet, a list from another system.</p>
      </div>
      <GivingTabRow tabs={givingTabs(session)} active="pledges" />
    </header>
  );
  if (!canAccess(session, "recordPledge")) {
    return (
      <>
        {header}
        <NoAccess area="Uploading pledges" access="recordPledge" />
      </>
    );
  }
  const s = uploadSetting(session);
  let earlier: EarlierUpload[] = [];
  let problem: string | null = null;
  try {
    earlier = await earlierPledgeUploads(session);
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
      <PledgeUpload
        setting={{
          currency: s.currency,
          locale: s.locale,
          timeZone: s.timeZone,
          labels: s.labels,
          household: s.household,
          dueSentence: `${dueRuleSentence(s.dueDays)} A row without a due date gets that.`,
          dateExample: dateExample(s.conv),
          templateCsv: "/giving/pledges/upload/template",
          templateXlsx: "/giving/pledges/upload/template?format=xlsx",
        }}
        backend={{ prepare: preparePledgeUploadAction, record: recordPledgeUploadAction, cancel: cancelPledgeUploadAction }}
        earlier={earlier}
      />
    </>
  );
}
