"use client";

import { DonationUpload, type DonationUploadBackend } from "@/components/giving-upload/donation-upload";
import { PledgeUpload, type PledgeUploadBackend } from "@/components/giving-upload/pledge-upload";
import { dueRuleSentence } from "@/lib/giving-due";
import { readDonationLines } from "@/lib/giving-upload/donations";
import {
  sampleDonationLookups,
  sampleDonationRead,
  sampleEarlier,
  sampleLookups,
  sampleRead,
  uploadConventions,
  UPLOAD_TODAY,
  type UploadCommunity,
} from "@/lib/giving-upload/fixtures";
import { readPledgeLines } from "@/lib/giving-upload/pledges";
import { dateExample } from "@/lib/giving-upload/sheet";

const later = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), 350));

/** DEV ONLY: the donations upload with invented data; nothing is sent anywhere. `volunteer`: may record but not apply. */
export function DonationPreview({ community, fresh, volunteer }: { community: UploadCommunity; fresh: boolean; volunteer: boolean }) {
  const conv = uploadConventions(community);
  const lookups = sampleDonationLookups(community, !volunteer);
  const backend: DonationUploadBackend = {
    prepare: async (input) =>
      later({
        ok: true as const,
        data: {
          read: readDonationLines({ fileName: input.fileName, source: input.source, headers: input.headers, rows: input.rows }, conv, UPLOAD_TODAY, {
            household: "household",
          }),
          lookups,
          sameFile: null,
        },
      }),
    record: async (input) => {
      const total = input.rows.reduce((s, r) => s + r.amount_cents, 0);
      const applied = input.rows.reduce((s, r) => s + r.allocations.reduce((t, a) => t + a.amount_cents, 0), 0);
      return later({
        ok: true as const,
        message: `Recorded ${input.rows.length} payments; ${(applied / 100).toFixed(2)} applied to pledges (preview: nothing was saved).`,
        data: {
          uploadId: "9a000000-0000-4000-8000-000000000098",
          replayed: false,
          count: input.rows.length,
          totalCents: total,
          notApplied: volunteer ? input.rows.length : 0,
          receipts: "No receipts were emailed for these payments.",
          payments: input.rows.map((r, i) => ({
            row: r.row,
            paymentId: `9b000000-0000-4000-8000-${String(i + 101).padStart(12, "0")}`,
            receiptNumber: `R-2026-${String(501 + i).padStart(4, "0")}`,
            householdId: r.household_id,
            amountCents: r.amount_cents,
            appliedCents: r.allocations.reduce((t, a) => t + a.amount_cents, 0),
          })),
        },
      });
    },
  };
  return (
    <DonationUpload
      setting={{
        currency: lookups.currency,
        locale: lookups.locale,
        timeZone: community === "foodbank" ? "Europe/London" : "America/Chicago",
        labels: lookups.labels,
        household: "household",
        dateExample: dateExample(conv),
        canAllocate: !volunteer,
        templateCsv: "#template",
        templateXlsx: "#template",
        importHref: volunteer ? null : "#import",
      }}
      backend={backend}
      earlier={sampleEarlier(community).map((u) => ({ ...u, cancellable: false, note: null }))}
      initial={fresh ? null : { fileName: community === "foodbank" ? "october-gifts.csv" : "sunday-collection.csv", prepared: { read: sampleDonationRead(community), lookups, sameFile: null } }}
    />
  );
}

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
          emails: input.sendEmails !== false,
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
    // Invented: the first pledge has no email address on file, the rest were sent (preview: nothing is sent).
    emailStatus: async (ids) =>
      later({
        ok: true as const,
        data: ids.map((id, i) => ({
          pledgeId: id,
          number: `PL-${String(501 + i).padStart(4, "0")}`,
          state: i === 0 ? ("no_email" as const) : ("sent" as const),
          reason: i === 0 ? "Not sent: The primary member (Rahul Shah) has no email address on file." : null,
        })),
      }),
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
