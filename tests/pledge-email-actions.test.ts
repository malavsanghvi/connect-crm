import { beforeEach, describe, expect, it, vi } from "vitest";

// The Server Actions behind the Email sheet and the bulk upload's result (0792, 0793): giving.manage, the address checked, one request per
// confirmation key, and every failure said in plain English next to what the person did. The database decides the rest (supabase/tests/184).

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: async (_key: string, action: () => Promise<unknown>) => action() }));
const rpc = vi.fn();
let allowed = true;
let modulesOff: string[] = [];
vi.mock("@/lib/session", () => ({
  authorizeAction: async (key: string, doing: string) =>
    allowed
      ? { ok: true, session: { db: { rpc: (n: string, a: unknown) => rpc(n, a) }, center: { id: "c-1", name: "Riverside", country: "US", state_region: "TX", rules: {} }, modulesOff, accessKey: key } }
      : { ok: false, error: `Could not ${doing} — you don't have permission (needs giving.manage).` },
}));

import { emailPledgeAction, pledgeEmailSheetAction, pledgeEmailStatusAction, pledgeEmailsStatusAction } from "@/app/(app)/giving/pledges/email-pledge-actions";

const PLEDGE = "18400000-0000-4000-8000-000000000201";
const REQ = "18400000-0000-4000-8000-000000000999";
const KEY = "email-3f2a9c1e-8d7b-4a10-9e55-000000000001";

beforeEach(() => {
  rpc.mockReset();
  allowed = true;
  modulesOff = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Send: emailing a pledge to the address in the box", () => {
  it("asks the database to write the email for exactly that address (trimmed, lower case), once per confirmation key, and says it is on its way", async () => {
    rpc.mockResolvedValue({ data: { request_id: REQ, replayed: false, to: "tarun@example.org", status: "requested" }, error: null });
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "  Tarun@Example.ORG ", key: KEY });
    expect(rpc).toHaveBeenCalledWith("send_pledge_email", { p_center: "c-1", p_pledge: PLEDGE, p_to: "tarun@example.org", p_key: KEY });
    expect(r).toEqual({ ok: true, data: { requestId: REQ, to: "tarun@example.org", replayed: false }, message: "Sending the pledge to tarun@example.org… It leaves in a moment; this shows when it has gone." });
  });

  it("never says it was sent: only that it is on its way (the sheet asks the database how it went)", async () => {
    rpc.mockResolvedValue({ data: { request_id: REQ, to: "a@b.co" }, error: null });
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(r.ok && r.message).not.toMatch(/^Sent|\bsent to\b/i);
  });

  it("a double click (the same key) comes back as the same request, flagged", async () => {
    rpc.mockResolvedValue({ data: { request_id: REQ, replayed: true, to: "a@b.co", status: "queued" }, error: null });
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(r.ok && r.data?.replayed).toBe(true);
    expect(r.ok && r.data?.requestId).toBe(REQ);
  });

  it("refuses without giving.manage, before the database is asked", async () => {
    allowed = false;
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(r).toEqual({ ok: false, error: "Could not email the pledge — you don't have permission (needs giving.manage)." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when Giving is switched off, naming the community", async () => {
    modulesOff = ["giving"];
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("Riverside");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("says what is wrong with the address, in plain English, and sends nothing", async () => {
    for (const [to, part] of [
      ["", "type the email address"],
      ["tarun@example", "does not look like an email address"],
      ["a@b.co, c@d.co", "more than one address"],
    ] as const) {
      const r = await emailPledgeAction({ pledgeId: PLEDGE, to, key: KEY });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.startsWith("Could not email the pledge — ")).toBe(true);
      expect(!r.ok && r.error).toContain(part);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a pledge that is not an id and a confirmation key that is not one", async () => {
    expect(await emailPledgeAction({ pledgeId: "nope", to: "a@b.co", key: KEY })).toEqual({ ok: false, error: "Could not email the pledge — it was not found. Reload the page." });
    expect(await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: "short" })).toEqual({ ok: false, error: "Could not email the pledge — close the sheet and open it again." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's plain sentence on, with what did not happen", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "This pledge was deleted (cancelled), so there is nothing to send." } });
    const r = await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(r).toEqual({ ok: false, error: "Could not email the pledge. Nothing was sent — This pledge was deleted (cancelled), so there is nothing to send." });
  });

  it("explains the hourly limit and a refused permission in the person's words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "You have emailed 40 pledges in the last hour. Wait a while before sending more." } });
    expect(await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY })).toMatchObject({ ok: false, error: expect.stringContaining("emailed 40 pledges in the last hour") });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY })).toMatchObject({ ok: false, error: expect.stringContaining("you don't have permission") });
  });

  it("does not claim success when the database answered with nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY })).toEqual({
      ok: false,
      error: "The email may not have been sent: the database did not say. Look at the pledge's History before trying again.",
    });
  });

  it("logs the technical detail on the server", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await emailPledgeAction({ pledgeId: PLEDGE, to: "a@b.co", key: KEY });
    expect(console.error).toHaveBeenCalled();
  });
});

describe("the Email sheet's data", () => {
  const data = {
    pledge: { id: PLEDGE, number: "PL-0455", status: "open", household_id: "h-1", amount_cents: 120000 },
    primary: { person_id: "p-1", name: "Tarun Patni", email: "tarun@example.org", problem: null, message: null },
    earlier: [],
  };

  it("opens with the primary member's address, asked for this community with its age of majority", async () => {
    rpc.mockResolvedValue({ data, error: null });
    const r = await pledgeEmailSheetAction(PLEDGE);
    expect(rpc).toHaveBeenCalledWith("pledge_email_recipient", { p_center: "c-1", p_pledge: PLEDGE, p_majority: 18 });
    expect(r.ok && r.data?.primary.email).toBe("tarun@example.org");
    expect(r.ok && r.data?.pledge.householdId).toBe("h-1");
  });

  it("says plainly when it cannot open, in each way", async () => {
    allowed = false;
    expect(await pledgeEmailSheetAction(PLEDGE)).toMatchObject({ ok: false, error: expect.stringContaining("Could not open the pledge to email it") });
    allowed = true;
    expect(await pledgeEmailSheetAction("nope")).toEqual({ ok: false, error: "Could not open the pledge to email it — it was not found. Reload the page." });
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "That pledge was not found." } });
    expect(await pledgeEmailSheetAction(PLEDGE)).toEqual({ ok: false, error: "Could not open the pledge to email it — That pledge was not found." });
    rpc.mockResolvedValue({ data: { nonsense: true }, error: null });
    expect(await pledgeEmailSheetAction(PLEDGE)).toEqual({ ok: false, error: "Could not open the pledge to email it — the database did not answer as expected. Try again." });
  });
});

describe("how an email is doing", () => {
  it("reads one request's status, and says when it cannot", async () => {
    rpc.mockResolvedValue({ data: { status: "sent", to: "a@b.co", reason: null }, error: null });
    expect(await pledgeEmailStatusAction(REQ)).toEqual({ ok: true, data: { status: "sent", to: "a@b.co", reason: null } });
    expect(rpc).toHaveBeenCalledWith("pledge_email_request_status", { p_center: "c-1", p_request: REQ });
    expect(await pledgeEmailStatusAction("x")).toEqual({ ok: false, error: "Could not check the email — it was not found. Reload the page." });
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST301", message: "jwt expired" } });
    expect(await pledgeEmailStatusAction(REQ)).toMatchObject({ ok: false, error: expect.stringContaining("your session has expired") });
  });
});

describe("how each pledge of an upload is doing", () => {
  it("asks about the distinct pledge ids only, and reads the database's list", async () => {
    rpc.mockResolvedValue({ data: [{ pledge_id: PLEDGE, number: "PL-1", state: "no_email", reason: "Not sent: no" }], error: null });
    const r = await pledgeEmailsStatusAction([PLEDGE, PLEDGE, "not-an-id"]);
    expect(rpc).toHaveBeenCalledWith("pledge_email_status", { p_center: "c-1", p_pledges: [PLEDGE], p_majority: 18 });
    expect(r).toEqual({ ok: true, data: [{ pledgeId: PLEDGE, number: "PL-1", state: "no_email", reason: "Not sent: no" }] });
  });

  it("asks nothing for nothing, refuses too many, and says when it cannot read", async () => {
    expect(await pledgeEmailsStatusAction([])).toEqual({ ok: true, data: [] });
    expect(rpc).not.toHaveBeenCalled();
    const many = Array.from({ length: 501 }, (_, i) => `18400000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await pledgeEmailsStatusAction(many)).toEqual({ ok: false, error: "Could not check the emails — ask about at most 500 pledges at a time." });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    expect(await pledgeEmailsStatusAction([PLEDGE])).toMatchObject({ ok: false, error: expect.stringContaining("Could not check the emails") });
    allowed = false;
    expect(await pledgeEmailsStatusAction([PLEDGE])).toMatchObject({ ok: false });
  });
});
