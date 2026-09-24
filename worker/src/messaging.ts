// Sending one app.messages row (messaging.send, messaging.test_send, and the
// STOP/HELP replies of messaging.webhook.twilio). The provider calls live in the
// portal's src/lib/messaging (shared with the Auth hooks); this file decides
// which one, records the outcome, and turns provider failures into honest job
// failures: a missing platform variable → NotConfiguredError (never retried), a
// provider's 4xx → PermanentError, anything else is retried by the queue.

import { brandingUrl, fromHeader, renderEmail } from "../../src/lib/messaging/email";
import { MissingConfigError, ProviderError, sendEmail, emailKey, sendExpoPush, sendTwilio, type Req } from "../../src/lib/messaging/providers";
import { unsubscribeUrl } from "../../src/lib/messaging/signatures";
import { smsLength } from "../../src/lib/messaging/sms";
import { NotConfiguredError, PermanentError, messageOf } from "./errors";
import type { Http } from "./http";
import type { Job, JobContext } from "./types";

export function reqFrom(http: Http): Req {
  return async (url, init) => {
    const r = await http.request(url, { method: init.method, headers: init.headers, body: init.body, retries: 1 });
    return { status: r.status, text: r.text };
  };
}

type Brand = { name: string; short_name: string; logo_path: string | null; primary_color: string | null; public_email: string | null } | null;
type ToSend = {
  id: string; center_id: string | null; channel: "email" | "sms" | "push" | "whatsapp"; to: string; purpose: string;
  subject: string | null; body: string; sandbox: boolean; skip: string | null; payload: Record<string, unknown>;
  brand: Brand; route: Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

async function record(ctx: JobContext, id: string, status: string, provider: string | null, ref: string | null, error: string | null, segments: number | null) {
  await ctx.db.query("select app.worker_message_result($1, $2, $3, $4, $5, $6)", [id, status, provider, ref, error, segments]);
}

/** Sends one queued message; returns what happened. Throws for the queue to retry or fail the job. */
export async function sendMessage(ctx: JobContext, messageId: string, job: Pick<Job, "attempts" | "max_attempts"> | null) {
  const rows = await ctx.db.query<{ m: ToSend }>("select app.worker_message_to_send($1) as m", [messageId]);
  const m = rows[0]?.m;
  if (!m) throw new PermanentError(`Message ${messageId} was not found.`);
  if (m.skip) {
    if (m.skip.startsWith("The message is already")) return { message_id: m.id, skipped: m.skip };
    await record(ctx, m.id, "suppressed", null, null, m.skip, null);
    return { message_id: m.id, status: "suppressed", reason: m.skip };
  }
  const req = reqFrom(ctx.http);
  const env = ctx.env;
  let provider = String(m.route.provider ?? m.channel);
  try {
    if (m.channel === "email") {
      const p = (m.route.provider === "postmark" ? "postmark" : "resend") as "resend" | "postmark";
      provider = p;
      const sender = (m.route.sender ?? null) as { from_name: string; from_address: string; reply_to: string | null } | null;
      if (!sender && !str(env.MESSAGING_FROM_ADDRESS)) {
        throw new MissingConfigError("Email sending isn't configured on the Community Connect server yet (MESSAGING_FROM_ADDRESS not set)");
      }
      const brand = m.brand ? { name: m.brand.name, short_name: m.brand.short_name, primary_color: m.brand.primary_color, logo_url: brandingUrl(env.SUPABASE_URL, m.brand.logo_path) } : null;
      const unsub = m.route.unsubscribe === true ? unsubscribeUrl(env.PORTAL_PUBLIC_URL, env.MESSAGING_LINK_SECRET, m.id) : null;
      if (m.route.unsubscribe === true && !unsub) ctx.log.warn("no unsubscribe link: PORTAL_PUBLIC_URL or MESSAGING_LINK_SECRET is not set", { message: m.id });
      const footer = (m.route.footer ?? null) as { postal_address: string | null; note: string | null } | null;
      const email = renderEmail({ subject: m.subject ?? "", body: m.body, brand, footer, sandbox: m.sandbox, unsubscribeUrl: unsub });
      const res = await sendEmail(req, env, p, emailKey(env, p, null), {
        from: fromHeader(sender, brand, { address: str(env.MESSAGING_FROM_ADDRESS) ?? "", name: str(env.MESSAGING_FROM_NAME) ?? "Community Connect" }),
        to: m.to, subject: email.subject, html: email.html, text: email.text,
        replyTo: sender?.reply_to ?? (sender ? null : m.brand?.public_email ?? null), unsubscribeUrl: unsub,
      });
      await record(ctx, m.id, "sent", p, res.id, null, null);
      return { message_id: m.id, status: "sent", provider: p, provider_ref: res.id };
    }
    if (m.channel === "sms" || m.channel === "whatsapp") {
      provider = "twilio";
      const whatsapp = m.channel === "whatsapp";
      const reply = str(m.payload.reply_from);
      let from = reply ?? str(m.route.from_number);
      const serviceSid = reply ? null : str(m.route.messaging_service_sid);
      if (m.center_id === null && !from) from = str(env.TWILIO_FROM_NUMBER);
      if (whatsapp && m.route.approved !== true) {
        throw new PermanentError("WhatsApp is not approved by Meta yet for this community, so nothing was sent.");
      }
      if (!whatsapp && !reply && m.center_id !== null && m.route.connected !== true) {
        throw new PermanentError("Texting is not set up for this community yet: its registration is not approved, so nothing was sent.");
      }
      const callback = str(env.PORTAL_PUBLIC_URL) ? `${env.PORTAL_PUBLIC_URL!.replace(/\/+$/, "")}/api/webhooks/twilio` : null;
      const segments = smsLength(m.body).segments;
      const res = await sendTwilio(req, env, { to: m.to, body: m.body, from, messagingServiceSid: serviceSid, statusCallback: callback, whatsapp });
      await record(ctx, m.id, "sent", "twilio", res.sid, null, whatsapp ? null : segments);
      return { message_id: m.id, status: "sent", provider: "twilio", provider_ref: res.sid, segments };
    }
    provider = "expo_push";
    const tokens = Array.isArray(m.route.tokens) ? (m.route.tokens as string[]) : [];
    if (tokens.length === 0) throw new PermanentError("No phone is registered for notifications for this member, so nothing was sent.");
    const tickets = await sendExpoPush(req, env, tokens, m.subject, m.body, { message_id: m.id, center_id: m.center_id, purpose: m.purpose });
    const dead = tickets.filter((t) => t.dead).map((t) => t.token);
    if (dead.length > 0) await ctx.db.query("select app.worker_push_result($1, $2, $3)", [m.id, dead, "DeviceNotRegistered"]);
    const ok = tickets.filter((t) => t.ok);
    if (ok.length === 0) throw new PermanentError(`Expo did not accept the notification: ${tickets[0]?.error ?? "no ticket"}`);
    await record(ctx, m.id, "sent", "expo_push", ok.map((t) => t.id).filter(Boolean).join(",") || null, null, null);
    return { message_id: m.id, status: "sent", provider: "expo_push", phones: ok.length, dead: dead.length };
  } catch (err) {
    const permanent = err instanceof MissingConfigError || err instanceof PermanentError || (err instanceof ProviderError && err.permanent);
    const lastTry = job !== null && job.attempts >= job.max_attempts;
    if (permanent || lastTry || job === null) {
      await record(ctx, m.id, "failed", provider, null, messageOf(err), null).catch((e: unknown) =>
        ctx.log.error("could not record the failed message", { message: m.id, error: e }),
      );
    }
    if (err instanceof MissingConfigError) throw new NotConfiguredError(err.message);
    if (permanent) throw err instanceof PermanentError ? err : new PermanentError(messageOf(err));
    throw err;
  }
}

export function messageIdOf(job: Job): string {
  const id = job.payload?.message_id;
  if (typeof id !== "string") throw new PermanentError(`${job.kind}: message_id is required.`);
  return id;
}
