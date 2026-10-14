import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const st = vi.hoisted(() => ({
  email: "treasurer@demo.weaverams.org" as string | null,
  updateUser: vi.fn(),
  signOut: vi.fn(),
  listFactors: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  loadSession: async () => ({
    status: "ok",
    session: { email: st.email, demo: st.email?.endsWith("@demo.weaverams.org") ?? false, center: { id: "c1" }, db: { auth: { updateUser: st.updateUser, signOut: st.signOut, mfa: { listFactors: st.listFactors } }, rpc: vi.fn() } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { sendPhoneCodeAction, signOutEverywhereAction, startTotpEnrollmentAction } from "@/app/security-actions";

beforeEach(() => {
  st.email = "treasurer@demo.weaverams.org";
  st.updateUser.mockReset().mockResolvedValue({ error: null });
  st.signOut.mockReset().mockResolvedValue({ error: null });
  st.listFactors.mockReset().mockResolvedValue({ data: { totp: [] }, error: null });
});

describe("a demo person's own sign-in settings", () => {
  it("cannot be changed: the sign-in is shared by everyone trying the demo", async () => {
    for (const run of [
      () => sendPhoneCodeAction("(713) 555-0142"),
      () => startTotpEnrollmentAction(),
      () => signOutEverywhereAction(),
    ]) {
      const res = await run();
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/^Could not .+ — this is a demo sign-in, shared by everyone trying the demo/);
    }
    expect(st.updateUser).not.toHaveBeenCalled();
    expect(st.signOut).not.toHaveBeenCalled();
  });

  it("can still be changed by a real person", async () => {
    st.email = "ada@jsh.org";
    const res = await sendPhoneCodeAction("(713) 555-0142");
    expect(res.ok).toBe(true);
    expect(st.updateUser).toHaveBeenCalledTimes(1);
  });
});
