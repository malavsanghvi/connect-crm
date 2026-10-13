"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { TRIGGER_INFO, isEmailTrigger, placeholderNames, type EmailTrigger } from "@/lib/merge/catalogue";
import { authorizeAction } from "@/lib/session";

// Settings › Automatic emails (0770). Every change goes through an app.* function that checks the email's own permission
// (giving.manage for receipts and pledge confirmations, events.manage for registrations), audits it, and refuses what it must:
// receipts need the treasurer's current approval of the receipt templates; wording may use only the email's own placeholders.
// No 2FA step (owner rule 2026-10-13).

const PATH = "/settings/automatic-emails";

function keyOf(fd: FormData): EmailTrigger | null {
  const key = String(fd.get("key") ?? "");
  return isEmailTrigger(key) ? key : null;
}

export async function setEmailAutomationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const key = keyOf(fd);
  const on = String(fd.get("enabled") ?? "") === "on";
  const uploadedRaw = String(fd.get("uploaded") ?? "");
  const uploaded = uploadedRaw === "on" ? true : uploadedRaw === "off" ? false : null;
  if (!key) return { ok: false, error: "Could not change the automatic email — the request was incomplete." };
  const title = TRIGGER_INFO[key].title.toLowerCase();
  const doing = uploaded === null ? `switch the ${title} ${on ? "on" : "off"}` : `change the ${title} for uploaded donations`;
  const auth = await authorizeAction("automaticEmails", doing);
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("set_email_automation", {
    p_center: auth.session.center.id,
    p_key: key,
    p_enabled: on,
    p_uploaded: uploaded ?? undefined,
  });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath(PATH);
  if (uploaded !== null) {
    return { ok: true, message: uploaded ? "Uploaded donations get a receipt email too" : "Uploaded donations get no receipt email" };
  }
  return {
    ok: true,
    message: on ? `The ${title} is on · it goes for each new record from now on, nothing already recorded is emailed` : `The ${title} is off · nothing more is sent`,
  };
}

export async function saveEmailWordingAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const key = keyOf(fd);
  if (!key) return { ok: false, error: "Could not save the wording — the request was incomplete." };
  const language = String(fd.get("language") ?? "").trim();
  const subject = String(fd.get("subject") ?? "");
  const body = String(fd.get("body") ?? "");
  const auth = await authorizeAction("automaticEmails", "save the wording");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("save_email_automation_wording", {
    p_center: auth.session.center.id,
    p_key: key,
    p_language: language,
    p_subject: subject,
    p_body: body,
  });
  if (error) return failure("Could not save the wording", error);
  revalidatePath(PATH);
  const d = (data ?? {}) as { version?: number; unchanged?: boolean; approval?: { ok?: boolean } | null };
  if (d.unchanged) return { ok: true, message: "No changes to save · the wording is already this" };
  const approval = d.approval && d.approval.ok === false ? " · the treasurer approves the new wording (Giving › Statements) before these emails go again" : "";
  return { ok: true, message: `Wording saved (version ${d.version ?? "?"})${approval}` };
}

export async function sendEmailTestAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const key = keyOf(fd);
  if (!key) return { ok: false, error: "Could not send the test — the request was incomplete." };
  let vars: Record<string, string> = {};
  try {
    const parsed = JSON.parse(String(fd.get("vars") ?? "{}")) as Record<string, unknown>;
    for (const name of placeholderNames(key)) vars[name] = typeof parsed[name] === "string" ? (parsed[name] as string) : "";
  } catch {
    vars = {};
  }
  const auth = await authorizeAction("automaticEmails", "send the test");
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("send_email_automation_test", {
    p_center: auth.session.center.id,
    p_key: key,
    p_language: String(fd.get("language") ?? "en"),
    p_vars: vars as Json,
  });
  if (error) return failure("Could not send the test", error);
  return { ok: true, message: `Test queued to ${auth.session.email ?? "your sign-in address"} · it uses the saved wording and arrives within a minute` };
}
