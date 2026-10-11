import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const providers = vi.hoisted(() => ({ sendEmail: vi.fn(), sendTwilio: vi.fn() }));
vi.mock("@/lib/messaging/providers", async (orig) => ({ ...(await orig<object>()), sendEmail: providers.sendEmail, sendTwilio: providers.sendTwilio }));
vi.mock("@/lib/messaging/server-db", () => ({ workerQuery: vi.fn(async () => null) }));
vi.mock("@/lib/platform-setup/server-config", () => ({ platformEnv: vi.fn(async () => ({})) }));

import { sendSignInEmail } from "@/lib/messaging/sign-in";

beforeEach(() => {
  providers.sendEmail.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("sign-in codes for demo addresses", () => {
  it("are never sent: a demo person has no mailbox, and signs in with Try the demo", async () => {
    for (const type of ["magiclink", "signup", "recovery", "email"]) {
      const res = await sendSignInEmail({ email: "treasurer@demo.weaverams.org" }, { token: "123456", email_action_type: type });
      expect(res).toEqual({ ok: false, status: 400, message: expect.stringContaining("demo address") });
    }
    expect(providers.sendEmail).not.toHaveBeenCalled();
  });

  it("are not sent for an email change to a demo address either", async () => {
    const res = await sendSignInEmail({ email: "ada@jsh.org", new_email: "x@demo.weaverams.org" }, { token_new: "654321", token: "123456", email_action_type: "email_change" });
    expect(res.ok).toBe(false);
    expect(providers.sendEmail).not.toHaveBeenCalled();
  });

  it("are not sent for a demo person asking for their sign-in to be changed to an address of their own", async () => {
    const res = await sendSignInEmail({ email: "treasurer@demo.weaverams.org", new_email: "visitor@example.org" }, { token_new: "654321", token: "123456", email_action_type: "email_change" });
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(providers.sendEmail).not.toHaveBeenCalled();
  });

  it("do not stop an ordinary address (it goes on as before, here to the 'not configured' answer)", async () => {
    const res = await sendSignInEmail({ email: "ada@jsh.org" }, { token: "123456", email_action_type: "magiclink" });
    expect(res).toMatchObject({ ok: false, status: 503 });
  });
});
