"use server";

import { revalidatePath } from "next/cache";

import { buildAudience, buildTranslations, composeAction, parseAudience, requiresSecondApprover } from "@/lib/comms";
import type { Database, Json, TablesUpdate } from "@/lib/database.types";
import { localDateTimeToIso } from "@/lib/dates";
import { failure, type ActionResult } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, loadSession, type CrmSession } from "@/lib/session";

type Channel = Database["app"]["Enums"]["channel"];
const CHANNELS: Channel[] = ["email", "push", "in_app", "sms", "whatsapp"];

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** Audience JSON typed by the chips (hidden field "audience"), validated again here. */
function audienceFrom(fd: FormData): { ok: true; audience: Record<string, unknown> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text(fd, "audience") || "{}");
  } catch {
    return { ok: false, error: "the audience could not be read — reload the page and choose it again" };
  }
  const built = buildAudience(parseAudience(raw));
  return built.ok ? built : { ok: false, error: built.error.replace(/\.$/, "").toLowerCase() };
}

function revalidateComms() {
  revalidatePath("/comms", "layout");
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// Newsletters
// ---------------------------------------------------------------------------

/** Live "Recipients" count for the chips (app.segment_recipient_count, 0025/0026). */
export async function previewRecipientsAction(audienceJson: string): Promise<ActionResult<{ count: number }>> {
  const auth = await authorizeAction("commsSend", "count the recipients");
  if (!auth.ok) return auth;
  let raw: unknown;
  try {
    raw = JSON.parse(audienceJson);
  } catch {
    return { ok: false, error: "Could not count the recipients — the audience could not be read." };
  }
  const built = buildAudience(parseAudience(raw));
  if (!built.ok) return { ok: true, data: { count: 0 } };
  const { data, error } = await auth.session.db.rpc("segment_recipient_count", { p_center: auth.session.center.id, p_audience: built.audience as Json });
  if (error) return failure("Could not count the recipients", error);
  return { ok: true, data: { count: data ?? 0 } };
}

function campaignValues(fd: FormData, tz: string) {
  const name = text(fd, "name");
  const title = text(fd, "title");
  const body = text(fd, "body_md");
  const channels = fd.getAll("channels").map(String).filter((c): c is Channel => (CHANNELS as string[]).includes(c));
  const sendAt = text(fd, "scheduled_at");
  const scheduledAt = sendAt ? localDateTimeToIso(sendAt, tz) : null;
  const translations = buildTranslations({
    gu: { title: text(fd, "title_gu"), body_md: text(fd, "body_gu") },
    hi: { title: text(fd, "title_hi"), body_md: text(fd, "body_hi") },
  });
  if (!name) return { ok: false as const, error: "give the newsletter a name" };
  if (!title) return { ok: false as const, error: "add a subject" };
  if (!body) return { ok: false as const, error: "write the message" };
  if (channels.length === 0) return { ok: false as const, error: "choose at least one channel" };
  if (sendAt && !scheduledAt) return { ok: false as const, error: "the send time is not a valid date and time" };
  return { ok: true as const, values: { name, title, body_md: body, channels, translations: translations as Json, scheduled_at: scheduledAt } };
}

const NOT_SENDING = " It stays queued: email, SMS, WhatsApp and push sending are not connected to this app yet.";

/**
 * One click from the compose form. Under the CURRENT rules (unchanged):
 * an approver (comms.approve) must approve every send — the drafter may be
 * that approver — and all-member sends need a second, different approver.
 * So a comms.approve holder with a smaller audience schedules in one step;
 * everyone else sends it for approval.
 */
export async function submitNewsletterAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("commsSend", "send the newsletter");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const aud = audienceFrom(fd);
  if (!aud.ok) return { ok: false, error: `Could not send the newsletter — ${aud.error}.` };
  const v = campaignValues(fd, center.time_zone);
  if (!v.ok) return { ok: false, error: `Could not send the newsletter — ${v.error}.` };
  const mode = composeAction(aud.audience, can(auth.session, "comms.approve"));
  const needsSecond = requiresSecondApprover(aud.audience);

  const created = await db
    .from("comms_campaigns")
    .insert({
      ...v.values,
      center_id: center.id,
      kind: "newsletter",
      audience: aud.audience as Json,
      requires_second_approver: needsSecond,
      status: "draft",
      created_by: userId,
    })
    .select("id")
    .single();
  if (created.error) return failure("Could not send the newsletter", created.error);
  revalidateComms();
  if (mode === "submit") {
    return { ok: true, message: `"${v.values.name}" sent for approval · it appears in approvers' tasks.` };
  }
  const { error } = await db
    .from("comms_campaigns")
    .update({ approved_by: userId, status: "scheduled", scheduled_at: v.values.scheduled_at ?? new Date().toISOString() })
    .eq("id", created.data.id);
  if (error) return failure(`"${v.values.name}" was saved and is awaiting approval, but could not be scheduled`, error);
  return { ok: true, message: `"${v.values.name}" approved and scheduled.${NOT_SENDING}` };
}

/** Edit from the detail page; any edit sends it back to "awaiting approval". */
export async function saveCampaignAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("commsSend", "save the newsletter");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: "Could not save the newsletter — the request was incomplete." };
  const aud = audienceFrom(fd);
  if (!aud.ok) return { ok: false, error: `Could not save the newsletter — ${aud.error}.` };
  const v = campaignValues(fd, center.time_zone);
  if (!v.ok) return { ok: false, error: `Could not save the newsletter — ${v.error}.` };
  const cur = await db.from("comms_campaigns").select("status").eq("id", id).maybeSingle();
  if (cur.error) return failure("Could not save the newsletter", cur.error);
  if (!cur.data) return { ok: false, error: "Could not save the newsletter — it no longer exists." };
  if (!["draft", "pending_approval", "scheduled"].includes(cur.data.status)) return { ok: false, error: "Could not save the newsletter — it has already gone out." };
  const { error } = await db
    .from("comms_campaigns")
    .update({
      ...v.values,
      audience: aud.audience as Json,
      requires_second_approver: requiresSecondApprover(aud.audience),
      status: "draft",
      approved_by: null,
      second_approver: null,
    })
    .eq("id", id);
  if (error) return failure("Could not save the newsletter", error);
  revalidateComms();
  return { ok: true, message: cur.data.status === "draft" ? "Saved." : "Saved — it is back to awaiting approval, and approvals start again." };
}

/**
 * Inline "Approve" (Recent table, Home task, detail page). First approval
 * schedules a normal send; an all-member send waits for a second, different
 * approver, whose approval (app.approve_as_second) then schedules it.
 */
export async function approveCampaignAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("commsApprove", "approve the newsletter");
  if (!auth.ok) return auth;
  const { db, userId } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: "Could not approve the newsletter — the request was incomplete." };
  const c = await db.from("comms_campaigns").select("name, title, status, audience, requires_second_approver, approved_by, scheduled_at").eq("id", id).maybeSingle();
  if (c.error) return failure("Could not approve the newsletter", c.error);
  if (!c.data) return { ok: false, error: "Could not approve the newsletter — it no longer exists." };
  const label = c.data.name || c.data.title;
  const needsSecond = c.data.requires_second_approver || requiresSecondApprover(c.data.audience);
  const sendAt = c.data.scheduled_at ?? new Date().toISOString();

  if (c.data.status === "draft") {
    const patch: TablesUpdate<"comms_campaigns"> = needsSecond
      ? { approved_by: userId, requires_second_approver: true, status: "pending_approval" }
      : { approved_by: userId, status: "scheduled", scheduled_at: sendAt };
    const { error } = await db.from("comms_campaigns").update(patch).eq("id", id).eq("status", "draft");
    if (error) return failure("Could not approve the newsletter", error);
    revalidateComms();
    return { ok: true, message: needsSecond ? `"${label}" approved · waiting for a second approver (all-member send).` : `"${label}" approved and scheduled.${NOT_SENDING}` };
  }
  if (c.data.status === "pending_approval") {
    if (c.data.approved_by === userId) {
      return { ok: false, error: `Could not approve "${label}" — you gave the first approval; the two-person rule needs a different approver.` };
    }
    const second = await db.rpc("approve_as_second", { p_table: "comms_campaigns", p_id: id });
    if (second.error) return failure(`Could not approve "${label}"`, second.error);
    const { error } = await db.from("comms_campaigns").update({ status: "scheduled", scheduled_at: sendAt }).eq("id", id);
    if (error) return failure(`Your approval of "${label}" was recorded, but it could not be scheduled`, error);
    revalidateComms();
    return { ok: true, message: `"${label}" approved by two people and scheduled.${NOT_SENDING}` };
  }
  return { ok: false, error: `Could not approve "${label}" — it is no longer awaiting approval.` };
}

export async function setCampaignStatusAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const to = text(fd, "decision");
  const doing = to === "cancelled" ? "cancel the newsletter" : "move the newsletter back to approval";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id) || (to !== "draft" && to !== "cancelled")) return { ok: false, error: `Could not ${doing} — the request was incomplete.` };
  const patch: TablesUpdate<"comms_campaigns"> = to === "draft" ? { status: "draft", approved_by: null, second_approver: null } : { status: "cancelled" };
  const { data, error } = await auth.session.db.from("comms_campaigns").update(patch).eq("id", id).in("status", ["draft", "pending_approval", "scheduled"]).select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — it has already gone out or was cancelled.` };
  revalidateComms();
  return { ok: true, message: to === "draft" ? "Back to awaiting approval." : "Cancelled." };
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
async function inboxSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — your session has expired or the app is not configured. Sign in again.` };
  const s = state.session;
  // comms.inbox holders see every inbox; zone leads their zone's (RLS checks the zone).
  if (!can(s, "comms.inbox") && !s.roles.some((r) => r.key === "zone_lead")) {
    return { ok: false, error: `Could not ${doing} — you don't handle any inbox (needs comms.inbox or a zone lead role).` };
  }
  return { ok: true, session: s };
}

export async function setThreadAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const action = text(fd, "decision");
  const doing = { assign_me: "take the conversation", unassign: "unassign the conversation", close: "close the conversation", reopen: "reopen the conversation" }[action] ?? "update the conversation";
  const auth = await inboxSession(doing);
  if (!auth.ok) return auth;
  const { db, userId } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id) || !["assign_me", "unassign", "close", "reopen"].includes(action)) return { ok: false, error: `Could not ${doing} — the request was incomplete.` };
  const patch: TablesUpdate<"threads"> =
    action === "assign_me"
      ? { assignee_user: userId, status: "assigned" }
      : action === "unassign"
        ? { assignee_user: null, status: "open" }
        : action === "close"
          ? { status: "closed", closed_at: new Date().toISOString() }
          : { status: "open", closed_at: null };
  const { data, error } = await db.from("threads").update(patch).eq("id", id).select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — it no longer exists, or it is not in an inbox you handle.` };
  revalidateComms();
  return { ok: true, message: { assign_me: "It's yours now.", unassign: "Unassigned.", close: "Closed.", reopen: "Reopened." }[action] };
}

export async function replyToThreadAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await inboxSession("send the reply");
  if (!auth.ok) return auth;
  const { db, userId, center } = auth.session;
  const id = text(fd, "id");
  const body = text(fd, "body");
  const close = fd.get("close") === "on";
  if (!isUuid(id)) return { ok: false, error: "Could not send the reply — the request was incomplete." };
  if (!body) return { ok: false, error: "Could not send the reply — write something first." };
  const t = await db.from("threads").select("first_response_at").eq("id", id).maybeSingle();
  if (t.error) return failure("Could not send the reply", t.error);
  if (!t.data) return { ok: false, error: "Could not send the reply — the conversation no longer exists, or it is not in an inbox you handle." };
  const ins = await db.from("thread_messages").insert({ center_id: center.id, thread_id: id, author_user: userId, from_role: true, body });
  if (ins.error) return failure("Could not send the reply", ins.error);
  const now = new Date().toISOString();
  const patch: TablesUpdate<"threads"> = { status: close ? "closed" : "waiting" };
  if (!t.data.first_response_at) patch.first_response_at = now;
  if (close) patch.closed_at = now;
  const { error } = await db.from("threads").update(patch).eq("id", id);
  if (error) return failure("The reply was saved, but the conversation's status could not be updated", error);
  revalidateComms();
  return { ok: true, message: close ? "Replied and closed." : "Reply sent from the inbox, not your personal number." };
}

// ---------------------------------------------------------------------------
// WhatsApp queue
// ---------------------------------------------------------------------------
export async function handleJoinRequestAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const status = text(fd, "decision");
  const doing = status === "added" ? "mark the member added" : status === "declined" ? "decline the request" : "approve the request";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id) || !["approved", "added", "declined"].includes(status)) return { ok: false, error: `Could not ${doing} — the request was incomplete.` };
  const { data, error } = await auth.session.db
    .from("whatsapp_join_requests")
    .update({ status, handled_by: auth.session.userId, handled_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — the request no longer exists.` };
  revalidateComms();
  return { ok: true, message: status === "added" ? "Marked as added to the group." : status === "approved" ? "Approved — add them in WhatsApp, then mark added." : "Declined." };
}

// ---------------------------------------------------------------------------
// Surveys (general, not tied to an event — event feedback lives under Events)
// ---------------------------------------------------------------------------
export async function saveSurveyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the survey" : "create the survey";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  let questions: unknown;
  try {
    questions = JSON.parse(text(fd, "questions") || "[]");
  } catch {
    return { ok: false, error: `Could not ${doing} — the questions could not be read. Reload the page and try again.` };
  }
  if (!Array.isArray(questions) || questions.length === 0) return { ok: false, error: `Could not ${doing} — add at least one question.` };
  for (const q of questions as { label?: string; type?: string; options?: string[] }[]) {
    if (!q.label?.trim()) return { ok: false, error: `Could not ${doing} — every question needs a label.` };
    if ((q.type === "single" || q.type === "multi") && !(q.options ?? []).length) return { ok: false, error: `Could not ${doing} — add choices for "${q.label}".` };
  }
  const aud = audienceFrom(fd);
  if (!aud.ok) return { ok: false, error: `Could not ${doing} — ${aud.error}.` };
  const title = text(fd, "title");
  if (!title) return { ok: false, error: `Could not ${doing} — give it a title.` };
  const opens = text(fd, "opens_at") ? localDateTimeToIso(text(fd, "opens_at"), center.time_zone) : null;
  const closes = text(fd, "closes_at") ? localDateTimeToIso(text(fd, "closes_at"), center.time_zone) : null;
  if ((text(fd, "opens_at") && !opens) || (text(fd, "closes_at") && !closes)) return { ok: false, error: `Could not ${doing} — a date is not valid.` };
  if (opens && closes && closes <= opens) return { ok: false, error: `Could not ${doing} — it must close after it opens.` };
  const values = {
    title,
    description: text(fd, "description") || null,
    questions: questions as Json,
    audience: aud.audience as Json,
    anonymous: fd.get("anonymous") === "on",
    opens_at: opens,
    closes_at: closes,
  };
  const { error } = isUuid(id)
    ? await db.from("surveys").update(values).eq("id", id)
    : await db.from("surveys").insert({ ...values, center_id: center.id, created_by: userId });
  if (error) return failure(`Could not ${doing}`, error);
  revalidateComms();
  return { ok: true, message: isUuid(id) ? "Survey saved." : `"${title}" created as a draft. Open it when it is ready.` };
}

export async function setSurveyStatusAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const status = text(fd, "decision");
  const auth = await authorizeAction("commsSend", "update the survey");
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id) || !["draft", "open", "closed"].includes(status)) return { ok: false, error: "Could not update the survey — the request was incomplete." };
  const { error } = await auth.session.db.from("surveys").update({ status }).eq("id", id);
  if (error) return failure("Could not update the survey", error);
  revalidateComms();
  return { ok: true, message: status === "open" ? "Survey is open." : status === "closed" ? "Survey closed." : "Back to draft." };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export async function createAlertAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("commsSend", "post the alert");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const severity = text(fd, "severity") || "important";
  const title = text(fd, "title");
  const body = text(fd, "body");
  if (!["info", "important", "urgent"].includes(severity)) return { ok: false, error: "Could not post the alert — choose a severity." };
  if (!title || !body) return { ok: false, error: "Could not post the alert — title and message are required." };
  const aud = audienceFrom(fd);
  if (!aud.ok) return { ok: false, error: `Could not post the alert — ${aud.error}.` };
  const starts = text(fd, "starts_at") ? localDateTimeToIso(text(fd, "starts_at"), center.time_zone) : new Date().toISOString();
  const ends = text(fd, "ends_at") ? localDateTimeToIso(text(fd, "ends_at"), center.time_zone) : null;
  if (!starts || (text(fd, "ends_at") && !ends)) return { ok: false, error: "Could not post the alert — a date is not valid." };
  if (ends && ends <= starts) return { ok: false, error: "Could not post the alert — it must end after it starts." };
  const { error } = await db.from("alerts").insert({ center_id: center.id, severity, title, body, audience: aud.audience as Json, starts_at: starts, ends_at: ends, created_by: userId });
  if (error) return failure("Could not post the alert", error);
  revalidateComms();
  return { ok: true, message: "Alert posted." };
}

export async function endAlertAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("commsSend", "end the alert");
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: "Could not end the alert — the request was incomplete." };
  const { error } = await auth.session.db.from("alerts").update({ ends_at: new Date().toISOString() }).eq("id", id);
  if (error) return failure("Could not end the alert", error);
  revalidateComms();
  return { ok: true, message: "Alert ended." };
}
