// The Communications Server Actions that now run a command (send the newsletter, approve it, cancel it, take / reply to / close a
// conversation, decide a WhatsApp request) answer exactly as they did when they did the work themselves: the same ActionResult,
// the same sentences, the same activity key, the same permission asked with the same wording. The expectations below were first
// run against the actions BEFORE they became wrappers; they are `toStrictEqual`, so a screen reading the result sees no extra key.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({
  session: null as unknown,
  refusal: null as string | null,
  state: null as unknown,
  asked: [] as { key: string; doing: string }[],
  activity: [] as { key: string; entity?: unknown }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  withActivity: async (key: string, fn: () => Promise<unknown>, opts?: { entityFrom?: unknown }) => {
    stub.activity.push({ key, entity: opts?.entityFrom });
    return fn();
  },
}));
vi.mock("@/lib/session", () => ({
  authorizeAction: vi.fn(async (key: string, doing: string) => {
    stub.asked.push({ key, doing });
    return stub.refusal ? { ok: false, error: stub.refusal } : { ok: true, session: stub.session };
  }),
  authorizeActionWhere: vi.fn(),
  loadSession: vi.fn(async () => stub.state ?? { status: "ok", session: stub.session }),
  dbWithReason: vi.fn(),
}));

import { approveCampaignAction, handleJoinRequestAction, replyToThreadAction, setCampaignStatusAction, setThreadAction, submitNewsletterAction } from "@/app/(app)/comms/actions";

import { recordInserts } from "./commands/events-world";
import { COMMS_STAFF, M, messagesDb, messagesSession } from "./commands/messages-world";

const NOT_SENDING = " It stays queued: email, SMS, WhatsApp and push sending are not connected to this app yet.";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

function setup(opts: { permissions?: string[]; roles?: unknown; failInsert?: boolean; failUpdates?: Record<string, { message: string }>; failRpc?: Record<string, { message: string }> } = {}) {
  const { db, tables } = messagesDb({ failUpdates: opts.failUpdates, failRpc: opts.failRpc });
  const inserts = recordInserts(db as unknown as { from: (t: string) => unknown }, opts.failInsert ? { fail: { message: "boom" } } : {});
  stub.session = messagesSession(db, { permissions: opts.permissions ?? COMMS_STAFF, ...(opts.roles ? { roles: opts.roles } : {}) });
  stub.refusal = null;
  stub.state = null;
  stub.asked = [];
  stub.activity = [];
  return { db, tables, inserts };
}

const NEWSLETTER = { name: "Garba night", title: "Garba night is on", body_md: "Join us on Saturday.", channels: ["email", "push"], audience: JSON.stringify({ zone_ids: [M.zone] }) };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitNewsletterAction", () => {
  it("schedules in one step for an approver with a smaller audience", async () => {
    const { tables, inserts } = setup();
    const r = await submitNewsletterAction(null, form({ ...NEWSLETTER, scheduled_at: "2026-10-12T09:00", title_gu: "ગુજરાતી", body_gu: "સંદેશ" }));
    expect(r).toStrictEqual({ ok: true, message: `"Garba night" approved and scheduled.${NOT_SENDING}` });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: "comms_campaigns",
      rows: {
        name: "Garba night",
        title: "Garba night is on",
        body_md: "Join us on Saturday.",
        channels: ["email", "push"],
        kind: "newsletter",
        status: "draft",
        requires_second_approver: false,
        audience: { zone_ids: [M.zone] },
        translations: { gu: { title: "ગુજરાતી", body_md: "સંદેશ" } },
        created_by: "user-1",
      },
    });
    expect((inserts[0].rows as { scheduled_at: string }).scheduled_at).toBe("2026-10-12T14:00:00.000Z");
    expect(tables.comms_campaigns.some((c) => c.status === "scheduled")).toBe(true);
    expect(stub.activity).toStrictEqual([{ key: "comms.send", entity: undefined }]);
    expect(stub.asked[0]).toStrictEqual({ key: "commsSend", doing: "send the newsletter" });
  });

  it("sends a message to all members, or from a person who may not approve, for approval", async () => {
    setup();
    expect(await submitNewsletterAction(null, form({ ...NEWSLETTER, audience: JSON.stringify({ all_members: true }) }))).toStrictEqual({
      ok: true,
      message: '"Garba night" sent for approval · it appears in approvers\' tasks.',
    });
    setup({ permissions: ["comms.view", "comms.send"] });
    expect(await submitNewsletterAction(null, form(NEWSLETTER))).toStrictEqual({ ok: true, message: '"Garba night" sent for approval · it appears in approvers\' tasks.' });
  });

  it("asks for the same things in the same words", async () => {
    setup();
    const cases: [Record<string, string | string[]>, string][] = [
      [{ ...NEWSLETTER, name: "" }, "Could not send the newsletter — give the newsletter a name."],
      [{ ...NEWSLETTER, title: " " }, "Could not send the newsletter — add a subject."],
      [{ ...NEWSLETTER, body_md: "" }, "Could not send the newsletter — write the message."],
      [{ ...NEWSLETTER, channels: [] }, "Could not send the newsletter — choose at least one channel."],
      [{ ...NEWSLETTER, channels: ["pigeon"] }, "Could not send the newsletter — choose at least one channel."],
      [{ ...NEWSLETTER, scheduled_at: "soon" }, "Could not send the newsletter — the send time is not a valid date and time."],
      [{ ...NEWSLETTER, audience: "{}" }, "Could not send the newsletter — choose at least one audience segment."],
      [{ ...NEWSLETTER, audience: "{not json" }, "Could not send the newsletter — the audience could not be read — reload the page and choose it again."],
    ];
    for (const [fields, error] of cases) expect(await submitNewsletterAction(null, form(fields)), error).toStrictEqual({ ok: false, error });
  });

  it("refuses a person who may not send, with the sentence it always had", async () => {
    setup();
    stub.refusal = "Could not send the newsletter — you don't have permission (needs comms.send).";
    expect(await submitNewsletterAction(null, form(NEWSLETTER))).toStrictEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database failure, and says what was saved when the second step fails", async () => {
    setup({ failInsert: true });
    expect(await submitNewsletterAction(null, form(NEWSLETTER))).toStrictEqual({ ok: false, error: "Could not send the newsletter — boom." });
    setup({ failUpdates: { comms_campaigns: { message: "nope" } } });
    expect(await submitNewsletterAction(null, form(NEWSLETTER))).toStrictEqual({
      ok: false,
      error: '"Garba night" was saved and is awaiting approval, but could not be scheduled — nope.',
    });
  });
});

describe("approveCampaignAction", () => {
  const approve = (id: string) => approveCampaignAction(null, form({ id }));

  it("schedules a message that is not for everyone, and waits for a second approver on one that is", async () => {
    const { tables } = setup();
    expect(await approve(M.cpSmall)).toStrictEqual({ ok: true, message: `"North zone picnic" approved and scheduled.${NOT_SENDING}` });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpSmall)).toMatchObject({ status: "scheduled", approved_by: "user-1" });
    expect(await approve(M.cpAll)).toStrictEqual({ ok: true, message: '"Diwali newsletter" approved · waiting for a second approver (all-member send).' });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpAll)).toMatchObject({ status: "pending_approval", approved_by: "user-1", requires_second_approver: true });
  });

  it("gives a second, different person's approval through the database rule", async () => {
    const { tables, db } = setup();
    expect(await approve(M.cpPending)).toStrictEqual({ ok: true, message: `"Year-end appeal" approved by two people and scheduled.${NOT_SENDING}` });
    expect(db.rpcCalls.find((c) => c.fn === "approve_as_second")?.args).toStrictEqual({ p_table: "comms_campaigns", p_id: M.cpPending });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpPending)?.status).toBe("scheduled");
  });

  it("refuses the same person twice, a message that is not waiting, a missing one and a half-sent request", async () => {
    const { tables } = setup();
    (tables.comms_campaigns.find((c) => c.id === M.cpPending) as Record<string, unknown>).approved_by = "user-1";
    expect(await approve(M.cpPending)).toStrictEqual({ ok: false, error: 'Could not approve "Year-end appeal" — you gave the first approval; the two-person rule needs a different approver.' });
    expect(await approve(M.cpSent)).toStrictEqual({ ok: false, error: 'Could not approve "September news" — it is no longer awaiting approval.' });
    expect(await approve(M.cpMissing)).toStrictEqual({ ok: false, error: "Could not approve the newsletter — it no longer exists." });
    expect(await approve("nope")).toStrictEqual({ ok: false, error: "Could not approve the newsletter — the request was incomplete." });
  });

  it("explains a failed second approval, asks for the approve permission and keeps its activity key", async () => {
    setup({ failRpc: { approve_as_second: { message: "the second approver must be a different person" } } });
    expect(await approve(M.cpPending)).toStrictEqual({
      ok: false,
      error: 'Could not approve "Year-end appeal" — you made the first request, so the two-person rule needs a different person to approve it.',
    });
    expect(stub.asked[0]).toStrictEqual({ key: "commsApprove", doing: "approve the newsletter" });
    expect(stub.activity).toStrictEqual([{ key: "comms.approve_campaign", entity: { kind: "message", id: M.cpPending } }]);
    stub.refusal = "Could not approve the newsletter — you don't have permission (needs comms.approve).";
    expect(await approve(M.cpSmall)).toStrictEqual({ ok: false, error: stub.refusal });
  });
});

describe("setCampaignStatusAction", () => {
  const set = (id: string, decision: string) => setCampaignStatusAction(null, form({ id, decision }));

  it("cancels, or sends back to approval, a message that has not gone out", async () => {
    const { tables } = setup();
    expect(await set(M.cpScheduled, "cancelled")).toStrictEqual({ ok: true, message: "Cancelled." });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpScheduled)?.status).toBe("cancelled");
    expect(await set(M.cpPending, "draft")).toStrictEqual({ ok: true, message: "Back to awaiting approval." });
    expect(tables.comms_campaigns.find((c) => c.id === M.cpPending)).toMatchObject({ status: "draft", approved_by: null, second_approver: null });
  });

  it("refuses what has gone out, a half-sent request and a refused person", async () => {
    setup();
    expect(await set(M.cpSent, "cancelled")).toStrictEqual({ ok: false, error: "Could not cancel the newsletter — it has already gone out or was cancelled." });
    expect(await set(M.cpCancelled, "draft")).toStrictEqual({ ok: false, error: "Could not move the newsletter back to approval — it has already gone out or was cancelled." });
    expect(await set("nope", "cancelled")).toStrictEqual({ ok: false, error: "Could not cancel the newsletter — the request was incomplete." });
    expect(await set(M.cpScheduled, "sent")).toStrictEqual({ ok: false, error: "Could not move the newsletter back to approval — the request was incomplete." });
    stub.refusal = "Could not cancel the newsletter — you don't have permission (needs comms.send).";
    expect(await set(M.cpScheduled, "cancelled")).toStrictEqual({ ok: false, error: stub.refusal });
  });

  it("explains a database failure", async () => {
    setup({ failUpdates: { comms_campaigns: { message: "nope" } } });
    expect(await set(M.cpScheduled, "cancelled")).toStrictEqual({ ok: false, error: "Could not cancel the newsletter — nope." });
  });
});

describe("setThreadAction", () => {
  const act = (id: string, decision: string) => setThreadAction(null, form({ id, decision }));

  it("takes, hands back, closes and reopens a conversation", async () => {
    const { tables } = setup();
    expect(await act(M.thVeg, "assign_me")).toStrictEqual({ ok: true, message: "It's yours now." });
    expect(tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "assigned", assignee_user: "user-1" });
    expect(await act(M.thVeg, "unassign")).toStrictEqual({ ok: true, message: "Unassigned." });
    expect(await act(M.thVeg, "close")).toStrictEqual({ ok: true, message: "Closed." });
    expect(tables.threads.find((t) => t.id === M.thVeg)?.status).toBe("closed");
    expect(await act(M.thVeg, "reopen")).toStrictEqual({ ok: true, message: "Reopened." });
    expect(tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "open", closed_at: null });
  });

  it("says the same when it is not found, incomplete or the database fails", async () => {
    setup();
    expect(await act(M.thMissing, "close")).toStrictEqual({ ok: false, error: "Could not close the conversation — it no longer exists, or it is not in an inbox you handle." });
    expect(await act("nope", "close")).toStrictEqual({ ok: false, error: "Could not close the conversation — the request was incomplete." });
    expect(await act(M.thVeg, "burn")).toStrictEqual({ ok: false, error: "Could not update the conversation — the request was incomplete." });
    setup({ failUpdates: { threads: { message: "nope" } } });
    expect(await act(M.thVeg, "assign_me")).toStrictEqual({ ok: false, error: "Could not take the conversation — nope." });
  });

  it("is for the people who handle an inbox: comms.inbox, or a zone lead, or the owner", async () => {
    setup({ permissions: ["comms.send"] });
    expect(await act(M.thVeg, "assign_me")).toStrictEqual({ ok: false, error: "Could not take the conversation — you don't handle any inbox (needs comms.inbox or a zone lead role)." });
    setup({ permissions: [], roles: [{ key: "zone_lead", name: "Zone lead", scopeKind: "zone" }] });
    expect(await act(M.thVeg, "assign_me")).toStrictEqual({ ok: true, message: "It's yours now." });
    setup();
    stub.state = { status: "signed_out" };
    expect(await act(M.thVeg, "assign_me")).toStrictEqual({ ok: false, error: "Could not take the conversation — your session has expired or the app is not configured. Sign in again." });
  });
});

describe("replyToThreadAction", () => {
  const reply = (fields: Record<string, string>) => replyToThreadAction(null, form(fields));

  it("saves the reply in the conversation and waits for the member, or closes it", async () => {
    const { tables, inserts } = setup();
    expect(await reply({ id: M.thVeg, body: " Yes, it is. " })).toStrictEqual({ ok: true, message: "Reply sent from the inbox, not your personal number." });
    expect(inserts[0]).toMatchObject({ table: "thread_messages", rows: { center_id: "center-1", thread_id: M.thVeg, author_user: "user-1", from_role: true, body: "Yes, it is." } });
    expect(tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "waiting" });
    expect(await reply({ id: M.thVeg, body: "Done.", close: "on" })).toStrictEqual({ ok: true, message: "Replied and closed." });
    expect(tables.threads.find((t) => t.id === M.thVeg)).toMatchObject({ status: "closed" });
    expect(stub.activity.at(-1)).toStrictEqual({ key: "comms.reply_thread", entity: { kind: "thread", id: M.thVeg } });
  });

  it("asks for the same things in the same words", async () => {
    setup();
    expect(await reply({ id: "nope", body: "Hi" })).toStrictEqual({ ok: false, error: "Could not send the reply — the request was incomplete." });
    expect(await reply({ id: M.thVeg, body: "   " })).toStrictEqual({ ok: false, error: "Could not send the reply — write something first." });
    expect(await reply({ id: M.thMissing, body: "Hi" })).toStrictEqual({
      ok: false,
      error: "Could not send the reply — the conversation no longer exists, or it is not in an inbox you handle.",
    });
    setup({ permissions: ["comms.send"] });
    expect(await reply({ id: M.thVeg, body: "Hi" })).toStrictEqual({ ok: false, error: "Could not send the reply — you don't handle any inbox (needs comms.inbox or a zone lead role)." });
  });

  it("explains a failed save, and a failed status change after the reply was saved", async () => {
    setup({ failInsert: true });
    expect(await reply({ id: M.thVeg, body: "Hi" })).toStrictEqual({ ok: false, error: "Could not send the reply — boom." });
    setup({ failUpdates: { threads: { message: "nope" } } });
    expect(await reply({ id: M.thVeg, body: "Hi" })).toStrictEqual({ ok: false, error: "The reply was saved, but the conversation's status could not be updated — nope." });
  });
});

describe("handleJoinRequestAction", () => {
  const decide = (id: string, decision: string) => handleJoinRequestAction(null, form({ id, decision }));

  it("approves, marks added or declines a request", async () => {
    const { tables } = setup();
    expect(await decide(M.wrAdult, "approved")).toStrictEqual({ ok: true, message: "Approved — add them in WhatsApp, then mark added." });
    expect(tables.whatsapp_join_requests.find((r) => r.id === M.wrAdult)).toMatchObject({ status: "approved", handled_by: "user-1" });
    expect(await decide(M.wrAdult, "added")).toStrictEqual({ ok: true, message: "Marked as added to the group." });
    expect(await decide(M.wrAdult, "declined")).toStrictEqual({ ok: true, message: "Declined." });
  });

  it("refuses an unfinished request, a missing one and a person without the permission", async () => {
    setup();
    expect(await decide("nope", "approved")).toStrictEqual({ ok: false, error: "Could not approve the request — the request was incomplete." });
    expect(await decide(M.wrAdult, "maybe")).toStrictEqual({ ok: false, error: "Could not approve the request — the request was incomplete." });
    expect(await decide("9b000000-0000-4000-8000-0000000000ff", "added")).toStrictEqual({ ok: false, error: "Could not mark the member added — the request no longer exists." });
    stub.refusal = "Could not decline the request — you don't have permission (needs comms.send).";
    expect(await decide(M.wrAdult, "declined")).toStrictEqual({ ok: false, error: stub.refusal });
    setup({ failUpdates: { whatsapp_join_requests: { message: "nope" } } });
    expect(await decide(M.wrAdult, "declined")).toStrictEqual({ ok: false, error: "Could not decline the request — nope." });
  });
});
