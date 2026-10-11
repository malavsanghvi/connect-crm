import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { MESSAGES_COMMANDS } from "@/lib/commands/catalog/messages";
import { inboxTriage } from "@/lib/commands/catalog/messages/inbox-triage";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandContext, CommandNeedsConfirmation, CommandRunResult, CommandVia } from "@/lib/commands/types";

import { recordInserts } from "./events-world";
import { COMMS_STAFF, CONFIRM_KEYS, M, messagesContext, messagesDb, REACH, switchedOn } from "./messages-world";

type Dict = Record<string, unknown>;
const KEYS = MESSAGES_COMMANDS.map((c) => c.key);

function setup(opts: { via?: CommandVia; permissions?: string[]; on?: boolean; rpc?: Dict; roles?: unknown } = {}) {
  const { db, tables } = messagesDb({ rpc: opts.rpc });
  const inserts = recordInserts(db as unknown as { from: (t: string) => unknown });
  const ctx = messagesContext({ via: opts.via ?? "screen", permissions: opts.permissions, db, rules: opts.on === false ? {} : switchedOn(CONFIRM_KEYS), roles: opts.roles });
  return { ctx, db, tables, inserts };
}

const run = (ctx: CommandContext, key: string, input: Dict) => runCommand(ctx, key, input);
const dataOf = <T = Dict>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
const ticketOf = (r: CommandRunResult): CommandNeedsConfirmation => {
  if (!r.ok || !r.needsConfirmation) throw new Error(`expected a confirmation, got ${JSON.stringify(r)}`);
  return r;
};
const failed = (r: CommandRunResult): string => {
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r)}`);
  return r.error;
};
/** Propose, then confirm; returns the confirm answer. */
async function confirmed(ctx: CommandContext, key: string, input: Dict) {
  const t = ticketOf(await run(ctx, key, input));
  return { t, result: await confirmProposal(ctx, t.proposalId, t.inputHash) };
}
const CHILD_WORDS = ["Zoya", "Aarav", "2018-05-05", "zoya@example.org"];
const leaks = (value: unknown) => {
  const text = JSON.stringify(value);
  return CHILD_WORDS.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
});

// ---------------------------------------------------------------------------
describe("the Messages commands", () => {
  it("are these, reads and drafts first, every change a confirm command switched off by default", () => {
    expect(MESSAGES_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual([
      "messages.inbox_triage:read",
      "messages.campaigns:read",
      "messages.audience_preview:read",
      "messages.why_not_delivered:read",
      "messages.draft_reply:draft",
      "messages.schedule_campaign:confirm",
      "messages.approve_campaign:confirm",
      "messages.set_campaign_status:confirm",
      "messages.reply_to_thread:confirm",
      "messages.set_thread:confirm",
      "messages.handle_whatsapp_request:confirm",
    ]);
    expect(CONFIRM_KEYS).toEqual(MESSAGES_COMMANDS.filter((c) => c.level === "confirm").map((c) => c.key));
    for (const c of MESSAGES_COMMANDS.filter((x) => x.level === "confirm")) expect(c.enabledByDefault, c.key).toBe(false);
    // They are in the shared catalog, next to messages.draft_reminder.
    for (const key of [...KEYS, "messages.draft_reminder"]) expect(CATALOG.map((c) => c.key)).toContain(key);
  });

  it("name the Server Actions they replace, and every one of them exists", () => {
    const covers = MESSAGES_COMMANDS.flatMap((c) => c.covers ?? []);
    expect(covers.sort()).toEqual(
      [
        "src/app/(app)/comms/actions.ts#approveCampaignAction",
        "src/app/(app)/comms/actions.ts#handleJoinRequestAction",
        "src/app/(app)/comms/actions.ts#replyToThreadAction",
        "src/app/(app)/comms/actions.ts#setCampaignStatusAction",
        "src/app/(app)/comms/actions.ts#setThreadAction",
        "src/app/(app)/comms/actions.ts#submitNewsletterAction",
      ].sort(),
    );
  });

  it("never offer Niva a change before the community switches it on", async () => {
    const { ctx } = setup({ via: "assistant", on: false });
    for (const key of CONFIRM_KEYS) expect(await run(ctx, key, {}), key).toMatchObject({ ok: false, code: "switched_off" });
  });

  it("need the permission the page needs", async () => {
    const onlyView = setup({ permissions: ["comms.view"] }).ctx;
    expect(await run(onlyView, "messages.inbox_triage", {})).toMatchObject({ ok: false, code: "no_access" });
    expect(await run(onlyView, "messages.draft_reply", { thread_id: M.thVeg })).toMatchObject({ ok: false, code: "no_access" });
    expect(await run(onlyView, "messages.audience_preview", { to_all_members: true })).toMatchObject({ ok: false, code: "no_access" });
    expect(await run(onlyView, "messages.approve_campaign", { campaign_id: M.cpSmall })).toMatchObject({ ok: false, code: "no_access" });
    expect(await run(onlyView, "messages.campaigns", {})).toMatchObject({ ok: true });
    const noApprove = setup({ permissions: ["comms.view", "comms.send"] }).ctx;
    expect(await run(noApprove, "messages.approve_campaign", { campaign_id: M.cpSmall })).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("messages.inbox_triage", () => {
  it("counts what is waiting by inbox and by age, and lists the oldest first without a name", async () => {
    const { ctx } = setup();
    const d = dataOf<Dict & { oldest: Dict[]; by_inbox: Dict[]; by_age: Dict[]; whatsapp: Dict }>(await run(ctx, "messages.inbox_triage", {}));
    // Open: veg (3 d, nobody), address (5 h, mine, replied), waiting, Zoya (10 d), guest (1 h), child (2 d). The closed one is left out.
    expect(d).toMatchObject({ open: 6, waiting_on_us: 5, waiting_on_member: 1, unassigned: 4, no_first_reply: 4, past_target: 3, truncated: false });
    expect(d.by_age.map((b) => b.count)).toEqual([2, 1, 1, 1]);
    expect(d.oldest.map((o) => o.ref)).toHaveLength(5);
    expect(d.oldest[0]).toMatchObject({ waited: "10 days", inbox: "Events inbox", held_by: "nobody", from: "a member", needs_first_reply: true });
    expect(d.oldest.find((o) => o.held_by === "you")).toMatchObject({ inbox: "Membership inbox", needs_first_reply: false });
    expect(d.by_inbox.map((i) => i.name)).toEqual(["Events inbox", "Membership inbox"]);
    expect(d.whatsapp).toMatchObject({ waiting: 2 });
    // No names of people: only references, inboxes, ages.
    expect(JSON.stringify(d)).not.toMatch(/Priya|Nikhil|Rahul|guest@example/);
  });

  it("looks at one inbox when asked, and says when the inbox does not exist", async () => {
    const { ctx } = setup();
    const d = dataOf<Dict>(await run(ctx, "messages.inbox_triage", { inbox_id: M.ibMembers }));
    expect(d).toMatchObject({ waiting_on_us: 2, waiting_on_member: 0 });
    expect(failed(await run(ctx, "messages.inbox_triage", { inbox_id: M.thMissing }))).toMatch(/inbox was not found/);
  });

  it("shows the screen the subjects, and withholds from Niva the ones that name a child or come from one", async () => {
    const screen = dataOf<{ oldest: { subject: string | null }[] }>(await run(setup().ctx, "messages.inbox_triage", {}));
    expect(screen.oldest.map((o) => o.subject)).toEqual(expect.arrayContaining(["Gluten free meal for Zoya", "Quiz question"]));
    const niva = await run(setup({ via: "assistant" }).ctx, "messages.inbox_triage", {});
    const d = dataOf<{ oldest: { subject: string | null }[] }>(niva);
    expect(d.oldest.map((o) => o.subject)).toEqual(expect.arrayContaining(["Is the Diwali dinner vegetarian?", "Parking?"]));
    expect(d.oldest.filter((o) => o.subject?.startsWith("This message is about a child"))).toHaveLength(2);
    expect(leaks(niva)).toEqual([]);
  });

  it("tells an inbox-only role that the WhatsApp queue is not theirs, instead of showing zero", async () => {
    const d = dataOf<{ whatsapp: unknown; notes: string[] }>(await run(setup({ permissions: ["comms.inbox"] }).ctx, "messages.inbox_triage", {}));
    expect(d.whatsapp).toBeNull();
    expect(d.notes.join(" ")).toMatch(/can't see the WhatsApp group requests/);
  });

  it("is open to a zone lead who does not hold comms.inbox, and closed to everyone else", async () => {
    const zoneLead = setup({ permissions: [], roles: [{ key: "zone_lead", name: "Zone lead", scopeKind: "zone" }] });
    expect(await inboxTriage.execute!(zoneLead.ctx, {})).toMatchObject({ ok: true });
    const nobody = setup({ permissions: ["comms.send"] });
    await expect(inboxTriage.execute!(nobody.ctx, {})).rejects.toThrow(/don't handle any inbox/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.draft_reply", () => {
  it("drafts from the approved answer only, and says which one it used", async () => {
    const { ctx, inserts } = setup();
    const d = dataOf<{ draft: string; sources: { id: string; title: string }[]; sent: boolean; household: { adults: string[] } | null; thread: Dict; conversation: Dict[] }>(
      await run(ctx, "messages.draft_reply", { thread_id: M.thVeg }),
    );
    expect(d.sent).toBe(false);
    expect(d.sources.map((s) => s.id)).toEqual([M.ciMenu]);
    expect(d.draft).toContain("Hello Priya,");
    expect(d.draft).toContain("fully vegetarian and Jain friendly");
    expect(d.draft).toContain("More: https://example.org/diwali");
    expect(d.thread).toMatchObject({ inbox: "Events inbox", from: "a member" });
    expect(d.household?.adults).toEqual(expect.arrayContaining(["Priya Shah"]));
    expect(d.conversation).toHaveLength(1);
    // Nothing was written anywhere: a draft is only text.
    expect(inserts).toEqual([]);
  });

  it("never uses an answer that is a draft or still in review", async () => {
    // "Parking" is answered only by a draft source and one waiting for approval, so there is no draft.
    const { ctx } = setup();
    const d = dataOf<{ draft: string | null; sources: unknown[]; notes: string[] }>(await run(ctx, "messages.draft_reply", { thread_id: M.thGuest }));
    expect(d.draft).toBeNull();
    expect(d.sources).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/No approved answer covers this question/);
  });

  it("uses the FAQ only when the community answers from it", async () => {
    const off = dataOf<{ draft: string | null }>(await run(setup().ctx, "messages.draft_reply", { thread_id: M.thGuest }));
    expect(off.draft).toBeNull();
    const world = setup();
    const ctx = { ...world.ctx, session: { ...world.ctx.session, center: { ...world.ctx.session.center, rules: { niva: { answer_from: ["faq"] } } } } } as CommandContext;
    const on = dataOf<{ draft: string; sources: { id: string }[] }>(await run(ctx, "messages.draft_reply", { thread_id: M.thGuest }));
    expect(on.sources.map((s) => s.id)).toEqual([M.ciFaq]);
    expect(on.draft).toContain("Free parking for the dinner and every other event");
    expect(on.draft).toContain("Hello there,");
  });

  it("does not read a guardian's message about a child to Niva, but shows the screen", async () => {
    const screen = dataOf<{ withheld: boolean; conversation: { text: string }[] }>(await run(setup().ctx, "messages.draft_reply", { thread_id: M.thZoya }));
    expect(screen.withheld).toBe(false);
    expect(screen.conversation[0].text).toMatch(/Zoya/);
    const niva = await run(setup({ via: "assistant" }).ctx, "messages.draft_reply", { thread_id: M.thZoya });
    const d = dataOf<{ withheld: boolean; draft: string | null; conversation: unknown[]; sources: unknown[]; thread: { subject: string | null } }>(niva);
    expect(d).toMatchObject({ withheld: true, draft: null, conversation: [], sources: [] });
    expect(d.thread.subject).toBeNull();
    expect(leaks(niva)).toEqual([]);
  });

  it("does not read a conversation written by a child to Niva", async () => {
    const d = dataOf<{ withheld: boolean }>(await run(setup({ via: "assistant" }).ctx, "messages.draft_reply", { thread_id: M.thChild }));
    expect(d.withheld).toBe(true);
  });

  it("says plainly when the conversation is not found, and when there is nothing to answer yet", async () => {
    const { ctx } = setup();
    expect(failed(await run(ctx, "messages.draft_reply", { thread_id: M.thMissing }))).toMatch(/not found, or it is not in an inbox you handle/);
    const d = dataOf<{ draft: string | null; notes: string[] }>(await run(ctx, "messages.draft_reply", { thread_id: M.thWaiting }));
    expect(d.draft).toBeNull();
    expect(d.notes.join(" ")).toMatch(/no message from the member yet/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.audience_preview", () => {
  it("counts adults by channel, the households that accept email, and what quiet hours do", async () => {
    const { ctx, db } = setup();
    const d = dataOf<Dict & { channels: Dict; quiet_hours: Dict }>(await run(ctx, "messages.audience_preview", { to_all_members: true, send_at: "2026-10-12T23:30" }));
    expect(d).toMatchObject({
      who: "All members",
      households_matched: 120,
      households_reachable_by_email: 42,
      adults: 210,
      adults_with_no_channel: 25,
      needs_second_approver: true,
      channels: { email: 150, sms: 90, whatsapp: 40, push: null },
    });
    // 11:30 PM is inside quiet hours (9 PM to 7 AM): push, text and WhatsApp wait, email does not.
    expect(d.quiet_hours).toMatchObject({ held: true, window: "9 PM – 7 AM" });
    expect(String(d.quiet_hours.note)).toMatch(/hold push, text and WhatsApp until/);
    expect(db.rpcCalls.map((c) => c.fn)).toEqual(expect.arrayContaining(["segment_recipient_count", "audience_reach"]));
    expect(db.rpcCalls.find((c) => c.fn === "audience_reach")?.args).toMatchObject({ p_center: "center-1", p_audience: { all_members: true } });
    expect(JSON.stringify(d)).not.toMatch(/@|\+1/);
  });

  it("does not hold a send in the afternoon, and reads zones, classes and RSVPs into words", async () => {
    const { ctx } = setup();
    const d = dataOf<{ who: string; quiet_hours: { held: boolean }; needs_second_approver: boolean }>(await run(ctx, "messages.audience_preview", { zone_ids: M.zone, send_at: "2026-10-12T14:00" }));
    expect(d.who).toBe("North zone");
    expect(d.needs_second_approver).toBe(false);
    expect(d.quiet_hours.held).toBe(false);
  });

  it("shows the recipients number and a reason when the role cannot see people", async () => {
    const { ctx } = setup({ rpc: { audience_reach: { people_visible: false, custom_fields_not_counted: false, households: null, adults: null, email: null, sms: null, whatsapp: null, no_channel: null } } });
    const d = dataOf<{ adults: unknown; channels: Dict; households_reachable_by_email: number; notes: string[] }>(await run(ctx, "messages.audience_preview", { to_life_members: true }));
    expect(d.households_reachable_by_email).toBe(42);
    expect(d.adults).toBeNull();
    expect(d.channels).toEqual({ email: null, sms: null, whatsapp: null, push: null });
    expect(d.notes.join(" ")).toMatch(/can't see people/);
  });

  it("says when the breakdown leaves a custom-field choice out", async () => {
    const { ctx } = setup({ rpc: { audience_reach: { ...REACH, custom_fields_not_counted: true } } });
    const audience_json = JSON.stringify({ custom_fields: [{ entity: "people", key: "volunteer", value: true }] });
    const d = dataOf<{ notes: string[] }>(await run(ctx, "messages.audience_preview", { audience_json }));
    expect(d.notes.join(" ")).toMatch(/leaves out the custom-field choices/);
  });

  it("asks for an audience and a real send time", async () => {
    const { ctx } = setup();
    expect(failed(await run(ctx, "messages.audience_preview", {}))).toMatch(/choose at least one audience segment/i);
    expect(failed(await run(ctx, "messages.audience_preview", { to_all_members: true, send_at: "tomorrow" }))).toMatch(/send time must be a date and time/i);
    expect(failed(await run(ctx, "messages.audience_preview", { zone_ids: "nope" }))).toMatch(/audience id is not valid/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.campaigns", () => {
  it("lists what waits for approval in the page's words, and says who can approve now", async () => {
    const { ctx } = setup();
    const d = dataOf<{ campaigns: Dict[] }>(await run(ctx, "messages.campaigns", {}));
    const byId = (id: string) => d.campaigns.find((c) => c.campaign_id === id);
    expect(d.campaigns.map((c) => c.campaign_id).sort()).toEqual([M.cpAll, M.cpPending, M.cpSmall].sort());
    expect(byId(M.cpAll)).toMatchObject({ status_label: "Awaiting approval", needs_two_approvers: true, you_can_approve_now: true, audience: "All members", went_out: false });
    expect(byId(M.cpPending)).toMatchObject({ status_label: "Awaiting second approver", you_can_approve_now: true, languages: ["English", "Gujarati"] });
    expect(byId(M.cpSmall)).toMatchObject({ audience: "North zone", needs_two_approvers: false });
  });

  it("says Scheduled, never Sent, until a message has gone out", async () => {
    const { ctx } = setup();
    const d = dataOf<{ campaigns: Dict[]; notes: string[] }>(await run(ctx, "messages.campaigns", { which: "all", limit: 30 }));
    const scheduled = d.campaigns.find((c) => c.campaign_id === M.cpScheduled);
    expect(scheduled).toMatchObject({ status_label: "Scheduled · queued until a sender is connected", went_out: false });
    expect(d.campaigns.find((c) => c.campaign_id === M.cpSent)).toMatchObject({ status_label: "Sent", went_out: true });
    expect(d.campaigns.filter((c) => c.went_out)).toHaveLength(1);
    expect(d.notes.join(" ")).toMatch(/none has gone out/);
  });

  it("does not offer the first approver a second approval, or a person without the permission any approval", async () => {
    const world = setup();
    (world.tables.comms_campaigns.find((c) => c.id === M.cpPending) as Dict).approved_by = "user-1";
    const mine = dataOf<{ campaigns: Dict[] }>(await run(world.ctx, "messages.campaigns", {}));
    expect(mine.campaigns.find((c) => c.campaign_id === M.cpPending)).toMatchObject({ you_can_approve_now: false, approvals: expect.stringMatching(/You gave the first approval/) });
    const viewer = dataOf<{ campaigns: Dict[] }>(await run(setup({ permissions: ["comms.view"] }).ctx, "messages.campaigns", {}));
    expect(viewer.campaigns.every((c) => c.you_can_approve_now === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("messages.why_not_delivered", () => {
  const why = (ctx: CommandContext, input: Dict) => run(ctx, "messages.why_not_delivered", input);

  it("needs exactly one thing to look at", async () => {
    const { ctx } = setup();
    expect(failed(await why(ctx, {}))).toMatch(/exactly one of message_id, campaign_id or household_id/);
    expect(failed(await why(ctx, { message_id: M.msFailed, campaign_id: M.cpAll }))).toMatch(/exactly one/);
  });

  it("reads the reason the queue recorded for a failed text", async () => {
    const d = dataOf<{ answer: string; went_out: boolean; messages: Dict[] }>(await why(setup().ctx, { message_id: M.msFailed }));
    expect(d.answer).toBe("The number is a landline and cannot receive texts.");
    expect(d).toMatchObject({ went_out: false });
    expect(d.messages[0]).toMatchObject({ channel: "text", to: "ending 0101", state: "Failed" });
  });

  it("explains a bounced email with the do-not-send list, and a message that is just waiting", async () => {
    const bounced = dataOf<{ answer: string; checks: string[]; next_steps: string[] }>(await why(setup().ctx, { message_id: M.msBounced }));
    expect(bounced.answer).toBe("The mailbox does not exist.");
    expect(bounced.checks.join(" ")).toMatch(/do-not-send list since .* \(a bounce\)/);
    expect(bounced.next_steps.join(" ")).toMatch(/Lift the suppression/);
    const waiting = dataOf<{ answer: string; checks: string[] }>(await why(setup().ctx, { message_id: M.msFuture }));
    expect(waiting.answer).toMatch(/queued and will go out on/);
    expect(waiting.checks.join(" ")).toMatch(/Quiet hours hold push, text and WhatsApp/);
  });

  it("reports a message the background service gave up on", async () => {
    const d = dataOf<{ answer: string; next_steps: string[] }>(await why(setup().ctx, { message_id: M.msJobFailed }));
    expect(d.answer).toMatch(/tried 5 times and gave up: The sender rejected the request \(401\)/);
    expect(d.next_steps.join(" ")).toMatch(/platform team/);
  });

  it("never shows a sign-in code, and says plainly when a message is not found", async () => {
    const { ctx } = setup();
    expect(failed(await why(ctx, { message_id: M.msCode }))).toMatch(/sign-in code/);
    expect(failed(await why(ctx, { message_id: M.msMissing }))).toMatch(/not found, or you can't see it/);
  });

  it("answers for a newsletter by where it is in approval, and says Scheduled until it has gone out", async () => {
    const { ctx } = setup();
    const scheduled = dataOf<{ answer: string; went_out: boolean }>(await why(ctx, { campaign_id: M.cpScheduled }));
    expect(scheduled.went_out).toBe(false);
    expect(scheduled.answer).toMatch(/is Scheduled, but it has not gone out: email, SMS, WhatsApp and push sending for newsletters are not connected/);
    expect(dataOf<{ answer: string }>(await why(ctx, { campaign_id: M.cpAll })).answer).toMatch(/has not been approved yet, so nothing has been queued/);
    expect(dataOf<{ answer: string }>(await why(ctx, { campaign_id: M.cpPending })).answer).toMatch(/waiting for a second, different approver/);
    expect(dataOf<{ answer: string; went_out: boolean }>(await why(ctx, { campaign_id: M.cpSent }))).toMatchObject({ went_out: true, answer: expect.stringMatching(/has gone out.*1 bounced.*did not reach the person/) });
    expect(dataOf<{ answer: string }>(await why(ctx, { campaign_id: M.cpCancelled })).answer).toMatch(/was cancelled/);
  });

  it("looks at a family's adults only, with the reason for each channel, and never at a child", async () => {
    const niva = await why(setup({ via: "assistant" }).ctx, { household_id: M.hhShah });
    const d = dataOf<{ answer: string; checks: string[]; messages: Dict[]; household: { adults: string[] } | null }>(niva);
    expect(d.checks.join("\n")).toMatch(/Priya · email: Opted in to email on/);
    expect(d.checks.join("\n")).toMatch(/Priya · text: They opted out of text on/);
    expect(d.checks.join("\n")).toMatch(/Priya · WhatsApp: No answer is recorded about WhatsApp/);
    expect(d.checks.join("\n")).toMatch(/Rahul · email: This email address is on the do-not-send list since .* \(a bounce\)/);
    expect(d.checks.join("\n")).toMatch(/Rahul · WhatsApp: .*opted in|Rahul · WhatsApp: No answer is recorded/);
    expect(d.answer).toMatch(/Some adults can be reached and some cannot/);
    // The sign-in code to Priya is not listed; her failed text is.
    expect(d.messages.map((m) => m.message_id)).toEqual(expect.arrayContaining([M.msFailed, M.msDelivered]));
    expect(d.messages.map((m) => m.message_id)).not.toContain(M.msCode);
    expect(leaks(niva)).toEqual([]);
  });

  it("can look at one channel of a family, and says when the household is not found", async () => {
    const { ctx } = setup();
    const d = dataOf<{ checks: string[]; messages: Dict[] }>(await why(ctx, { household_id: M.hhShah, channel: "sms" }));
    expect(d.checks).toHaveLength(2);
    expect(d.messages.every((m) => m.channel === "text")).toBe(true);
    expect(failed(await why(ctx, { household_id: M.hhNobody }))).toMatch(/household was not found/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.schedule_campaign", () => {
  const NEWSLETTER = { name: "Garba night", title: "Garba night is on", body: "Join us on Saturday.", channels: "email,push", zone_ids: M.zone };

  it("shows what will happen before anything is written: audience, reach, channels, time and 'Scheduled'", async () => {
    const { ctx, inserts } = setup({ via: "assistant" });
    const t = ticketOf(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, send_at: "2026-10-12T09:00" }));
    expect(t.preview.summary).toBe('Approve and schedule "Garba night" for North zone.');
    const lines = Object.fromEntries(t.preview.lines.map((l) => [l.label, l.value]));
    expect(lines).toMatchObject({ Audience: "North zone", Reach: "42 households with an adult who accepts email", Channels: "email, push notification", "After you confirm": "Scheduled (not yet sent)" });
    expect(String(lines["Goes out"])).toMatch(/Oct 12, 2026, 9:00 AM/);
    expect(t.preview.warnings?.join(" ")).toMatch(/Scheduled means queued, not sent/);
    expect(t.preview.warnings?.join(" ")).toMatch(/Niva only prepares this/);
    expect(t.confirmText).toBe("Yes, approve and schedule it");
    expect(inserts).toEqual([]);
  });

  it("creates the message, approves it and says Scheduled, not sent, once the person confirms", async () => {
    const { ctx, inserts, tables } = setup({ via: "assistant" });
    const { result } = await confirmed(ctx, "messages.schedule_campaign", NEWSLETTER);
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining('"Garba night" approved and scheduled. It stays queued: email, SMS, WhatsApp and push sending are not connected to this app yet.') });
    expect(dataOf(result)).toMatchObject({ status: "scheduled", sent: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ table: "comms_campaigns", rows: { name: "Garba night", kind: "newsletter", status: "draft", requires_second_approver: false, channels: ["email", "push"], audience: { zone_ids: [M.zone] }, created_by: "user-1", center_id: "center-1" } });
    expect(revalidatePath).toHaveBeenCalled();
    expect(tables.comms_campaigns.filter((c) => c.status === "scheduled").length).toBeGreaterThanOrEqual(1);
  });

  it("sends a message to all members for approval instead, and says two people must approve it", async () => {
    const { ctx } = setup({ via: "assistant" });
    const t = ticketOf(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, zone_ids: undefined, to_all_members: true }));
    expect(t.preview.summary).toMatch(/^Send "Garba night" for All members to the approvers\.$/);
    expect(t.preview.warnings?.join(" ")).toMatch(/two different people must approve/);
    expect(t.confirmText).toBe("Yes, send it for approval");
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(done).toMatchObject({ ok: true, message: '"Garba night" sent for approval · it appears in approvers\' tasks.' });
    expect(dataOf(done)).toMatchObject({ status: "awaiting_approval", sent: false });
  });

  it("sends it for approval when the person may not approve", async () => {
    const { ctx } = setup({ via: "assistant", permissions: ["comms.view", "comms.send", "people.view"] });
    const done = (await confirmed(ctx, "messages.schedule_campaign", NEWSLETTER)).result;
    expect(done).toMatchObject({ ok: true, message: expect.stringContaining("sent for approval") });
  });

  it("refuses what the compose form refuses, in the same words, before it asks for a confirmation", async () => {
    const { ctx } = setup({ via: "assistant" });
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, name: "" }))).toBe("Could not send the newsletter — give the newsletter a name.");
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, title: "" }))).toBe("Could not send the newsletter — add a subject.");
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, body: " " }))).toBe("Could not send the newsletter — write the message.");
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, channels: "carrier pigeon" }))).toBe("Could not send the newsletter — choose at least one channel.");
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, send_at: "soon" }))).toBe("Could not send the newsletter — the send time is not a valid date and time.");
    expect(failed(await run(ctx, "messages.schedule_campaign", { ...NEWSLETTER, zone_ids: undefined }))).toBe("Could not send the newsletter — choose at least one audience segment.");
  });

  it("warns when quiet hours would hold a text, and when nobody can be reached", async () => {
    const quiet = ticketOf(await run(setup({ via: "assistant" }).ctx, "messages.schedule_campaign", { ...NEWSLETTER, channels: "sms", send_at: "2026-10-12T23:00" }));
    expect(quiet.preview.warnings?.join(" ")).toMatch(/Quiet hours \(9 PM to 7 AM\) would hold push, text and WhatsApp/);
    const none = ticketOf(await run(setup({ via: "assistant", rpc: { segment_recipient_count: 0 } }).ctx, "messages.schedule_campaign", NEWSLETTER));
    expect(none.preview.warnings?.join(" ")).toMatch(/No household can be reached by email/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.approve_campaign", () => {
  it("approves and schedules a message that is not for everyone", async () => {
    const { ctx, tables } = setup({ via: "assistant" });
    const t = ticketOf(await run(ctx, "messages.approve_campaign", { campaign_id: M.cpSmall }));
    expect(t.preview.summary).toBe('Approve and schedule "North zone picnic" for North zone.');
    expect(t.preview.lines.find((l) => l.label === "Approval step")?.value).toBe("First approval");
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(done).toMatchObject({ ok: true, message: expect.stringMatching(/^"North zone picnic" approved and scheduled\. It stays queued/) });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpSmall)).toMatchObject({ status: "scheduled", approved_by: "user-1" });
  });

  it("gives the first approval of a message to all members and waits for a second, different person", async () => {
    const { ctx, tables } = setup({ via: "assistant" });
    const { t, result } = await confirmed(ctx, "messages.approve_campaign", { campaign_id: M.cpAll });
    expect(t.preview.summary).toMatch(/^Give your first approval to "Diwali newsletter" for All members\.$/);
    expect(t.preview.warnings?.join(" ")).toMatch(/second, different person must approve/);
    expect(result).toMatchObject({ ok: true, message: '"Diwali newsletter" approved · waiting for a second approver (all-member send).' });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpAll)).toMatchObject({ status: "pending_approval", approved_by: "user-1", requires_second_approver: true });
  });

  it("never lets Niva give the second approval, even when the person could", async () => {
    const { ctx, tables, db } = setup({ via: "assistant" });
    expect(failed(await run(ctx, "messages.approve_campaign", { campaign_id: M.cpPending }))).toMatch(/second approval is something only you can give, yourself/);
    expect(db.rpcCalls.map((c) => c.fn)).not.toContain("approve_as_second");
    expect(tables.comms_campaigns.find((c) => c.id === M.cpPending)).toMatchObject({ status: "pending_approval", second_approver: null });
  });

  it("gives the second approval from the screen: the person's own hands, through the database rule", async () => {
    const { ctx, tables, db } = setup({ via: "screen" });
    const result = await runCommand(ctx, "messages.approve_campaign", { campaign_id: M.cpPending }, { via: "screen" });
    // A screen runs a confirm command's proposal like any other; confirm it.
    const t = ticketOf(result);
    const done = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(done).toMatchObject({ ok: true, message: expect.stringMatching(/^"Year-end appeal" approved by two people and scheduled\./) });
    expect(db.rpcCalls.find((c) => c.fn === "approve_as_second")?.args).toEqual({ p_table: "comms_campaigns", p_id: M.cpPending });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpPending)?.status).toBe("scheduled");
  });

  it("refuses the same person a second approval, and a message that is not waiting", async () => {
    const world = setup({ via: "screen" });
    (world.tables.comms_campaigns.find((c) => c.id === M.cpPending) as Dict).approved_by = "user-1";
    expect(failed(await run(world.ctx, "messages.approve_campaign", { campaign_id: M.cpPending }))).toBe('Could not approve "Year-end appeal" — you gave the first approval; the two-person rule needs a different approver.');
    expect(failed(await run(world.ctx, "messages.approve_campaign", { campaign_id: M.cpSent }))).toBe('Could not approve "September news" — it is no longer awaiting approval.');
    expect(failed(await run(world.ctx, "messages.approve_campaign", { campaign_id: M.cpMissing }))).toBe("Could not approve the newsletter — it no longer exists.");
  });
});

// ---------------------------------------------------------------------------
describe("messages.set_campaign_status", () => {
  it("cancels a message that has not gone out, after the person confirms", async () => {
    const { ctx, tables } = setup({ via: "assistant" });
    const { t, result } = await confirmed(ctx, "messages.set_campaign_status", { campaign_id: M.cpScheduled, decision: "cancelled" });
    expect(t.preview.summary).toBe('Cancel "Garba night".');
    expect(t.preview.warnings?.join(" ")).toMatch(/cannot be brought back/);
    expect(result).toMatchObject({ ok: true, message: "Cancelled." });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpScheduled)?.status).toBe("cancelled");
  });

  it("sends a scheduled message back to awaiting approval and takes the approvals back", async () => {
    const { ctx, tables } = setup({ via: "assistant" });
    const { result } = await confirmed(ctx, "messages.set_campaign_status", { campaign_id: M.cpScheduled, decision: "draft" });
    expect(result).toMatchObject({ ok: true, message: "Back to awaiting approval." });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpScheduled)).toMatchObject({ status: "draft", approved_by: null, second_approver: null });
  });

  it("refuses a message that has already gone out or was cancelled, in the page's words", async () => {
    const { ctx } = setup({ via: "assistant" });
    expect(failed(await run(ctx, "messages.set_campaign_status", { campaign_id: M.cpSent, decision: "cancelled" }))).toBe("Could not cancel the newsletter — it has already gone out or was cancelled.");
    expect(failed(await run(ctx, "messages.set_campaign_status", { campaign_id: M.cpCancelled, decision: "draft" }))).toBe("Could not move the newsletter back to approval — it has already gone out or was cancelled.");
  });
});

// ---------------------------------------------------------------------------
describe("messages.reply_to_thread", () => {
  const REPLY = { thread_id: M.thVeg, body: "Yes, the dinner is fully vegetarian." };

  it("shows who the reply goes to (a household card) and the exact words, and sends nothing until the person confirms", async () => {
    const { ctx, inserts } = setup({ via: "assistant" });
    const t = ticketOf(await run(ctx, "messages.reply_to_thread", REPLY));
    expect(t.preview.summary).toBe('Reply to Q-00001 ("Is the Diwali dinner vegetarian?") from the Events inbox inbox.');
    expect(t.preview.households?.[0]).toMatchObject({ household_number: "H-1001", adults: expect.arrayContaining(["Priya Shah"]) });
    expect(t.preview.lines.find((l) => l.label === "Reply")?.value).toBe(REPLY.body);
    expect(t.preview.warnings?.join(" ")).toMatch(/not your personal number/);
    expect(inserts).toEqual([]);
  });

  it("saves the reply in the conversation and waits for the member, or closes it", async () => {
    const world = setup({ via: "assistant" });
    const { result } = await confirmed(world.ctx, "messages.reply_to_thread", REPLY);
    expect(result).toMatchObject({ ok: true, message: "Reply sent from the inbox, not your personal number." });
    expect(world.inserts[0]).toMatchObject({ table: "thread_messages", rows: { thread_id: M.thVeg, from_role: true, author_user: "user-1", body: REPLY.body, center_id: "center-1" } });
    expect(world.tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "waiting" });
    expect((world.tables.threads.find((t) => t.id === M.thVeg) as Dict).first_response_at).toBeTruthy();
    const closed = setup({ via: "assistant" });
    const done = (await confirmed(closed.ctx, "messages.reply_to_thread", { ...REPLY, close: true })).result;
    expect(done).toMatchObject({ ok: true, message: "Replied and closed." });
    expect(closed.tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "closed" });
  });

  it("refuses an empty reply, and a conversation that is gone", async () => {
    const { ctx } = setup({ via: "assistant" });
    expect(failed(await run(ctx, "messages.reply_to_thread", { thread_id: M.thVeg, body: "  " }))).toBe("Could not send the reply — write something first.");
    expect(failed(await run(ctx, "messages.reply_to_thread", { thread_id: M.thMissing, body: "Hello" }))).toMatch(/the conversation no longer exists, or it is not in an inbox you handle/);
  });

  it("will not let Niva answer a conversation by a child or about one, but the screen can", async () => {
    const niva = setup({ via: "assistant" }).ctx;
    expect(failed(await run(niva, "messages.reply_to_thread", { thread_id: M.thZoya, body: "Yes we can." }))).toMatch(/by a child or mentions one/);
    expect(failed(await run(niva, "messages.reply_to_thread", { thread_id: M.thChild, body: "Friday." }))).toMatch(/by a child or mentions one/);
    const screen = setup({ via: "screen" }).ctx;
    expect(ticketOf(await run(screen, "messages.reply_to_thread", { thread_id: M.thZoya, body: "Yes we can." })).preview.summary).toMatch(/Gluten free meal for Zoya/);
  });
});

// ---------------------------------------------------------------------------
describe("messages.set_thread", () => {
  it("takes, hands back, closes and reopens a conversation with the page's sentences", async () => {
    const expectations: [string, string, Dict][] = [
      ["assign_me", "It's yours now.", { status: "assigned", assignee_user: "user-1" }],
      ["close", "Closed.", { status: "closed" }],
      ["reopen", "Reopened.", { status: "open", closed_at: null }],
      ["unassign", "Unassigned.", { status: "open", assignee_user: null }],
    ];
    for (const [action, message, row] of expectations) {
      const { ctx, tables } = setup({ via: "assistant" });
      const { result } = await confirmed(ctx, "messages.set_thread", { thread_id: M.thVeg, action });
      expect(result, action).toMatchObject({ ok: true, message });
      expect(tables.threads.find((t) => t.id === M.thVeg), action).toMatchObject(row);
    }
  });

  it("does not touch a conversation by a child or about one when Niva asks", async () => {
    const { ctx } = setup({ via: "assistant" });
    expect(failed(await run(ctx, "messages.set_thread", { thread_id: M.thZoya, action: "close" }))).toMatch(/by a child or mentions one/);
    expect(failed(await run(ctx, "messages.set_thread", { thread_id: M.thMissing, action: "close" }))).toBe("Could not close the conversation — it no longer exists, or it is not in an inbox you handle.");
  });
});

// ---------------------------------------------------------------------------
describe("messages.handle_whatsapp_request", () => {
  it("shows the group, the household card and a masked number, then records the decision", async () => {
    const { ctx, tables } = setup({ via: "assistant" });
    const { t, result } = await confirmed(ctx, "messages.handle_whatsapp_request", { request_id: M.wrAdult, decision: "approved" });
    expect(t.preview.summary).toBe("Approve the request to join Community chat (W-00001).");
    expect(t.preview.lines.find((l) => l.label === "Phone")?.value).toBe("ending 0142");
    expect(t.preview.households?.[0]).toMatchObject({ household_number: "H-1002" });
    expect(result).toMatchObject({ ok: true, message: "Approved — add them in WhatsApp, then mark added." });
    expect(tables.whatsapp_join_requests.find((r) => r.id === M.wrAdult)).toMatchObject({ status: "approved", handled_by: "user-1" });
  });

  it("marks added and declines with the page's sentences", async () => {
    for (const [decision, message] of [
      ["added", "Marked as added to the group."],
      ["declined", "Declined."],
    ] as const) {
      const { ctx } = setup({ via: "assistant" });
      expect((await confirmed(ctx, "messages.handle_whatsapp_request", { request_id: M.wrAdult, decision })).result).toMatchObject({ ok: true, message });
    }
  });

  it("does not handle a child's request for Niva, but the screen can", async () => {
    expect(failed(await run(setup({ via: "assistant" }).ctx, "messages.handle_whatsapp_request", { request_id: M.wrChild, decision: "approved" }))).toMatch(/does not work with children's requests/);
    expect(ticketOf(await run(setup({ via: "screen" }).ctx, "messages.handle_whatsapp_request", { request_id: M.wrChild, decision: "approved" })).preview.summary).toMatch(/Community chat/);
  });
});

// ---------------------------------------------------------------------------
describe("D2 across the Messages commands", () => {
  /** A plausible input for every command here. A new command must be added, or this file fails. */
  const SAMPLE: Record<string, Dict> = {
    "messages.inbox_triage": {},
    "messages.campaigns": { which: "all", limit: 30 },
    "messages.audience_preview": { to_all_members: true },
    "messages.why_not_delivered": { household_id: M.hhShah },
    "messages.draft_reply": { thread_id: M.thZoya },
    "messages.schedule_campaign": { name: "Picnic for Zoya Shah", title: "Picnic", body: "Join us on Saturday.", channels: "email", zone_ids: M.zone },
    "messages.approve_campaign": { campaign_id: M.cpSmall },
    "messages.set_campaign_status": { campaign_id: M.cpScheduled, decision: "cancelled" },
    "messages.reply_to_thread": { thread_id: M.thVeg, body: "Yes, the dinner is vegetarian." },
    "messages.set_thread": { thread_id: M.thVeg, action: "close" },
    "messages.handle_whatsapp_request": { request_id: M.wrAdult, decision: "declined" },
  };

  it("has a sample for every command", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...KEYS].sort());
  });

  for (const command of MESSAGES_COMMANDS) {
    it(`${command.key}: nothing about a child in what Niva is given`, async () => {
      const { ctx } = setup({ via: "assistant" });
      const result = await run(ctx, command.key, SAMPLE[command.key]);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (command.level === "confirm") ticketOf(result);
      expect(leaks(result), JSON.stringify(result)).toEqual([]);
    });
  }

  it("holds for the other conversations and families that have a child in them", async () => {
    const { ctx } = setup({ via: "assistant" });
    for (const [key, input] of [
      ["messages.draft_reply", { thread_id: M.thChild }],
      ["messages.draft_reply", { thread_id: M.thVeg }],
      ["messages.why_not_delivered", { household_id: M.hhPatel }],
      ["messages.why_not_delivered", { household_id: M.hhShah, channel: "email" }],
      ["messages.why_not_delivered", { message_id: M.msSuppressed }],
    ] as [string, Dict][]) {
      const r = await run(ctx, key, input);
      expect(r.ok, key).toBe(true);
      expect(leaks(r), key).toEqual([]);
    }
  });

  it("redacts a full name of a child that a person typed into a card", async () => {
    const { ctx } = setup({ via: "assistant" });
    const t = ticketOf(await run(ctx, "messages.schedule_campaign", SAMPLE["messages.schedule_campaign"]));
    expect(t.preview.summary).toContain("[a child: not shown]");
    expect(JSON.stringify(t)).not.toContain("Zoya Shah");
  });
});

it("keeps the copy free of the word 'bid' and plain", () => {
  for (const c of MESSAGES_COMMANDS) {
    expect(c.title.length).toBeGreaterThan(8);
    expect(c.description.length).toBeGreaterThan(80);
    expect(`${c.title} ${c.description}`).not.toMatch(/\bbid\b/i);
  }
  expect(COMMS_STAFF).toContain("comms.inbox");
});
