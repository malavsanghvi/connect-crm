import { beforeEach, describe, expect, it, vi } from "vitest";

// A change that is only a request must never be reported as saved (migration 0597): the Zelle bank account and the PayPal
// email become requests when they replace a value that is already saved. The actions that call those functions read the
// answer and say so in plain English. The database and the session are replaced.
const sessionRpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/payments/server", () => ({
  tokenClient: () => null,
  NotConfigured: class NotConfigured extends Error {},
  ProviderError: class ProviderError extends Error {},
  originOf: () => "http://localhost:3000",
  paypalReferralUrl: vi.fn(),
  stripeAuthorizeUrl: vi.fn(),
}));
vi.mock("@/lib/payments/checkout", () => ({ startProviderCheckout: vi.fn() }));
vi.mock("@/lib/platform-setup/server-config", () => ({ loadPlatformConfig: vi.fn() }));
vi.mock("@/lib/session", () => ({
  authorizeAction: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } }),
  dbWithReason: async (session: { db: unknown }) => session.db,
}));

import { saveZelleReportingAction } from "@/app/(app)/giving/payments/bank/zelle-actions";
import { confirmPaypalCodeAction } from "@/app/(app)/settings/payments/actions";

const CENTER = "00000000-0000-4000-8000-000000000001";
const OLD = "82000000-0000-4000-8000-0000000000b1";
const NEW = "82000000-0000-4000-8000-0000000000b2";
const REQUEST = "11111111-1111-4111-8111-111111111111";

beforeEach(() => sessionRpc.mockReset());

describe("saveZelleReportingAction", () => {
  it("says Saved, with the account, when nothing waits for a second person", async () => {
    sessionRpc.mockResolvedValue({ data: { report_window_days: 7, bank_account_id: NEW }, error: null });
    const res = await saveZelleReportingAction(7, NEW, "Chase posts Zelle the same day");
    expect(res).toEqual({
      ok: true, message: "Saved: reports are flagged after 7 days and matched against the chosen account only.",
      data: { windowDays: 7, bankAccountId: NEW, pendingChange: false },
    });
    expect(sessionRpc).toHaveBeenCalledWith("set_zelle_reporting", { p_center: CENTER, p_window_days: 7, p_bank_account: NEW, p_reason: "Chase posts Zelle the same day" });
  });

  it("never says Saved for the account when the change is only a request: it says what was saved, what was not and who must act", async () => {
    sessionRpc.mockResolvedValue({ data: { report_window_days: 7, bank_account_id: OLD, pending_change: REQUEST }, error: null });
    const res = await saveZelleReportingAction(7, NEW, "Move Zelle to the savings account");
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ windowDays: 7, bankAccountId: OLD, pendingChange: true });
    expect(res.message).toContain("The report window is saved: reports are flagged after 7 days.");
    expect(res.message).toContain("The bank account is NOT changed yet: changing it needs a second person.");
    expect(res.message).toContain("A different person with giving.approve has to confirm it");
    expect(res.message).toContain("Until then Zelle lines are matched against the account that was chosen before.");
    expect(res.message).not.toMatch(/^Saved/);
    expect(res.message).not.toContain("matched against the chosen account only");
  });

  it("keeps the account the screen shows as the one in force, and asks for a fresh 2FA check when the database does", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    expect(await saveZelleReportingAction(7, NEW, "Move Zelle to the savings account")).toMatchObject({ ok: false, stepUp: true });
    expect(sessionRpc).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("checks its input before asking the database", async () => {
    expect((await saveZelleReportingAction(2, null, "x")).error).toMatch(/3 to 30 days/);
    expect((await saveZelleReportingAction(7, "not-a-uuid", "x")).error).toMatch(/choose one of the bank accounts/);
    expect((await saveZelleReportingAction(7, null, "  ")).error).toMatch(/say why/);
    expect(sessionRpc).not.toHaveBeenCalled();
  });
});

describe("confirmPaypalCodeAction", () => {
  it("passes the plain verified message when the first email is saved", async () => {
    sessionRpc.mockResolvedValue({ data: { ok: true, detail: "PayPal Business email give@jsh.example verified.", email: "give@jsh.example" }, error: null });
    expect(await confirmPaypalCodeAction("123456")).toEqual({ ok: true, message: "PayPal Business email give@jsh.example verified." });
  });

  it("says Not changed yet when replacing a saved email only made a request", async () => {
    sessionRpc.mockResolvedValue({
      data: {
        ok: true, pending: true, request_id: REQUEST, email: "second@jsh.example",
        detail: "PayPal Business email second@jsh.example verified. It replaces first@jsh.example, so a different person with giving.approve must confirm the change before PayPal gifts go to it.",
      },
      error: null,
    });
    const res = await confirmPaypalCodeAction("123456");
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/^Not changed yet\. PayPal Business email second@jsh.example verified\./);
    expect(res.message).toContain("a different person with giving.approve must confirm the change");
  });

  it("shows a wrong code as a failure next to what was done", async () => {
    sessionRpc.mockResolvedValue({ data: { ok: false, detail: "That code is not right. 4 tries left." }, error: null });
    expect(await confirmPaypalCodeAction("123456")).toEqual({ ok: false, error: "Could not verify the PayPal Business email — That code is not right. 4 tries left." });
  });
});
