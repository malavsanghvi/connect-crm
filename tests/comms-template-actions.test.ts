// Copy a communication as a new draft, and saved templates: the Server Actions answer in plain English, check the permission that writes
// a communication, leave out channels the community has not set up, call the database functions of migration 0800 with the right
// arguments and say what the database said when it refuses. And a working draft is saved, or sent for approval, with its own rules.
import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ session: null as unknown, asked: [] as { key: string; doing: string }[] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: async (_key: string, fn: () => Promise<unknown>) => fn() }));
// The real permission rule (canAccess), with the real wording of a refusal, over the fake session.
vi.mock("@/lib/session", async () => {
  const { ACCESS, canAccess } = await import("@/lib/permissions");
  return {
    authorizeAction: vi.fn(async (key: keyof typeof ACCESS, doing: string) => {
      stub.asked.push({ key, doing });
      const session = stub.session as Parameters<typeof canAccess>[0];
      if (!canAccess(session, key)) return { ok: false, error: `Could not ${doing} — you don't have permission (needs ${ACCESS[key].join(" or ")}).` };
      return { ok: true, session };
    }),
    authorizeActionWhere: vi.fn(),
    loadSession: vi.fn(),
    dbWithReason: vi.fn(),
  };
});

import { saveCampaignAction } from "@/app/(app)/comms/actions";
import { copyCampaignAction, deleteTemplateAction, renameTemplateAction, saveTemplateAction, startFromTemplateAction } from "@/app/(app)/comms/template-actions";

import { COMMS_STAFF, M, messagesDb, messagesSession } from "./commands/messages-world";

const C = "center-1";
const ID = {
  sms: "d1000000-0000-4000-8000-000000000001",
  wa: "d1000000-0000-4000-8000-000000000002",
  alert: "d1000000-0000-4000-8000-000000000003",
  noName: "d1000000-0000-4000-8000-000000000004",
  draftA: "d1000000-0000-4000-8000-000000000005",
  tplEmail: "d2000000-0000-4000-8000-000000000001",
  tplSms: "d2000000-0000-4000-8000-000000000002",
  tplWa: "d2000000-0000-4000-8000-000000000003",
  missing: "d3000000-0000-4000-8000-0000000000ff",
  newDraft: "d4000000-0000-4000-8000-000000000001",
};

const base = { translations: {}, scheduled_at: null, sent_at: null, recipients_count: null, requires_second_approver: false, approved_by: null, second_approver: null, created_at: "2026-10-01T00:00:00Z" };

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

type Opts = {
  permissions?: string[];
  modulesOff?: string[];
  texting?: boolean;
  whatsapp?: boolean;
  rpc?: Record<string, unknown>;
  failRpc?: Record<string, { code?: string; message: string }>;
  failTables?: Record<string, { code?: string; message: string }>;
};

function setup(opts: Opts = {}) {
  const { db, tables } = messagesDb({ rpc: opts.rpc, failRpc: opts.failRpc, failTables: opts.failTables });
  tables.comms_campaigns.push(
    { id: ID.sms, center_id: C, kind: "newsletter", name: "Garba text", title: "Garba tonight", status: "sent", audience: { zone_ids: [M.zone] }, channels: ["sms"], ...base },
    { id: ID.wa, center_id: C, kind: "announcement", name: "Lunch reminder", title: "Lunch at noon", status: "draft", audience: { zone_ids: [M.zone] }, channels: ["whatsapp"], ...base },
    { id: ID.alert, center_id: C, kind: "alert", name: "Road closed", title: "Road closed", status: "draft", audience: { all_members: true }, channels: ["push"], ...base },
    { id: ID.noName, center_id: C, kind: "newsletter", name: null, title: "Picnic on Saturday", status: "draft", audience: { zone_ids: [M.zone] }, channels: ["email"], ...base },
    { id: ID.draftA, center_id: C, kind: "newsletter", name: "Copy of September news", title: "News", status: "working_draft", audience: {}, channels: ["email", "push"], ...base },
  );
  tables.comms_templates = [
    { id: ID.tplEmail, center_id: C, name: "Monthly news", channels: ["email"], title: "News", body_md: "Hi {{recipient_first_name}}" },
    { id: ID.tplSms, center_id: C, name: "Garba reminder", channels: ["sms"], title: "", body_md: "Garba tonight" },
    { id: ID.tplWa, center_id: C, name: "Lunch reminder", channels: ["whatsapp"], title: "", body_md: "Lunch at noon" },
  ];
  tables.texting_registrations = [{ id: "tr", center_id: C, status: opts.texting ? "approved" : "submitted" }];
  tables.whatsapp_accounts = opts.whatsapp ? [{ id: "wa", center_id: C, status: "approved" }] : [{ id: "wa", center_id: C, status: "pending_meta" }];
  stub.session = messagesSession(db, { permissions: opts.permissions ?? COMMS_STAFF, modulesOff: opts.modulesOff ?? [] });
  stub.asked = [];
  const fake = db as unknown as { rpcCalls: { fn: string; args: Record<string, unknown> }[]; calls: { table: string; op: string; patch?: Record<string, unknown>; ids: unknown[] }[] };
  return { rpcCalls: fake.rpcCalls, calls: fake.calls, tables };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("copyCampaignAction (Copy as new draft)", () => {
  it("copies into a new draft named 'Copy of <name>' and says nothing was sent", async () => {
    const { rpcCalls } = setup({ rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    const r = await copyCampaignAction(null, form({ id: M.cpSent }));
    expect(r).toStrictEqual({
      ok: true,
      message: '"Copy of September news" is ready as a draft. Nothing has been sent.',
      data: { id: ID.newDraft, name: "Copy of September news" },
    });
    expect(rpcCalls).toEqual([{ fn: "copy_campaign_as_draft", args: { p_center: C, p_campaign: M.cpSent, p_name: "Copy of September news" } }]);
    expect(stub.asked).toEqual([{ key: "commsSend", doing: "copy the communication" }]);
  });
  it("names the copy of an unnamed communication after its subject", async () => {
    const { rpcCalls } = setup({ rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    const r = await copyCampaignAction(null, form({ id: ID.noName }));
    expect(r).toMatchObject({ ok: true, data: { name: "Copy of Picnic on Saturday" } });
    expect(rpcCalls[0]!.args.p_name).toBe("Copy of Picnic on Saturday");
  });
  it("copies a scheduled and a draft communication too", async () => {
    setup({ rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect((await copyCampaignAction(null, form({ id: M.cpScheduled }))).ok).toBe(true);
    expect((await copyCampaignAction(null, form({ id: M.cpSmall }))).ok).toBe(true);
  });
  it("refuses someone who cannot write communications, and asks the database nothing", async () => {
    const { rpcCalls } = setup({ permissions: ["comms.view", "people.view"] });
    const r = await copyCampaignAction(null, form({ id: M.cpSent }));
    expect(r).toStrictEqual({ ok: false, error: "Could not copy the communication — you don't have permission (needs comms.send)." });
    expect(rpcCalls).toEqual([]);
  });
  it("refuses an incomplete request, a communication that is not there and an alert", async () => {
    const { rpcCalls } = setup();
    expect(await copyCampaignAction(null, form({ id: "not-a-uuid" }))).toStrictEqual({ ok: false, error: "Could not copy the communication — the request was incomplete." });
    expect(await copyCampaignAction(null, form({}))).toMatchObject({ ok: false });
    expect(await copyCampaignAction(null, form({ id: ID.missing }))).toStrictEqual({ ok: false, error: "Could not copy the communication — it was not found, or you can't see it." });
    expect(await copyCampaignAction(null, form({ id: ID.alert }))).toStrictEqual({ ok: false, error: "Could not copy the communication — alerts and surveys are not copied here." });
    expect(rpcCalls).toEqual([]);
  });
  it("does not copy a text communication in a community that has not set up texting, and says why", async () => {
    const { rpcCalls } = setup();
    const r = await copyCampaignAction(null, form({ id: ID.sms }));
    expect(r).toStrictEqual({ ok: false, error: "Could not copy the communication — Text (SMS) is not set up or switched on for this community." });
    expect(rpcCalls).toEqual([]);
  });
  it("copies a text communication once the carriers approved the registration", async () => {
    setup({ texting: true, rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect(await copyCampaignAction(null, form({ id: ID.sms }))).toMatchObject({ ok: true, data: { name: "Copy of Garba text" } });
  });
  it("does not copy a WhatsApp communication unless the product is on and the account approved", async () => {
    setup({ whatsapp: true, modulesOff: ["channels"] });
    expect(await copyCampaignAction(null, form({ id: ID.wa }))).toStrictEqual({ ok: false, error: "Could not copy the communication — WhatsApp is not set up or switched on for this community." });
    setup({ whatsapp: false });
    expect(await copyCampaignAction(null, form({ id: ID.wa }))).toMatchObject({ ok: false });
    setup({ whatsapp: true, rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect(await copyCampaignAction(null, form({ id: ID.wa }))).toMatchObject({ ok: true, data: { name: "Copy of Lunch reminder" } });
  });
  it("copies an email communication even when texts and WhatsApp are not set up", async () => {
    setup({ rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect((await copyCampaignAction(null, form({ id: M.cpScheduled }))).ok).toBe(true);
  });
  it("leaves text and WhatsApp out, and logs it, when it cannot read which channels are set up; email still copies", async () => {
    const { rpcCalls } = setup({ texting: true, failTables: { texting_registrations: { code: "XX000", message: "boom" } }, rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect((await copyCampaignAction(null, form({ id: ID.sms }))).error).toBe("Could not copy the communication — Text (SMS) is not set up or switched on for this community.");
    expect(errors).toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
    expect((await copyCampaignAction(null, form({ id: M.cpSent }))).ok).toBe(true);
  });
  it("shows the database's own refusal in words, with what failed, and logs the detail", async () => {
    setup({ failRpc: { copy_campaign_as_draft: { code: "P0002", message: "that communication was not found in this community." } } });
    expect(await copyCampaignAction(null, form({ id: M.cpSent }))).toStrictEqual({
      ok: false,
      error: "Could not copy the communication — that communication was not found in this community.",
    });
    expect(errors).toHaveBeenCalled();
    setup({ failRpc: { copy_campaign_as_draft: { code: "42501", message: "permission denied for table comms_campaigns" } } });
    expect(await copyCampaignAction(null, form({ id: M.cpSent }))).toStrictEqual({
      ok: false,
      error: "Could not copy the communication — you don't have permission to make this change.",
    });
    setup({ failRpc: { copy_campaign_as_draft: { message: "fetch failed" } } });
    expect(await copyCampaignAction(null, form({ id: M.cpSent }))).toStrictEqual({
      ok: false,
      error: "Could not copy the communication — the database could not be reached — check the connection and try again.",
    });
  });
  it("never claims a copy exists when the database did not return one", async () => {
    setup({ rpc: { copy_campaign_as_draft: () => null } });
    const r = await copyCampaignAction(null, form({ id: M.cpSent }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("the database did not return the new draft");
  });
  it("shows a failure to read the communication, and does not copy", async () => {
    const { rpcCalls } = setup({ failTables: { comms_campaigns: { code: "XX000", message: "boom" } }, rpc: { copy_campaign_as_draft: () => ID.newDraft } });
    expect(await copyCampaignAction(null, form({ id: M.cpSent }))).toStrictEqual({ ok: false, error: "Could not copy the communication — boom." });
    expect(rpcCalls).toEqual([]);
  });
});

describe("saveTemplateAction (Save as template)", () => {
  it("saves under the communication's own name by default", async () => {
    const { rpcCalls } = setup({ rpc: { save_campaign_as_template: () => ID.tplEmail } });
    const r = await saveTemplateAction(null, form({ id: M.cpSent }));
    expect(r).toStrictEqual({
      ok: true,
      message: 'Saved as the template "September news". Find it under Start from › A saved template.',
      data: { id: ID.tplEmail, name: "September news" },
    });
    expect(rpcCalls).toEqual([{ fn: "save_campaign_as_template", args: { p_center: C, p_campaign: M.cpSent, p_name: "September news" } }]);
    expect(stub.asked).toEqual([{ key: "commsSend", doing: "save the template" }]);
  });
  it("uses the name typed, trimmed, and the subject when the communication has no name and none is typed", async () => {
    const { rpcCalls } = setup({ rpc: { save_campaign_as_template: () => ID.tplEmail } });
    await saveTemplateAction(null, form({ id: M.cpSent, name: "  Autumn news  " }));
    await saveTemplateAction(null, form({ id: ID.noName, name: "   " }));
    expect(rpcCalls.map((c) => c.args.p_name)).toEqual(["Autumn news", "Picnic on Saturday"]);
  });
  it("refuses a name that is too long, in words, before asking the database", async () => {
    const { rpcCalls } = setup();
    const r = await saveTemplateAction(null, form({ id: M.cpSent, name: "x".repeat(121) }));
    expect(r).toStrictEqual({ ok: false, error: "Could not save the template — the name is too long (120 characters at most)." });
    expect(rpcCalls).toEqual([]);
  });
  it("refuses someone who cannot write communications", async () => {
    const { rpcCalls } = setup({ permissions: ["comms.view"] });
    expect(await saveTemplateAction(null, form({ id: M.cpSent }))).toStrictEqual({ ok: false, error: "Could not save the template — you don't have permission (needs comms.send)." });
    expect(rpcCalls).toEqual([]);
  });
  it("refuses an incomplete request, a missing communication, an alert and a channel the community has not set up", async () => {
    const { rpcCalls } = setup();
    expect((await saveTemplateAction(null, form({ id: "nope" }))).error).toBe("Could not save the template — the request was incomplete.");
    expect((await saveTemplateAction(null, form({ id: ID.missing }))).error).toBe("Could not save the template — the communication was not found, or you can't see it.");
    expect((await saveTemplateAction(null, form({ id: ID.alert }))).error).toBe("Could not save the template — alerts and surveys are not saved as templates.");
    expect((await saveTemplateAction(null, form({ id: ID.sms }))).error).toBe("Could not save the template — Text (SMS) is not set up or switched on for this community.");
    expect(rpcCalls).toEqual([]);
  });
  it("tells the person when the name is taken, and what to do", async () => {
    setup({ failRpc: { save_campaign_as_template: { code: "23505", message: 'a saved template called "September news" already exists. Choose a different name.' } } });
    expect(await saveTemplateAction(null, form({ id: M.cpSent }))).toStrictEqual({
      ok: false,
      error: 'Could not save the template — a saved template called "September news" already exists. Choose a different name.',
    });
  });
  it("saves a WhatsApp communication as a template (a starting point for the words) only where WhatsApp is set up", async () => {
    setup({ whatsapp: true, rpc: { save_campaign_as_template: () => ID.tplWa } });
    expect(await saveTemplateAction(null, form({ id: ID.wa }))).toMatchObject({ ok: true, data: { name: "Lunch reminder" } });
    setup({ whatsapp: false });
    expect(await saveTemplateAction(null, form({ id: ID.wa }))).toMatchObject({ ok: false });
  });
  it("never claims a save when the database returned nothing", async () => {
    setup({ rpc: { save_campaign_as_template: () => null } });
    const r = await saveTemplateAction(null, form({ id: M.cpSent }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("the database did not return the template");
  });
});

describe("startFromTemplateAction (Use this template)", () => {
  it("makes a draft from the template and says it has no audience yet", async () => {
    const { rpcCalls } = setup({ rpc: { create_campaign_from_template: () => ID.newDraft } });
    const r = await startFromTemplateAction(null, form({ id: ID.tplEmail }));
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ id: ID.newDraft, name: "Monthly news" });
    expect(r.message).toContain("Choose who it goes to");
    expect(r.message).toContain("Nothing has been sent");
    expect(rpcCalls).toEqual([{ fn: "create_campaign_from_template", args: { p_center: C, p_template: ID.tplEmail } }]);
  });
  it("refuses someone who cannot write communications, a template that is gone and an incomplete request", async () => {
    setup({ permissions: ["comms.view"] });
    expect((await startFromTemplateAction(null, form({ id: ID.tplEmail }))).error).toBe("Could not start from the template — you don't have permission (needs comms.send).");
    setup();
    expect((await startFromTemplateAction(null, form({ id: ID.missing }))).error).toBe("Could not start from the template — the template was not found. It may have been deleted.");
    expect((await startFromTemplateAction(null, form({ id: "x" }))).error).toBe("Could not start from the template — the request was incomplete.");
  });
  it("offers a text or WhatsApp template only where that channel is set up", async () => {
    const { rpcCalls } = setup();
    expect((await startFromTemplateAction(null, form({ id: ID.tplSms }))).error).toBe("Could not start from the template — Text (SMS) is not set up or switched on for this community.");
    expect((await startFromTemplateAction(null, form({ id: ID.tplWa }))).error).toBe("Could not start from the template — WhatsApp is not set up or switched on for this community.");
    expect(rpcCalls).toEqual([]);
    setup({ texting: true, whatsapp: true, rpc: { create_campaign_from_template: () => ID.newDraft } });
    expect((await startFromTemplateAction(null, form({ id: ID.tplSms }))).ok).toBe(true);
    expect((await startFromTemplateAction(null, form({ id: ID.tplWa }))).ok).toBe(true);
  });
  it("shows the database's refusal and never claims a draft it did not make", async () => {
    setup({ failRpc: { create_campaign_from_template: { code: "P0002", message: "that template was not found in this community." } } });
    expect((await startFromTemplateAction(null, form({ id: ID.tplEmail }))).error).toBe("Could not start from the template — that template was not found in this community.");
    setup({ rpc: { create_campaign_from_template: () => null } });
    expect((await startFromTemplateAction(null, form({ id: ID.tplEmail }))).error).toContain("the database did not return the new draft");
  });
});

describe("renameTemplateAction and deleteTemplateAction", () => {
  it("renames, trimming the name", async () => {
    const { rpcCalls } = setup({ rpc: { rename_comms_template: null } });
    const r = await renameTemplateAction(null, form({ id: ID.tplEmail, name: "  Autumn news " }));
    expect(r).toStrictEqual({ ok: true, message: 'Renamed to "Autumn news".', data: { id: ID.tplEmail, name: "Autumn news" } });
    expect(rpcCalls).toEqual([{ fn: "rename_comms_template", args: { p_center: C, p_template: ID.tplEmail, p_name: "Autumn news" } }]);
  });
  it("refuses an empty name, an incomplete request and someone who cannot write communications", async () => {
    const { rpcCalls } = setup();
    expect((await renameTemplateAction(null, form({ id: ID.tplEmail, name: " " }))).error).toBe("Could not rename the template — give the template a name.");
    expect((await renameTemplateAction(null, form({ id: "x", name: "A" }))).error).toBe("Could not rename the template — the request was incomplete.");
    setup({ permissions: ["comms.view"] });
    expect((await renameTemplateAction(null, form({ id: ID.tplEmail, name: "A" }))).error).toBe("Could not rename the template — you don't have permission (needs comms.send).");
    expect(rpcCalls).toEqual([]);
  });
  it("says when the new name is taken", async () => {
    setup({ failRpc: { rename_comms_template: { code: "23505", message: 'a saved template called "Lunch reminder" already exists. Choose a different name.' } } });
    expect((await renameTemplateAction(null, form({ id: ID.tplEmail, name: "Lunch reminder" }))).error).toBe(
      'Could not rename the template — a saved template called "Lunch reminder" already exists. Choose a different name.',
    );
  });
  it("deletes, and says the communications made from it are not changed", async () => {
    const { rpcCalls } = setup({ rpc: { delete_comms_template: null } });
    const r = await deleteTemplateAction(null, form({ id: ID.tplEmail }));
    expect(r).toStrictEqual({
      ok: true,
      message: 'Deleted the template "Monthly news". Communications made from it are not changed.',
      data: { id: ID.tplEmail, name: "Monthly news" },
    });
    expect(rpcCalls).toEqual([{ fn: "delete_comms_template", args: { p_center: C, p_template: ID.tplEmail } }]);
  });
  it("refuses a template that is already gone, an incomplete request and someone who cannot write communications", async () => {
    const { rpcCalls } = setup();
    expect((await deleteTemplateAction(null, form({ id: ID.missing }))).error).toBe("Could not delete the template — it was not found. It may already be deleted.");
    expect((await deleteTemplateAction(null, form({ id: "x" }))).error).toBe("Could not delete the template — the request was incomplete.");
    setup({ permissions: ["comms.view"] });
    expect((await deleteTemplateAction(null, form({ id: ID.tplEmail }))).error).toBe("Could not delete the template — you don't have permission (needs comms.send).");
    expect(rpcCalls).toEqual([]);
  });
  it("shows the database's refusal to delete", async () => {
    setup({ failRpc: { delete_comms_template: { code: "42501", message: "You do not have permission to delete a template (it needs comms.send)." } } });
    expect((await deleteTemplateAction(null, form({ id: ID.tplEmail }))).error).toBe("Could not delete the template — you don't have permission to make this change.");
  });
});

describe("saveCampaignAction on a working draft", () => {
  const fields = (over: Record<string, string | string[]> = {}) => ({
    id: ID.draftA,
    name: "Copy of September news",
    title: "News",
    body_md: "Dear {{recipient_first_name}}",
    channels: ["email", "push"],
    audience: JSON.stringify({ zone_ids: [M.zone] }),
    ...over,
  });
  const patchOf = (calls: { table: string; op: string; patch?: Record<string, unknown> }[]) => calls.find((c) => c.table === "comms_campaigns" && c.op === "update")?.patch;

  it("saves the draft and keeps it a draft: not awaiting approval, not scheduled, no approver", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields()));
    expect(r).toStrictEqual({ ok: true, message: "Draft saved. Nothing has been sent and nobody has been asked to approve it." });
    expect(patchOf(calls)).toMatchObject({ status: "working_draft", approved_by: null, second_approver: null, name: "Copy of September news", body_md: "Dear {{recipient_first_name}}" });
  });
  it("saves a draft with no audience yet (it keeps an empty audience)", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields({ audience: "{}" })));
    expect(r.ok).toBe(true);
    expect(patchOf(calls)).toMatchObject({ status: "working_draft", audience: {}, requires_second_approver: false });
  });
  it("needs a name, a subject, a message and a channel to save a draft", async () => {
    setup();
    expect((await saveCampaignAction(null, form(fields({ name: "" })))).error).toBe("Could not save the draft — give the newsletter a name.");
    expect((await saveCampaignAction(null, form(fields({ title: "" })))).error).toBe("Could not save the draft — add a subject.");
    expect((await saveCampaignAction(null, form(fields({ body_md: "" })))).error).toBe("Could not save the draft — write the message.");
    expect((await saveCampaignAction(null, form(fields({ channels: [] })))).error).toBe("Could not save the draft — choose at least one channel.");
  });
  it("sends it for approval as a person who can approve: scheduled in one step, never sent", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields({ intent: "submit" })));
    expect(r.ok).toBe(true);
    expect(r.message).toContain('"Copy of September news" approved and scheduled.');
    expect(r.message).toContain("It stays queued");
    expect(patchOf(calls)).toMatchObject({ status: "scheduled", approved_by: "user-1" });
    expect(typeof patchOf(calls)?.scheduled_at).toBe("string");
  });
  it("sends a message to all members for approval, to wait for two different approvers", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields({ intent: "submit", audience: JSON.stringify({ all_members: true }) })));
    expect(r).toStrictEqual({ ok: true, message: `"Copy of September news" sent for approval · it appears in approvers' tasks.` });
    expect(patchOf(calls)).toMatchObject({ status: "draft", approved_by: null, requires_second_approver: true });
  });
  it("sends it to the approvers when the person cannot approve", async () => {
    const { calls } = setup({ permissions: ["comms.view", "comms.send"] });
    const r = await saveCampaignAction(null, form(fields({ intent: "submit" })));
    expect(r.message).toBe(`"Copy of September news" sent for approval · it appears in approvers' tasks.`);
    expect(patchOf(calls)).toMatchObject({ status: "draft", approved_by: null });
  });
  it("will not send for approval without an audience", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields({ intent: "submit", audience: "{}" })));
    expect(r).toStrictEqual({ ok: false, error: "Could not send the draft for approval — choose at least one audience segment." });
    expect(patchOf(calls)).toBeUndefined();
  });
  it("says so when the draft has moved on (sent for approval or discarded) since the page was opened", async () => {
    const { tables, calls } = setup();
    const row = tables.comms_campaigns.find((c) => c.id === ID.draftA)!;
    // The draft is read as a working draft, then someone else sends it: the guarded update finds nothing.
    let reads = 0;
    Object.defineProperty(row, "status", { get: () => (reads++ === 0 ? "working_draft" : "draft"), configurable: true });
    const r = await saveCampaignAction(null, form(fields()));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("it is no longer a draft");
    // The update was guarded by the draft status, so it matched nothing.
    expect(calls.filter((c) => c.op === "update").flatMap((c) => c.ids)).toEqual([]);
  });
  it("shows a failed save in words and logs the detail", async () => {
    const { db, tables } = messagesDb({ failUpdates: { comms_campaigns: { code: "XX000", message: "boom" } } });
    tables.comms_campaigns.push({ id: ID.draftA, center_id: C, kind: "newsletter", name: "D", title: "T", status: "working_draft", audience: {}, channels: ["email"], ...base });
    stub.session = messagesSession(db, {});
    const r = await saveCampaignAction(null, form(fields()));
    expect(r).toStrictEqual({ ok: false, error: "Could not save the draft — boom." });
    expect(errors).toHaveBeenCalled();
  });
  it("refuses someone who cannot write communications", async () => {
    setup({ permissions: ["comms.view"] });
    expect((await saveCampaignAction(null, form(fields()))).error).toBe("Could not save the newsletter — you don't have permission (needs comms.send).");
  });
  it("keeps the old behaviour for a communication that is awaiting approval: any save puts it back to awaiting approval", async () => {
    const { calls } = setup();
    const r = await saveCampaignAction(null, form(fields({ id: M.cpSmall, name: "North zone picnic", title: "Picnic" })));
    expect(r).toStrictEqual({ ok: true, message: "Saved." });
    expect(patchOf(calls)).toMatchObject({ status: "draft", approved_by: null, second_approver: null });
    const gone = await saveCampaignAction(null, form(fields({ id: M.cpSent })));
    expect(gone).toStrictEqual({ ok: false, error: "Could not save the newsletter — it has already gone out." });
  });
});
