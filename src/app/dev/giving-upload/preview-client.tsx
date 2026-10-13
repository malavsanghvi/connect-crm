"use client";

import { PledgeUpload, type PledgeUploadBackend } from "@/components/giving-upload/pledge-upload";
import { dueRuleSentence } from "@/lib/giving-due";
import { sampleEarlier, sampleLookups, sampleRead, uploadConventions, UPLOAD_TODAY, type UploadCommunity } from "@/lib/giving-upload/fixtures";
import { readPledgeLines } from "@/lib/giving-upload/pledges";
import { dateExample } from "@/lib/giving-upload/sheet";

const later = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 350));

/** DEV ONLY: the pledge upload with invented data; nothing is sent anywhere. */
export function UploadPreview({ community, fresh }: { community: UploadCommunity; fresh: boolean }) {
  const conv = uploadConventions(community);
  const lookups = sampleLookups(community);
  const backend: PledgeUploadBackend = {
    prepare: async (input) =>
      later({
        ok: true as const,
        data: {
          read: readPledgeLines({ fileName: input.fileName, source: input.source, headers: input.headers, rows: input.rows }, conv, UPLOAD_TODAY, {
            household: "household",
          }),
          lookups,
          sameFile: null,
        },
      }),
    record: async (input) =>
      later({
        ok: true as const,
        message: `Recorded ${input.rows.length} pledges (preview: nothing was saved).`,
        data: {
          uploadId: "9a000000-0000-4000-8000-000000000099",
          replayed: false,
          count: input.rows.length,
          totalCents: input.rows.reduce((s, r) => s + r.amount_cents, 0),
          pledges: input.rows.map((r, i) => ({
            row: r.row,
            pledgeId: `9b000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
            pledgeNumber: `PL-${String(501 + i).padStart(4, "0")}`,
            householdId: r.household_id,
            amountCents: r.amount_cents,
            dueOn: r.due_on,
          })),
        },
      }),
    cancel: async () => later({ ok: true as const, message: "Cancelled the upload: 12 pledges cancelled (preview: nothing was saved).", data: { cancelled: 12 } }),
  };
  return (
    <PledgeUpload
      setting={{
        currency: lookups.currency,
        locale: lookups.locale,
        timeZone: community === "foodbank" ? "Europe/London" : "America/Chicago",
        labels: lookups.labels,
        household: "household",
        dueSentence: `${dueRuleSentence(lookups.dueDays)} A row without a due date gets that.`,
        dateExample: dateExample(conv),
        templateCsv: "#template",
        templateXlsx: "#template",
      }}
      backend={backend}
      earlier={sampleEarlier(community)}
      initial={fresh ? null : { fileName: community === "foodbank" ? "spring-pledges.csv" : "dinner-pledge-cards.csv", prepared: { read: sampleRead(community), lookups, sameFile: null } }}
    />
  );
}
