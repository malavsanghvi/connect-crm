import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseClaimsList } from "@/lib/matching/catch";
import { claimSendOutcome, parseClaimMessagePreview, parseClaimSendResult, reachLine } from "@/lib/matching/send";

// CatchTheMatch Phase 1, piece 1 (migration 0921): "Send to the member". The words, the Server Action (it must refuse in words, and queue
// nothing, when email cannot leave) and the screen that shows the exact message. The database builds the text; the screen cannot change it.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/matching/send",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const rpc = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ manage: true, env: {} as Record<string, string | undefined>, preview: null as unknown }));
const session = {
  permissions: ["matching.manage"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  db: {},
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({
  getSession: async () => session,
  loadSession: async () => ({ status: "ok", session }),
  authorizeActionWhere: async (check: (s: unknown) => boolean) =>
    state.manage && check({ permissions: ["matching.manage"], isPlatformAdmin: false, modulesOff: [] })
      ? { ok: true, session: { center: { id: "c1" }, requestId: "r1", clientApp: "portal" } }
      : { ok: false, error: "Could not send the message — you don't have permission (needs matching.manage)." },
  dbWithReason: async () => ({ rpc }),
}));
vi.mock("@/lib/platform-setup/server-config", () => ({ platformEnv: async () => state.env }));
vi.mock("@/lib/matching/data", () => ({ loadClaimMessage: async () => state.preview }));

import { sendClaimMessageAction } from "@/app/(app)/giving/matching/actions";
import SendPage from "@/app/(app)/giving/matching/send/page";

const P = "92100000-0000-4000-8000-0000000000a2";
const G = "92100000-0000-4000-8000-0000000000e1";
const previewJson = (over: Record<string, unknown> = {}) => ({
  problem: null,
  program: { id: G, company_name: "Acme" },
  employer: "Acme Corp",
  person: { id: P, name: "Bo Bravo" },
  gifts: [{ received_on: "2026-10-07", deadline_on: "2027-04-07" }],
  subject: "How to ask Acme Corp to match your gift to Grace Church",
  body: "Hello Bo,\n\nThank you for your gift to Grace Church.\n\nThank you,\nGrace Church",
  email: true,
  app: false,
  sandbox: false,
  ...over,
});
const form = (person = P, program = G) => {
  const fd = new FormData();
  fd.set("person_id", person);
  fd.set("program_id", program);
  fd.set("first_name", "Bo");
  return fd;
};

describe("the words", () => {
  it("reads the preview: no address, only how the person can be reached", () => {
    const p = parseClaimMessagePreview(previewJson({ app: true }));
    expect(p.person).toEqual({ id: P, name: "Bo Bravo" });
    expect(p.gifts).toEqual([{ receivedOn: "2026-10-07", deadlineOn: "2027-04-07" }]);
    expect(reachLine(p)).toBe("By email and in the member app");
    expect(reachLine({ email: true, app: false })).toBe("By email");
    expect(reachLine({ email: false, app: true })).toBe("In the member app");
    expect(reachLine({ email: false, app: false })).toBe("No way to reach this person from Weaver");
  });

  it("says queued, never sent, and where the real outcome shows", () => {
    const o = claimSendOutcome(parseClaimSendResult({ queued: true, email: true, push: true, not_queued: {}, claims: 2 }), "Bo");
    expect(o.ok).toBe(true);
    const m = o.ok ? o.message : "";
    expect(m).toContain("Queued the message to Bo by email and in the member app.");
    expect(m).toContain("Settings › Email › Recent emails");
    expect(m).toContain("The 2 gifts are now under Claims as asked, by message.");
    expect(m).not.toMatch(/\bsent\b/i);
  });

  it("is an error when nothing was queued, and says nothing was recorded", () => {
    const o = claimSendOutcome(parseClaimSendResult({ queued: false, not_queued: { "This community is a sandbox: it messages only verified test recipients (Settings › Limits).": 1 }, claims: 0 }), "Bo");
    expect(o.ok).toBe(false);
    expect(!o.ok && o.error).toContain("nothing was queued, and nothing was recorded");
    expect(!o.ok && o.error).toContain("sandbox");
  });

  it("lists the part that could not be queued next to a success", () => {
    const o = claimSendOutcome(parseClaimSendResult({ queued: true, email: false, push: true, not_queued: { "The address is suppressed (it bounced, a spam complaint, STOP or added by staff).": 1 }, claims: 1 }), "Bo");
    expect(o.ok && o.message).toContain("in the member app");
    expect(o.ok && o.message).toContain("Not queued: The address is suppressed");
  });

  it("reads when a member was asked by message on the claims list", () => {
    const list = parseClaimsList({
      filter: "open", total: 1, amounts: false, today: "2026-10-17", can_manage: true,
      rows: [{ id: "c1", state: "asked", state_at: "2026-10-17T10:00:00Z", asked_by_message_at: "2026-10-17T10:00:00Z", person: { id: P, name: "Bo Bravo" }, household: null,
               program: { id: G, company_name: "Acme" }, gift: { payment_id: "p1", received_on: "2026-10-07", amount_cents: null }, deadline_on: "2027-04-07" }],
    });
    expect(list.rows[0].askedByMessageAt).toBe("2026-10-17T10:00:00Z");
  });
});

describe("the Send action", () => {
  beforeEach(() => {
    rpc.mockReset();
    state.manage = true;
    state.env = { RESEND_API_KEY: "re_x" };
  });

  it("refuses in words, and queues nothing, when email is not set up", async () => {
    state.env = {};
    const r = await sendClaimMessageAction(null, form());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Email sending is not set up");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses someone without matching.manage", async () => {
    state.manage = false;
    const r = await sendClaimMessageAction(null, form());
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a bad id before calling the database", async () => {
    const r = await sendClaimMessageAction(null, form("nope"));
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends only the member and the program: the text is built in the database", async () => {
    rpc.mockResolvedValue({ data: { queued: true, email: true, push: false, not_queued: {}, claims: 1 }, error: null });
    const fd = form();
    fd.set("body", "Send them something else");
    const r = await sendClaimMessageAction(null, fd);
    expect(rpc).toHaveBeenCalledWith("send_match_claim_message", { p_center: "c1", p_person: P, p_program: G });
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toContain("Queued the message to Bo by email");
  });

  it("turns a sandbox refusal and a database error into plain sentences", async () => {
    rpc.mockResolvedValue({ data: { queued: false, not_queued: { "This community is a sandbox: it messages only verified test recipients (Settings › Limits).": 1 }, claims: 0 }, error: null });
    const refused = await sendClaimMessageAction(null, form());
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("sandbox");
    rpc.mockResolvedValue({ data: null, error: { message: "Nothing is left to ask for: this person has no gift that can still be claimed.", code: "22023" } });
    const failed = await sendClaimMessageAction(null, form());
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error).toMatch(/^Could not send the message to Bo/);
  });
});

describe("the Send screen", () => {
  const draw = async (sp: Record<string, string> = { person: P, program: G }) => renderToStaticMarkup(await SendPage({ searchParams: Promise.resolve(sp) }));
  beforeEach(() => {
    session.permissions = ["matching.manage"];
    state.env = { RESEND_API_KEY: "re_x" };
    state.preview = { ok: true, data: parseClaimMessagePreview(previewJson()) };
  });

  it("shows the exact message, who it reaches and the gift, with a Send button and no amount", async () => {
    const html = await draw();
    expect(html).toContain("Send to Bo Bravo");
    expect(html).toContain("By email.");
    expect(html).toContain("7 October 2026 (ask by 7 April 2027)");
    expect(html).toContain("Subject: </span>How to ask Acme Corp to match your gift to Grace Church");
    expect(html).toContain("Thank you for your gift to Grace Church.");
    expect(html).toContain(">Send to Bo<");
    expect(html).toContain("It carries no amount");
    expect(html).not.toMatch(/\$\d/);
  });

  it("says, and offers no Send, when email is not set up; the message can still be copied", async () => {
    state.env = {};
    const html = await draw();
    expect(html).toContain("Email is not set up, so nothing can be sent from here yet");
    expect(html).toContain("Copy the message instead");
    expect(html).not.toContain(">Send to Bo<");
  });

  it("says why it cannot be sent, and offers no Send", async () => {
    state.preview = { ok: true, data: parseClaimMessagePreview(previewJson({ problem: "There is no way to reach this person from Weaver: no email address that can be written to and no member app. Copy the message and send it another way.", email: false })) };
    const html = await draw();
    expect(html).toContain("It cannot be sent");
    expect(html).toContain("No way to reach this person from Weaver.");
    expect(html).not.toContain(">Send to Bo<");
  });

  it("says a sandbox reaches only verified test recipients", async () => {
    state.preview = { ok: true, data: parseClaimMessagePreview(previewJson({ sandbox: true })) };
    expect(await draw()).toContain("A sandbox messages only verified test recipients");
  });

  it("is for a manager only, and asks for a member when the address is wrong", async () => {
    session.permissions = ["matching.view"];
    expect(await draw()).toContain("You don&#x27;t have access to this area");
    session.permissions = ["matching.manage"];
    expect(await draw({ person: "nope" })).toContain("That member was not found");
  });

  it("shows a load error with a way to retry", async () => {
    state.preview = { ok: false, error: "Could not load the message to send: the database could not be reached." };
    const html = await draw();
    expect(html).toContain("The message could not be prepared");
    expect(html).toContain("Try again");
  });
});
