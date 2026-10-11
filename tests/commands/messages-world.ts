// A small community for the Messages commands: inboxes with conversations (one by a child, one that names a child), approved and
// unapproved answers, messages to families in every state, contact choices, and WhatsApp group requests. Built on the People
// community (tests/commands/people-fixture.ts) so the households, adults and children are the same ones.

import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import type { CommandVia } from "@/lib/commands/types";
import type { CrmSession } from "@/lib/session";

import { fakeSession, testContext, type FakeDbOptions } from "./helpers";
import { ID as PEOPLE, MINORS, peopleDb } from "./people-fixture";

type Row = Record<string, unknown>;

export const NOW = new Date("2026-10-10T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

export const M = {
  ...PEOPLE,
  ibEvents: "1b000000-0000-4000-8000-000000000001",
  ibMembers: "1b000000-0000-4000-8000-000000000002",
  thVeg: "7a000000-0000-4000-8000-000000000001",
  thAddress: "7a000000-0000-4000-8000-000000000002",
  thWaiting: "7a000000-0000-4000-8000-000000000003",
  thZoya: "7a000000-0000-4000-8000-000000000004",
  thGuest: "7a000000-0000-4000-8000-000000000005",
  thClosed: "7a000000-0000-4000-8000-000000000006",
  thChild: "7a000000-0000-4000-8000-000000000007",
  thMissing: "7a000000-0000-4000-8000-0000000000ff",
  cpAll: "ca000000-0000-4000-8000-000000000001",
  cpPending: "ca000000-0000-4000-8000-000000000002",
  cpScheduled: "ca000000-0000-4000-8000-000000000003",
  cpSent: "ca000000-0000-4000-8000-000000000004",
  cpSmall: "ca000000-0000-4000-8000-000000000005",
  cpCancelled: "ca000000-0000-4000-8000-000000000006",
  cpMissing: "ca000000-0000-4000-8000-0000000000ff",
  msDelivered: "3e000000-0000-4000-8000-000000000001",
  msFailed: "3e000000-0000-4000-8000-000000000002",
  msSuppressed: "3e000000-0000-4000-8000-000000000003",
  msFuture: "3e000000-0000-4000-8000-000000000004",
  msCode: "3e000000-0000-4000-8000-000000000005",
  msJobFailed: "3e000000-0000-4000-8000-000000000006",
  msBounced: "3e000000-0000-4000-8000-000000000007",
  msMissing: "3e000000-0000-4000-8000-0000000000ff",
  wrAdult: "9b000000-0000-4000-8000-000000000001",
  wrChild: "9b000000-0000-4000-8000-000000000002",
  wgMain: "9c000000-0000-4000-8000-000000000001",
  ciMenu: "c1000000-0000-4000-8000-000000000001",
  ciDraft: "c1000000-0000-4000-8000-000000000002",
  ciReview: "c1000000-0000-4000-8000-000000000003",
  ciFaq: "c1000000-0000-4000-8000-000000000004",
  hhNobody: "a0000000-0000-4000-8000-0000000000ff",
  newRow: "5e000000-0000-4000-8000-000000000001",
} as const;

const center_id = "center-1";

export const COMMS_STAFF = ["comms.view", "comms.send", "comms.approve", "comms.inbox", "people.view"];
export const REACH = { people_visible: true, custom_fields_not_counted: false, households: 120, adults: 210, email: 150, sms: 90, whatsapp: 40, no_channel: 25 };

export function messagesTables(): Record<string, Row[]> {
  return {
    zones: [{ id: M.zone, center_id, name: "North" }],
    inboxes: [
      { id: M.ibEvents, center_id, name: "Events inbox", zone_id: null, response_target_hours: 48 },
      { id: M.ibMembers, center_id, name: "Membership inbox", zone_id: null, response_target_hours: 24 },
    ],
    threads: [
      { id: M.thVeg, center_id, inbox_id: M.ibEvents, status: "open", assignee_user: null, first_response_at: null, closed_at: null, created_at: ago(3 * D), subject: "Is the Diwali dinner vegetarian?", from_person_id: M.priya, from_guest_contact: null },
      { id: M.thAddress, center_id, inbox_id: M.ibMembers, status: "assigned", assignee_user: "user-1", first_response_at: ago(4 * H), closed_at: null, created_at: ago(5 * H), subject: "Update our address", from_person_id: M.nikhil, from_guest_contact: null },
      { id: M.thWaiting, center_id, inbox_id: M.ibEvents, status: "waiting", assignee_user: "user-2", first_response_at: ago(1 * D), closed_at: null, created_at: ago(2 * D), subject: "Thanks for the update", from_person_id: M.rahul, from_guest_contact: null },
      { id: M.thZoya, center_id, inbox_id: M.ibEvents, status: "open", assignee_user: null, first_response_at: null, closed_at: null, created_at: ago(10 * D), subject: "Gluten free meal for Zoya", from_person_id: M.priya, from_guest_contact: null },
      { id: M.thGuest, center_id, inbox_id: M.ibEvents, status: "open", assignee_user: null, first_response_at: null, closed_at: null, created_at: ago(1 * H), subject: "Parking?", from_person_id: null, from_guest_contact: "guest@example.org" },
      { id: M.thClosed, center_id, inbox_id: M.ibEvents, status: "closed", assignee_user: null, first_response_at: ago(8 * D), closed_at: ago(7 * D), created_at: ago(9 * D), subject: "Old question", from_person_id: M.priya, from_guest_contact: null },
      { id: M.thChild, center_id, inbox_id: M.ibMembers, status: "open", assignee_user: null, first_response_at: null, closed_at: null, created_at: ago(2 * D), subject: "Quiz question", from_person_id: M.aarav, from_guest_contact: null },
    ],
    thread_messages: [
      { id: "tm-1", center_id, thread_id: M.thVeg, from_role: false, body: "Is the Diwali dinner vegetarian? We are Jain and avoid onion and garlic.", created_at: ago(3 * D) },
      { id: "tm-2", center_id, thread_id: M.thZoya, from_role: false, body: "Hello, my daughter Zoya needs a gluten free meal at the Diwali dinner. Can you cater for that?", created_at: ago(10 * D) },
      { id: "tm-3", center_id, thread_id: M.thGuest, from_role: false, body: "Where do we park for the dinner?", created_at: ago(1 * H) },
      { id: "tm-4", center_id, thread_id: M.thChild, from_role: false, body: "When is the quiz?", created_at: ago(2 * D) },
      { id: "tm-5", center_id, thread_id: M.thAddress, from_role: false, body: "We moved. Please update our address.", created_at: ago(5 * H) },
      { id: "tm-6", center_id, thread_id: M.thAddress, from_role: true, body: "Thanks, we will do that.", created_at: ago(4 * H) },
    ],
    content_items: [
      { id: M.ciMenu, center_id, tradition: null, kind: "niva_source", status: "published", title: "Diwali dinner food", body_md: "The Diwali dinner is fully vegetarian and Jain friendly. No onion, no garlic and no root vegetables are used.\n\nDinner is served from 6 PM in the main hall.", metadata: { source_url: "https://example.org/diwali" } },
      { id: M.ciDraft, center_id, tradition: null, kind: "niva_source", status: "draft", title: "Parking at the Diwali dinner", body_md: "Reserved parking for elders is behind the hall. Valet is free.", metadata: {} },
      { id: M.ciReview, center_id, tradition: null, kind: "niva_source", status: "in_review", title: "Garba night parking", body_md: "Garba night parking is across the street.", metadata: {} },
      { id: M.ciFaq, center_id, tradition: null, kind: "faq", status: "published", title: "Parking at the temple", body_md: "Free parking for the dinner and every other event is behind the hall and across the street.", metadata: {} },
    ],
    guide_sections: [],
    comms_campaigns: [
      { id: M.cpAll, center_id, kind: "newsletter", name: "Diwali newsletter", title: "Diwali is here", status: "draft", audience: { all_members: true }, channels: ["email", "push"], translations: {}, scheduled_at: null, sent_at: null, recipients_count: null, requires_second_approver: true, approved_by: null, second_approver: null, created_at: ago(2 * D) },
      { id: M.cpPending, center_id, kind: "newsletter", name: "Year-end appeal", title: "Year-end giving", status: "pending_approval", audience: { all_members: true }, channels: ["email"], translations: { gu: { title: "t", body_md: "b" } }, scheduled_at: null, sent_at: null, recipients_count: null, requires_second_approver: true, approved_by: "user-2", second_approver: null, created_at: ago(3 * D) },
      { id: M.cpScheduled, center_id, kind: "newsletter", name: "Garba night", title: "Garba night is on", status: "scheduled", audience: { zone_ids: [M.zone] }, channels: ["email", "sms"], translations: {}, scheduled_at: new Date(NOW.getTime() + 2 * D).toISOString(), sent_at: null, recipients_count: null, requires_second_approver: false, approved_by: "user-2", second_approver: null, created_at: ago(4 * D) },
      { id: M.cpSent, center_id, kind: "newsletter", name: "September news", title: "News", status: "sent", audience: { all_members: true }, channels: ["email"], translations: {}, scheduled_at: ago(20 * D), sent_at: ago(20 * D), recipients_count: 300, requires_second_approver: true, approved_by: "user-2", second_approver: "user-3", created_at: ago(22 * D) },
      { id: M.cpSmall, center_id, kind: "newsletter", name: "North zone picnic", title: "Picnic", status: "draft", audience: { zone_ids: [M.zone] }, channels: ["email"], translations: {}, scheduled_at: null, sent_at: null, recipients_count: null, requires_second_approver: false, approved_by: null, second_approver: null, created_at: ago(1 * D) },
      { id: M.cpCancelled, center_id, kind: "newsletter", name: "Old idea", title: "Old", status: "cancelled", audience: { all_members: true }, channels: ["email"], translations: {}, scheduled_at: null, sent_at: null, recipients_count: null, requires_second_approver: true, approved_by: null, second_approver: null, created_at: ago(30 * D) },
    ],
    messages: [
      { id: M.msDelivered, center_id, person_id: M.priya, to_address: "priya@example.org", channel: "email", subject: "Diwali dinner reminder", status: "delivered", failure_reason: null, scheduled_at: ago(5 * D), sent_at: ago(5 * D), delivered_at: ago(5 * D), provider: "resend", purpose: "notification", job_id: null, campaign_id: null, created_at: ago(5 * D), template_key: "event_reminder" },
      { id: M.msFailed, center_id, person_id: M.priya, to_address: "+15125550101", channel: "sms", subject: null, status: "failed", failure_reason: "The number is a landline and cannot receive texts.", scheduled_at: ago(2 * D), sent_at: null, delivered_at: null, provider: "twilio", purpose: "notification", job_id: null, campaign_id: null, created_at: ago(2 * D), template_key: "event_reminder" },
      { id: M.msSuppressed, center_id, person_id: M.rahul, to_address: "rahul@example.org", channel: "email", subject: "Garba night", status: "suppressed", failure_reason: null, scheduled_at: ago(1 * D), sent_at: null, delivered_at: null, provider: null, purpose: "notification", job_id: null, campaign_id: null, created_at: ago(1 * D), template_key: null },
      { id: M.msFuture, center_id, person_id: M.priya, to_address: "+15125550101", channel: "whatsapp", subject: null, status: "queued", failure_reason: null, scheduled_at: new Date(NOW.getTime() + 1 * D).toISOString(), sent_at: null, delivered_at: null, provider: null, purpose: "notification", job_id: null, campaign_id: null, created_at: ago(1 * H), template_key: null },
      { id: M.msCode, center_id, person_id: M.priya, to_address: "+15125550101", channel: "sms", subject: null, status: "delivered", failure_reason: null, scheduled_at: ago(1 * H), sent_at: ago(1 * H), delivered_at: ago(1 * H), provider: "twilio", purpose: "auth_code", job_id: null, campaign_id: null, created_at: ago(1 * H), template_key: null },
      { id: M.msJobFailed, center_id, person_id: M.nikhil, to_address: "nikhil@example.org", channel: "email", subject: "Reminder", status: "queued", failure_reason: null, scheduled_at: ago(3 * H), sent_at: null, delivered_at: null, provider: null, purpose: "notification", job_id: 5, campaign_id: null, created_at: ago(3 * H), template_key: null },
      { id: M.msBounced, center_id, person_id: M.rahul, to_address: "rahul@example.org", channel: "email", subject: "Hello", status: "bounced", failure_reason: "The mailbox does not exist.", scheduled_at: ago(30 * D), sent_at: ago(30 * D), delivered_at: null, provider: "resend", purpose: "notification", job_id: null, campaign_id: M.cpSent, created_at: ago(30 * D), template_key: null },
    ],
    jobs: [{ id: 5, center_id, status: "failed", attempts: 5, max_attempts: 5, last_error: "The sender rejected the request (401).", run_after: null }],
    channel_optins: [
      { center_id, person_id: M.priya, channel: "email", address: "priya@example.org", opted_in: true, recorded_at: ago(40 * D) },
      { center_id, person_id: M.priya, channel: "sms", address: "+15125550101", opted_in: true, recorded_at: ago(60 * D) },
      { center_id, person_id: M.priya, channel: "sms", address: "+15125550101", opted_in: false, recorded_at: ago(35 * D) },
      { center_id, person_id: M.rahul, channel: "email", address: "rahul@example.org", opted_in: true, recorded_at: ago(50 * D) },
      // A child's opt-in must never be read.
      { center_id, person_id: M.zoya, channel: "email", address: "zoya@example.org", opted_in: true, recorded_at: ago(10 * D) },
    ],
    consents: [{ center_id, person_id: M.rahul, kind: "whatsapp", granted: false, recorded_at: ago(5 * D) }],
    message_suppressions: [{ id: "sup-1", center_id, channel: "email", address: "rahul@example.org", reason: "bounce", detail: null, created_at: ago(29 * D), lifted_at: null }],
    whatsapp_groups: [{ id: M.wgMain, center_id, name: "Community chat" }],
    whatsapp_join_requests: [
      { id: M.wrAdult, center_id, group_id: M.wgMain, person_id: M.nikhil, phone_e164: "+15125550142", status: "pending", handled_by: null, handled_at: null, created_at: ago(1 * D) },
      { id: M.wrChild, center_id, group_id: M.wgMain, person_id: M.aarav, phone_e164: "+15125550143", status: "pending", handled_by: null, handled_at: null, created_at: ago(2 * D) },
    ],
    pathshala_classes: [],
    events: [],
  };
}

/** The People community plus the Messages tables. `rpc` adds or overrides answers. */
export function messagesDb(over: FakeDbOptions = {}) {
  const { db, tables } = peopleDb({ ...over, rpc: { segment_recipient_count: 42, audience_reach: REACH, approve_as_second: null, ...over.rpc } });
  Object.assign(tables, messagesTables());
  return { db, tables };
}

export function messagesRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of CATALOG) registry.register(command);
  return registry;
}

export function messagesSession(db: CrmSession["db"], over: Partial<Record<keyof CrmSession, unknown>> & { permissions?: string[]; rules?: unknown } = {}): CrmSession {
  const { rules, permissions, ...rest } = over;
  return fakeSession({ db, permissions: permissions ?? COMMS_STAFF, ...(rules !== undefined ? { center: { ...fakeSession().center, rules } } : {}), ...rest });
}

/** A context for these commands. Niva is `via: "assistant"`; a screen or the palette sees everything the role may. */
export function messagesContext(opts: { via?: CommandVia; permissions?: string[]; db?: CrmSession["db"]; rules?: unknown; roles?: unknown } = {}) {
  const db = opts.db ?? messagesDb().db;
  const session = messagesSession(db, { permissions: opts.permissions, rules: opts.rules, ...(opts.roles ? { roles: opts.roles } : {}) });
  return testContext({ session, via: opts.via ?? "screen", registry: messagesRegistry(), minorNames: MINORS, now: () => NOW });
}

/** The community's switch for each confirm command, on. */
export function switchedOn(keys: string[]): Record<string, unknown> {
  return { assistant: { tools: Object.fromEntries(keys.map((k) => [k, true])) } };
}

export const CONFIRM_KEYS = [
  "messages.schedule_campaign",
  "messages.approve_campaign",
  "messages.set_campaign_status",
  "messages.reply_to_thread",
  "messages.set_thread",
  "messages.handle_whatsapp_request",
];
