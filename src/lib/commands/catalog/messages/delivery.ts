import { campaignStatusLabel } from "@/lib/comms";
import { formatDateTime, todayInTz } from "@/lib/dates";

import { isAdultMember } from "../../child-filter";
import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type HouseholdCard } from "../../types";
import { must } from "../db";
import { cardsFor } from "../people/shared";

import { childGuard, guardText } from "./shared";
import { channelWord, countBy, explainMessage, latestBy, maskAddress, reachability, SECRET_PURPOSES, type JobState, type MessageState } from "./pure";

export type WhyNotDeliveredData = {
  about: "message" | "campaign" | "household";
  /** The answer, in one or two plain sentences. */
  answer: string;
  /** True only when the message really went out (sent or delivered). */
  went_out: boolean;
  household: HouseholdCard | null;
  messages: { message_id: string; created: string; channel: string; to: string | null; what: string | null; state: string; why: string }[];
  /** What was checked, so the person can see it was not guessed. */
  checks: string[];
  next_steps: string[];
  notes: string[];
};

const input = object({
  message_id: f.optional(f.uuid("One text, email or push notification (its id, from an earlier answer).")),
  campaign_id: f.optional(f.uuid("One newsletter or announcement (its campaign_id, from messages.campaigns).")),
  household_id: f.optional(f.uuid("A family that says they did not get a message (the household id on a household card).")),
  channel: f.optional(f.enum("With household_id: look at only this channel.", ["email", "sms", "whatsapp", "push", "in_app"] as const)),
});

const MESSAGE_COLUMNS =
  "id, person_id, to_address, channel, subject, status, failure_reason, scheduled_at, sent_at, delivered_at, provider, purpose, job_id, campaign_id, created_at, template_key";

type MessageRow = MessageState & {
  id: string;
  person_id: string | null;
  to_address: string | null;
  subject: string | null;
  purpose: string | null;
  job_id: number | null;
  campaign_id: string | null;
  created_at: string;
  template_key: string | null;
};

type Suppression = { channel: string; address: string; reason: string; created_at: string };

function whenIn(ctx: CommandContext) {
  const tz = ctx.session.center.time_zone;
  return (iso: string) => formatDateTime(iso, tz);
}

async function jobFor(ctx: CommandContext, jobId: number | null): Promise<JobState> {
  if (jobId === null || jobId === undefined) return null;
  const res = await ctx.session.db.from("jobs").select("status, attempts, max_attempts, last_error, run_after").eq("id", jobId).maybeSingle();
  if (res.error) {
    // A role that may not read the background jobs still gets the answer, without the retry detail.
    console.error("[messages] could not read the background job of a message:", res.error);
    return null;
  }
  return (res.data as JobState) ?? null;
}

// ---------------------------------------------------------------------------
// One message
// ---------------------------------------------------------------------------
async function aboutMessage(ctx: CommandContext, id: string): Promise<WhyNotDeliveredData> {
  const { db, center } = ctx.session;
  const when = whenIn(ctx);
  const now = ctx.now?.() ?? new Date();
  const m = must(await db.from("messages").select(MESSAGE_COLUMNS).eq("id", id).eq("center_id", center.id).maybeSingle(), "read the message") as MessageRow | null;
  if (!m) throw new CommandError("That message was not found, or you can't see it.");
  if (m.purpose && SECRET_PURPOSES.includes(m.purpose)) throw new CommandError("That is a sign-in code. Weaver does not show those here.");
  const job = await jobFor(ctx, m.job_id);
  const e = explainMessage(m, job, when, now);

  const checks: string[] = [`Status in the message queue: ${e.state}.`];
  const next: string[] = [];
  if (m.job_id !== null && job) checks.push(`Background service: ${job.status}${job.attempts ? `, tried ${job.attempts} time${job.attempts === 1 ? "" : "s"}` : ""}.`);
  // Is the address on the do-not-send list, and what did the person choose?
  if (m.to_address && (m.channel === "email" || m.channel === "sms" || m.channel === "whatsapp")) {
    const sup = must(
      await db.from("message_suppressions").select("channel, address, reason, created_at").eq("center_id", center.id).eq("channel", m.channel).eq("address", m.to_address).is("lifted_at", null).limit(1),
      "read the do-not-send list",
    ) as Suppression[] | null;
    if (sup && sup.length > 0) {
      const r = reachability({ channel: m.channel, optin: null, consentGranted: null, suppression: sup[0] }, when);
      checks.push(r.why);
      next.push("Lift the suppression in Settings (Email, Texting or WhatsApp) once the address is fixed.");
    } else checks.push(`The ${channelWord(m.channel)} address is not on the do-not-send list.`);
  }
  if (m.status === "queued" && (m.channel === "sms" || m.channel === "whatsapp" || m.channel === "push")) {
    checks.push("Quiet hours hold push, text and WhatsApp until they end; the community's hours are in Settings > Notifications.");
  }
  if (!e.went_out && (m.status === "failed" || m.status === "bounced")) next.push("Check the address with the family, then send it again from the place it came from.");
  if (m.status === "queued" && job?.status === "failed") next.push("Ask the platform team to look at the background service: this message will not go out until it is fixed.");

  return {
    about: "message",
    answer: e.why,
    went_out: e.went_out,
    household: null,
    messages: [{ message_id: m.id, created: when(m.created_at), channel: channelWord(m.channel), to: maskAddress(m.to_address), what: m.subject ?? (m.purpose ? m.purpose.replace(/_/g, " ") : null), state: e.state, why: e.why }],
    checks,
    next_steps: next,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// One newsletter or announcement
// ---------------------------------------------------------------------------
async function aboutCampaign(ctx: CommandContext, id: string): Promise<WhyNotDeliveredData> {
  const { db, center } = ctx.session;
  const when = whenIn(ctx);
  const c = must(
    await db.from("comms_campaigns").select("id, name, title, status, channels, scheduled_at, sent_at, recipients_count, requires_second_approver, approved_by, second_approver").eq("id", id).eq("center_id", center.id).maybeSingle(),
    "read the message",
  ) as { id: string; name: string | null; title: string; status: string; channels: string[] | null; scheduled_at: string | null; sent_at: string | null; recipients_count: number | null; requires_second_approver: boolean; approved_by: string | null; second_approver: string | null } | null;
  if (!c) throw new CommandError("That message was not found, or you can't see it.");
  const label = c.name || c.title;
  const rows = (must(await db.from("messages").select("status, failure_reason, channel").eq("campaign_id", id).eq("center_id", center.id).limit(5000), "read the messages of this campaign") ?? []) as {
    status: string;
    failure_reason: string | null;
    channel: string;
  }[];
  const counts = countBy(rows, (r) => r.status);
  const checks: string[] = [`Where it is: ${campaignStatusLabel(c.status)}.`];
  const next: string[] = [];
  let answer: string;
  let wentOut = false;

  switch (c.status) {
    case "draft":
      answer = `"${label}" has not been approved yet, so nothing has been queued.`;
      next.push("Someone with the approve permission approves it from the Newsletters page.");
      break;
    case "pending_approval":
      answer = `"${label}" has its first approval and is waiting for a second, different approver (a message to all members needs two people). Nothing has been queued.`;
      next.push("A second approver, not the first one, approves it from the Newsletters page.");
      break;
    case "scheduled":
      if (rows.length === 0) {
        answer = `"${label}" is Scheduled, but it has not gone out: email, SMS, WhatsApp and push sending for newsletters are not connected to this app yet, so it waits${c.scheduled_at ? ` (it is meant for ${when(c.scheduled_at)})` : ""}.`;
        next.push("Nothing to fix on this message. It will go out when sending is connected.");
      } else {
        answer = `"${label}" is Scheduled and has ${rows.length} message${rows.length === 1 ? "" : "s"} in the queue (${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}). It has not all gone out yet.`;
      }
      break;
    case "sending":
      answer = `"${label}" is going out now: ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ") || "no messages queued yet"}.`;
      break;
    case "sent": {
      wentOut = true;
      const bad = (counts.failed ?? 0) + (counts.bounced ?? 0) + (counts.suppressed ?? 0) + (counts.complained ?? 0);
      answer = `"${label}" has gone out${c.sent_at ? ` (${when(c.sent_at)})` : ""}: ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ") || "no per-message record"}.${bad > 0 ? ` ${bad} did not reach the person.` : ""}`;
      break;
    }
    case "cancelled":
      answer = `"${label}" was cancelled, so it did not go out.`;
      break;
    default:
      answer = `"${label}" is ${c.status}.`;
  }
  // The most common plain reasons it did not reach people.
  const reasons = countBy(rows.filter((r) => r.failure_reason), (r) => (r.failure_reason as string).slice(0, 160));
  const top = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [why, n] of top) checks.push(`${n} not sent: ${why}`);
  if ((c.channels ?? []).some((ch) => ch === "sms" || ch === "whatsapp" || ch === "push")) checks.push("Quiet hours hold push, text and WhatsApp until they end; email is not held.");

  return { about: "campaign", answer, went_out: wentOut, household: null, messages: [], checks, next_steps: next, notes: [] };
}

// ---------------------------------------------------------------------------
// One family
// ---------------------------------------------------------------------------
type PersonRow = { id: string; first_name: string; preferred_name: string | null; date_of_birth: string | null; is_deceased: boolean };
type OptinRow = { person_id: string; channel: string; address: string | null; opted_in: boolean; recorded_at: string };
type ConsentRow = { person_id: string; kind: string; granted: boolean; recorded_at: string };

async function aboutHousehold(ctx: CommandContext, householdId: string, channel: string | undefined): Promise<WhyNotDeliveredData> {
  const { db, center } = ctx.session;
  const when = whenIn(ctx);
  const now = ctx.now?.() ?? new Date();
  const today = todayInTz(center.time_zone, now);
  const links = (must(await db.from("household_members").select("person_id, role").eq("household_id", householdId).is("left_at", null), "read the household") ?? []) as { person_id: string; role: string }[];
  if (links.length === 0) throw new CommandError("That household was not found, or you can't see it.");
  const people = (must(await db.from("people").select("id, first_name, preferred_name, date_of_birth, is_deceased").in("id", links.map((l) => l.person_id)), "read the household's adults") ?? []) as PersonRow[];
  const roleOf = new Map(links.map((l) => [l.person_id, l.role]));
  // Adults only: a child's contact choices are never read here.
  const adults = people.filter((p) => !p.is_deceased && isAdultMember({ date_of_birth: p.date_of_birth, role: roleOf.get(p.id) }, today));
  const card = (await cardsFor(ctx, [householdId]))[0] ?? null;
  const channels = channel ? [channel] : ["email", "sms", "whatsapp"];
  const contactChannels = channels.filter((c) => c === "email" || c === "sms" || c === "whatsapp");

  const checks: string[] = [];
  const notes: string[] = [];
  const next: string[] = [];
  let anyReachable = false;
  let anyBlocked = false;

  if (adults.length === 0) {
    return { about: "household", answer: "This household has no adult on file, so there is nobody to message.", went_out: false, household: card, messages: [], checks, next_steps: ["Add an adult to the household first."], notes };
  }
  const adultIds = adults.map((a) => a.id);
  let optins: Map<string, OptinRow> = new Map();
  let consents: Map<string, ConsentRow> = new Map();
  let suppressed: Suppression[] = [];
  if (contactChannels.length > 0) {
    const o = (must(await db.from("channel_optins").select("person_id, channel, address, opted_in, recorded_at").in("person_id", adultIds).in("channel", contactChannels), "read their contact choices") ?? []) as OptinRow[];
    optins = latestBy(o, (r) => `${r.person_id}|${r.channel}`);
    const cs = (must(await db.from("consents").select("person_id, kind, granted, recorded_at").in("person_id", adultIds).in("kind", ["marketing_email", "sms", "whatsapp"]), "read their consents") ?? []) as ConsentRow[];
    consents = latestBy(cs, (r) => `${r.person_id}|${r.kind}`);
    const addresses = [...new Set([...optins.values()].map((r) => r.address).filter((a): a is string => !!a))];
    if (addresses.length > 0) {
      suppressed = (must(await db.from("message_suppressions").select("channel, address, reason, created_at").eq("center_id", center.id).in("address", addresses).is("lifted_at", null), "read the do-not-send list") ?? []) as Suppression[];
    }
  }
  for (const a of adults) {
    const who = (a.preferred_name ?? "").trim() || a.first_name;
    for (const ch of channels) {
      const optin = optins.get(`${a.id}|${ch}`) ?? null;
      const consent = consents.get(`${a.id}|${ch === "email" ? "marketing_email" : ch}`);
      const sup = optin?.address ? (suppressed.find((s) => s.channel === ch && s.address === optin.address) ?? null) : null;
      const r = reachability({ channel: ch, optin: optin ? { opted_in: optin.opted_in, address: optin.address, recorded_at: optin.recorded_at } : null, consentGranted: consent ? consent.granted : null, suppression: sup }, when);
      if (r.reachable === true) anyReachable = true;
      if (r.reachable === false) anyBlocked = true;
      checks.push(`${who} · ${channelWord(ch)}: ${r.why}`);
    }
  }

  // The latest messages to these adults (sign-in codes are never listed).
  const recent = (must(
    await db.from("messages").select(MESSAGE_COLUMNS).eq("center_id", center.id).in("person_id", adultIds).order("created_at", { ascending: false }).limit(30),
    "read their recent messages",
  ) ?? []) as MessageRow[];
  const shown = recent.filter((m) => !(m.purpose && SECRET_PURPOSES.includes(m.purpose)) && (!channel || m.channel === channel)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 8);
  const lines: WhyNotDeliveredData["messages"] = [];
  for (const m of shown) {
    const e = explainMessage(m, await jobFor(ctx, m.job_id), when, now);
    lines.push({ message_id: m.id, created: when(m.created_at), channel: channelWord(m.channel), to: maskAddress(m.to_address), what: m.subject ?? (m.purpose ? m.purpose.replace(/_/g, " ") : m.template_key), state: e.state, why: e.why });
  }
  if (shown.length === 0) notes.push(`No ${channel ? channelWord(channel) : "text, email or WhatsApp"} message to this household was found in the queue.`);

  let answer: string;
  if (anyReachable && !anyBlocked) answer = "Every adult in this household can be reached on the channels checked. If they say nothing arrived, look at the recent messages below.";
  else if (anyReachable) answer = "Some adults can be reached and some cannot: see the checks for who and why.";
  else if (contactChannels.length === 0) answer = "Push and in-app messages depend on the Weaver app and the topic being on; see the recent messages below.";
  else answer = "Nobody in this household can be reached on the channels checked: see the checks for the reason on each.";
  if (anyBlocked) next.push("Ask the family to opt in from the app, or record their choice at the office; lift a do-not-send entry in Settings if the address was fixed.");

  return { about: "household", answer, went_out: false, household: card, messages: lines, checks, next_steps: next, notes };
}

/**
 * Why a text, email or newsletter did not go out, in plain words, from the message queue, the do-not-send list, the contact choices and
 * the background service. Reads only; it never resends anything.
 */
export const whyNotDelivered = defineCommand<Infer<typeof input>, WhyNotDeliveredData>({
  key: "messages.why_not_delivered",
  title: "Find out why a message did not go out",
  description:
    "Explain, in plain words, why a text, email, WhatsApp or newsletter did not reach someone. Give ONE of: message_id (one message), campaign_id (a newsletter or announcement) or household_id (a family who say they got nothing; add channel to look at one). " +
    "It checks the message queue (sent, delivered, failed, bounced, cancelled and the reason recorded), the background service's retries, the do-not-send list, and each adult's opt-in, consent and address, and says what to do next. " +
    "A scheduled newsletter has not gone out: say 'Scheduled' until went_out is true. Only adults' choices are read; sign-in codes are never shown. It changes nothing and never resends.",
  level: "read",
  permission: "comms",
  module: "comms",
  input,
  async execute(ctx, args) {
    const given = [args.message_id, args.campaign_id, args.household_id].filter(Boolean);
    if (given.length !== 1) throw new CommandError("Say which message to look at: give exactly one of message_id, campaign_id or household_id.");
    const guard = await childGuard(ctx);
    // The subjects, reasons and names in the answer are free text: for Niva, a line that names a child is withheld.
    if (args.message_id) return { ok: true, data: guardText(await aboutMessage(ctx, args.message_id), guard) };
    if (args.campaign_id) return { ok: true, data: guardText(await aboutCampaign(ctx, args.campaign_id), guard) };
    return { ok: true, data: guardText(await aboutHousehold(ctx, args.household_id as string, args.channel), guard) };
  },
});
