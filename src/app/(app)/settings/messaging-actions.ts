"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction, dbWithReason } from "@/lib/session";
import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import { parseTextingDetail } from "@/lib/messaging/labels";

// Settings › Email / Texting / WhatsApp / Notifications (o-messaging). Every
// change goes through an app.* RPC that checks settings.manage or
// integrations.manage, needs a reason and is audited with it (0222).

const reasonOf = (fd: FormData, dflt: string) => String(fd.get("reason") ?? "").trim() || dflt;
const CHANNEL_LABEL: Record<string, string> = { email: "email", sms: "text", whatsapp: "WhatsApp", push: "push notification" };

function done(paths: string[], message: string): ActionResult {
  for (const p of paths) revalidatePath(p);
  return { ok: true, message };
}

export async function setEmailProviderAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const provider = String(fd.get("provider") ?? "");
  if (provider !== "resend" && provider !== "postmark") return { ok: false, error: "Could not change the email service — choose Resend or Postmark." };
  const auth = await authorizeAction("messagingManage", "change the email service");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, `Email service: ${provider}`);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("set_email_provider", { p_center: auth.session.center.id, p_provider: provider, p_reason: reason });
  if (error) return failure("Could not change the email service", error);
  return done(["/settings/email"], `Email goes through ${provider === "resend" ? "Resend" : "Postmark"} · domains are added there again`);
}

export async function addEmailDomainAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const domain = String(fd.get("domain") ?? "").trim();
  if (!domain) return { ok: false, error: "Could not add the domain — enter it, for example mail.example.org." };
  const auth = await authorizeAction("messagingManage", "add the sending domain");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, `Sending domain ${domain}`);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("add_email_domain", { p_center: auth.session.center.id, p_domain: domain, p_reason: reason });
  if (error) return failure("Could not add the domain", error);
  return done(["/settings/email", "/setup"], "Domain added · its DNS records appear here within a minute");
}

export async function recheckEmailDomainAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const auth = await authorizeAction("messagingManage", "check the domain");
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("recheck_email_domain", { p_domain: id });
  if (error) return failure("Could not check the domain", error);
  return done(["/settings/email"], "Checking the DNS records now · reload in a minute");
}

export async function saveEmailSenderAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const purpose = String(fd.get("purpose") ?? "");
  const auth = await authorizeAction("messagingManage", "save the sender");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, `Email sender (${purpose})`);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("save_email_sender", {
    p_center: auth.session.center.id, p_purpose: purpose,
    p_from_name: String(fd.get("from_name") ?? ""), p_from_address: String(fd.get("from_address") ?? ""),
    p_reply_to: String(fd.get("reply_to") ?? ""), p_reason: reason,
  });
  if (error) return failure("Could not save the sender", error);
  return done(["/settings/email"], "Sender saved");
}

export async function saveEmailFooterAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("messagingManage", "save the footer");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, "Email footer");
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("save_email_footer", {
    p_center: auth.session.center.id, p_postal_address: String(fd.get("postal_address") ?? ""), p_note: String(fd.get("note") ?? ""), p_reason: reason,
  });
  if (error) return failure("Could not save the footer", error);
  return done(["/settings/email"], "Footer saved · it is on every email from now on");
}

export async function sendTestAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const channel = String(fd.get("channel") ?? "");
  if (!(channel in CHANNEL_LABEL)) return { ok: false, error: "Could not send the test — unknown channel." };
  const to = String(fd.get("to") ?? "").trim();
  const auth = await authorizeAction("messagingTest", `send a test ${CHANNEL_LABEL[channel]}`);
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("send_test_message", { p_center: auth.session.center.id, p_channel: channel, p_to: to || undefined });
  if (error) return failure(`Could not send the test ${CHANNEL_LABEL[channel]}`, error);
  const { data: msg, error: readErr } = await auth.session.db.from("messages").select("status, failure_reason").eq("id", data as string).maybeSingle();
  if (readErr) console.error("[settings/messaging] could not read back the test message:", readErr);
  const paths = ["/settings/email", "/settings/texting", "/settings/whatsapp", "/settings/notifications"];
  if (msg?.status === "suppressed") {
    for (const p of paths) revalidatePath(p);
    return { ok: false, error: `The test ${CHANNEL_LABEL[channel]} was not sent — ${msg.failure_reason ?? "the address is suppressed"}` };
  }
  return done(paths, `Test ${CHANNEL_LABEL[channel]} queued ${to ? `to ${to}` : "to you"} · its result appears under Recent messages`);
}

export async function liftSuppressionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Could not lift the suppression — give a reason (it goes in the audit log)." };
  const auth = await authorizeAction("messagingManage", "lift the suppression");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("lift_message_suppression", { p_id: id, p_reason: reason });
  if (error) return failure("Could not lift the suppression", error);
  return done(["/settings/email", "/settings/texting"], "Suppression lifted · messages go to this address again");
}

export async function addSuppressionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const channel = String(fd.get("channel") ?? "");
  const address = String(fd.get("address") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { ok: false, error: "Could not suppress the address — give a reason (it goes in the audit log)." };
  const auth = await authorizeAction("messagingManage", "suppress the address");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("add_message_suppression", { p_center: auth.session.center.id, p_channel: channel, p_address: address, p_reason: reason });
  if (error) return failure("Could not suppress the address", error);
  return done(["/settings/email", "/settings/texting"], "Address suppressed · nothing is sent to it until the suppression is lifted");
}

export async function saveTextingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const kind = String(fd.get("kind") ?? "");
  const submit = String(fd.get("submit") ?? "") === "1";
  const auth = await authorizeAction("messagingManage", submit ? "submit the texting registration" : "save the texting registration");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, submit ? `Submit ${kind} texting registration` : `Texting registration draft (${kind})`);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("save_texting_registration", {
    p_center: auth.session.center.id, p_kind: kind, p_detail: parseTextingDetail(fd) as Json, p_submit: submit, p_reason: reason,
  });
  if (error) return failure(submit ? "Could not submit the registration" : "Could not save the registration", error);
  return done(["/settings/texting", "/setup"], submit ? "Submitted · carriers take days to weeks; the status shows here" : "Draft saved");
}

export async function setPhoneSignInAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const on = String(fd.get("phone_sign_in") ?? "") === "on";
  const auth = await authorizeAction("centerSettings", on ? "switch phone sign-in on" : "switch phone sign-in off");
  if (!auth.ok) return auth;
  const expected = expectedVersion(fd.get("version"));
  if (expected === "invalid") return { ok: false, error: "Could not save — the page is out of date. Reload and try again." };
  const r = await writeCenterRules(auth.session, { mode: "patch", rules: { security: { phone_sign_in: on } } }, expected, "phone sign-in setting", (v) =>
    on ? `Phone sign-in is on · rules version ${v}` : `Phone sign-in is off · readiness no longer needs texting · rules version ${v}`,
  );
  if (r.ok) revalidatePath("/settings/texting");
  return r;
}

export async function saveWhatsAppAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("messagingManage", "save the WhatsApp Business account");
  if (!auth.ok) return auth;
  const reason = reasonOf(fd, "WhatsApp Business account");
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("save_whatsapp_account", {
    p_center: auth.session.center.id, p_waba_id: String(fd.get("waba_id") ?? ""), p_phone_number_id: String(fd.get("phone_number_id") ?? ""),
    p_display_name: String(fd.get("display_name") ?? ""), p_phone: String(fd.get("phone") ?? ""), p_reason: reason,
  });
  if (error) return failure("Could not save the WhatsApp account", error);
  return done(["/settings/whatsapp", "/setup"], "Saved · pending Meta approval of the number and display name");
}

export async function submitWhatsAppTemplateAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("messagingManage", "submit the WhatsApp template");
  if (!auth.ok) return auth;
  const name = String(fd.get("name") ?? "");
  const reason = reasonOf(fd, `WhatsApp template ${name}`);
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("submit_whatsapp_template", {
    p_center: auth.session.center.id, p_name: name, p_language: String(fd.get("language") ?? "en"),
    p_category: String(fd.get("category") ?? ""), p_body: String(fd.get("body") ?? ""), p_reason: reason,
  });
  if (error) return failure("Could not submit the template", error);
  return done(["/settings/whatsapp"], "Template recorded · pending Meta approval");
}

export async function sendRecipientCodeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const auth = await authorizeAction("centerSettings", "send the verification code");
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("send_recipient_verification", { p_recipient: id });
  if (error) return failure("Could not send the verification code", error);
  return done(["/settings/limits"], "Code sent · ask the tester for it and enter it here within 15 minutes");
}

export async function confirmRecipientCodeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const code = String(fd.get("code") ?? "").trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "Could not verify — the code is 6 digits." };
  const auth = await authorizeAction("centerSettings", "verify the test recipient");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("confirm_recipient_verification", { p_recipient: id, p_code: code });
  if (error) return failure("Could not verify the test recipient", error);
  if (data !== true) return { ok: false, error: "Could not verify — that code is not right. Check it, or send a new one." };
  return done(["/settings/limits"], "Verified · sandbox messages can reach this address now");
}
