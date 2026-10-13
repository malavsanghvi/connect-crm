"use server";

import { revalidatePath } from "next/cache";

import { communityMajority } from "@/lib/commands/child-filter";
import type { Json } from "@/lib/database.types";
import { formatDateTime } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { TRIGGER_INFO, isEmailTrigger, isScheduleAudience, placeholderNames, type EmailTrigger } from "@/lib/merge/catalogue";
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

// ── Scheduled emails (0771): written with comms.send, switched on with comms.approve, each with giving.view or giving.manage ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intOf(fd: FormData, name: string): number | undefined {
  const raw = String(fd.get(name) ?? "").trim();
  if (raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function scheduleParams(fd: FormData): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const days = intOf(fd, "days");
  if (days !== undefined) params.days = days;
  const since = String(fd.get("since") ?? "").trim();
  if (since) params.since = since;
  params.include_imported = String(fd.get("include_imported") ?? "") === "on";
  return params;
}

export async function saveScheduleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const audience = String(fd.get("audience") ?? "");
  if (!isScheduleAudience(audience)) return { ok: false, error: "Could not save the scheduled email — choose who it goes to." };
  const frequency = String(fd.get("frequency") ?? "");
  const auth = await authorizeAction("automaticEmails", "save the scheduled email");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("save_email_schedule", {
    p_center: auth.session.center.id,
    p_id: UUID.test(id) ? id : undefined,
    p_name: String(fd.get("name") ?? ""),
    p_audience: audience,
    p_params: scheduleParams(fd) as Json,
    p_frequency: frequency,
    p_day_of_week: intOf(fd, "day_of_week"),
    p_day_of_month: intOf(fd, "day_of_month"),
    p_month: intOf(fd, "month"),
    p_hour: intOf(fd, "hour") ?? 9,
    p_language: String(fd.get("language") ?? ""),
    p_subject: String(fd.get("subject") ?? ""),
    p_body: String(fd.get("body") ?? ""),
  });
  if (error) return failure("Could not save the scheduled email", error);
  revalidatePath(PATH);
  const d = (data ?? {}) as { unchanged?: boolean; was_active?: boolean };
  if (d.unchanged) return { ok: true, message: "No changes to save" };
  if (d.was_active) return { ok: true, message: "Saved · it was on, so it is a draft again until someone with comms.approve switches it on" };
  return { ok: true, message: UUID.test(id) ? "Saved" : "Saved as a draft · it sends nothing until someone with comms.approve switches it on" };
}

export async function approveScheduleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { ok: false, error: "Could not switch the scheduled email on — the request was incomplete." };
  const auth = await authorizeAction("automaticEmails", "switch the scheduled email on");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("approve_email_schedule", { p_center: auth.session.center.id, p_id: id });
  if (error) return failure("Could not switch the scheduled email on", error);
  revalidatePath(PATH);
  const next = (data as { next_run_at?: string } | null)?.next_run_at;
  return { ok: true, message: next ? `On · the first run is ${formatDateTime(next, auth.session.center.time_zone)}` : "On" };
}

export async function pauseScheduleAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  if (!UUID.test(id)) return { ok: false, error: "Could not pause the scheduled email — the request was incomplete." };
  const auth = await authorizeAction("automaticEmails", "pause the scheduled email");
  if (!auth.ok) return auth;
  const { error } = await auth.session.db.rpc("pause_email_schedule", { p_center: auth.session.center.id, p_id: id });
  if (error) return failure("Could not pause the scheduled email", error);
  revalidatePath(PATH);
  return { ok: true, message: "Paused · nothing more goes until it is switched on again" };
}

export type SchedulePreview = { households: number; adults: number; would_send: number; skipped: { no_email: number; switched_off: number; unsubscribed: number } };

/** The dry run for the editor: who it would go to now, before saving. */
export async function previewScheduleAction(_prev: ActionResult<SchedulePreview> | null, fd: FormData): Promise<ActionResult<SchedulePreview>> {
  const audience = String(fd.get("audience") ?? "");
  if (!isScheduleAudience(audience)) return { ok: false, error: "Could not check who it would go to — choose who it goes to." };
  const auth = await authorizeAction("automaticEmails", "check who it would go to");
  if (!auth.ok) return auth;
  const { data, error } = await auth.session.db.rpc("email_schedule_preview", {
    p_center: auth.session.center.id,
    p_audience: audience,
    p_params: scheduleParams(fd) as Json,
    p_frequency: String(fd.get("frequency") ?? "monthly"),
    p_majority: communityMajority(auth.session.center),
  });
  if (error) return failure("Could not check who it would go to", error);
  const d = (data ?? {}) as Partial<SchedulePreview>;
  const preview: SchedulePreview = {
    households: Number(d.households) || 0,
    adults: Number(d.adults) || 0,
    would_send: Number(d.would_send) || 0,
    skipped: { no_email: Number(d.skipped?.no_email) || 0, switched_off: Number(d.skipped?.switched_off) || 0, unsubscribed: Number(d.skipped?.unsubscribed) || 0 },
  };
  return { ok: true, data: preview };
}
