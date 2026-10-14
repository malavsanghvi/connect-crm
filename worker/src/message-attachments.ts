// Files that go with an email. A message names them in its payload by id only ({ attachments: [{ kind: "pledge_pdf", pledge_id }] }):
// no bytes and nothing about a person travel through the job queue. When the message is sent, this service reads what the file
// needs from the database (app.worker_pledge_document, which answers only for a pledge the message itself names) and draws it
// here, with the same builder and renderer the portal's Print route uses (src/lib/pledge-pdf), so the copy attached to the email
// is the copy staff print.
//
// A file that cannot be made stops the email (it is recorded as failed with a plain reason): the PDF is the point of the message.
// A logo that cannot be loaded never does; the community's name is drawn instead.

import { ageOfMajority } from "../../src/lib/age-of-majority";
import { MAX_ATTACHMENT_BYTES, attachmentBytes, type EmailAttachment } from "../../src/lib/messaging/providers";
import { buildPledgeDocument, type PledgeDocData } from "../../src/lib/pledge-pdf/document";
import { firstDrawableLogo } from "../../src/lib/pledge-pdf/logo";
import { renderPledgePdf } from "../../src/lib/pledge-pdf/render";
import { PermanentError, messageOf } from "./errors";
import type { JobContext } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** At most this many files on one message. */
export const MAX_ATTACHMENTS = 3;

export type AttachmentSpec = { kind: "pledge_pdf"; pledgeId: string };

/** The files a message's payload asks for; anything it does not understand is refused, never ignored (a missing PDF must not go unnoticed). */
export function attachmentSpecs(payload: Record<string, unknown> | null | undefined): AttachmentSpec[] {
  const raw = payload?.attachments;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) throw new PermanentError("This message asks for attachments in a form the sender does not understand, so it was not sent.");
  return raw.map((a): AttachmentSpec => {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    if (o.kind === "pledge_pdf" && typeof o.pledge_id === "string" && UUID.test(o.pledge_id)) return { kind: "pledge_pdf", pledgeId: o.pledge_id };
    throw new PermanentError("This message asks for an attachment the sender does not know how to make, so it was not sent.");
  });
}

type MessageRef = { id: string; payload: Record<string, unknown> };

async function pledgePdf(ctx: JobContext, m: MessageRef, pledgeId: string): Promise<EmailAttachment> {
  // The age of majority, from the community's place (the same reading messaging.compose does), so no child's name is on the page.
  const automationId = typeof m.payload.automation_id === "string" && UUID.test(m.payload.automation_id) ? m.payload.automation_id : null;
  let majority = 18;
  if (automationId) {
    const place = (await ctx.db.query<{ c: Record<string, unknown> | null }>("select app.worker_email_context($1::uuid) as c", [automationId]))[0]?.c;
    if (place) {
      majority = ageOfMajority({
        country: typeof place.country === "string" ? place.country : null,
        state_region: typeof place.state_region === "string" ? place.state_region : null,
        rules: { age_of_majority: place.age_of_majority },
      });
    }
  }
  const doc = (await ctx.db.query<{ d: PledgeDocData | null }>("select app.worker_pledge_document($1::uuid, $2::uuid, $3::int) as d", [m.id, pledgeId, majority]))[0]?.d;
  if (!doc) throw new PermanentError("The pledge could not be read, so its PDF could not be attached and the email was not sent.");

  const view = buildPledgeDocument(doc, { supabaseUrl: ctx.env.SUPABASE_URL ?? null });
  const logo = await firstDrawableLogo(view.logoUrls, async (url) => {
    const res = await ctx.http.request(url, { retries: 1, timeoutMs: 8000 });
    return res.status === 200 ? res.bytes() : null;
  });
  let bytes: Uint8Array;
  try {
    bytes = (await renderPledgePdf(view, logo)).bytes;
  } catch (err) {
    ctx.log.error("the pledge PDF could not be drawn", { message: m.id, pledge: pledgeId, error: messageOf(err) });
    throw new PermanentError("The pledge's PDF could not be made, so the email was not sent.");
  }
  return { filename: view.fileName, contentType: "application/pdf", content: Buffer.from(bytes).toString("base64") };
}

/** Makes every file the message asks for. Throws PermanentError for what retrying cannot fix, anything else is retried by the queue. */
export async function buildAttachments(ctx: JobContext, m: MessageRef): Promise<EmailAttachment[]> {
  const specs = attachmentSpecs(m.payload);
  const out: EmailAttachment[] = [];
  for (const spec of specs) out.push(await pledgePdf(ctx, m, spec.pledgeId));
  if (attachmentBytes(out) > MAX_ATTACHMENT_BYTES) throw new PermanentError("The attachment is larger than a message may carry, so the email was not sent.");
  return out;
}
