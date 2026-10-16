import { beforeEach, describe, expect, it, vi } from "vitest";

// A demo shows the newest look (src/app/demo/actions.ts): starting one sets the "New look" cookie unless the visitor already chose a look
// in this browser, and never keeps it past the browser session. The database, the cookies and the redirect are replaced.
const jar = new Map<string, string>();
const set = vi.fn((name: string, value: string, options?: Record<string, unknown>) => void (options, jar.set(name, value)));
let start: { ok: true } | { ok: false; error: string } = { ok: true };

vi.mock("next/headers", () => ({ cookies: async () => ({ get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n) } : undefined), set }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/center-resolve", () => ({ currentOrigin: async () => new URL("https://admin.example.org") }));
vi.mock("@/lib/demo-signin/server", () => ({ startDemoFromRequest: async () => start, leaveDemoFromRequest: async () => ({ ok: true }) }));

import { startDemoAction } from "@/app/demo/actions";
import { LOOK_COOKIE } from "@/lib/look";

const form = () => {
  const fd = new FormData();
  fd.set("persona", "11111111-1111-4111-8111-111111111111");
  return fd;
};

beforeEach(() => {
  jar.clear();
  set.mockClear();
  start = { ok: true };
});

describe("the demo shows the New look", () => {
  it("sets it when the visitor has not chosen a look, as a browser-session cookie, and goes to Home", async () => {
    await expect(startDemoAction(null, form())).rejects.toThrow("REDIRECT:/");
    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, options] = set.mock.calls[0];
    expect([name, value]).toEqual([LOOK_COOKIE, "v2"]);
    expect(options).toMatchObject({ path: "/", sameSite: "lax", secure: true });
    expect(options).not.toHaveProperty("maxAge");
    expect(options).not.toHaveProperty("expires");
  });

  it("leaves a look the visitor chose alone", async () => {
    jar.set(LOOK_COOKIE, "classic");
    await expect(startDemoAction(null, form())).rejects.toThrow("REDIRECT:/");
    expect(set).not.toHaveBeenCalled();
    expect(jar.get(LOOK_COOKIE)).toBe("classic");
  });

  it("sets nothing when the demo did not start, and says why", async () => {
    start = { ok: false, error: "Could not start the demo — the demo is switched off right now." };
    await expect(startDemoAction(null, form())).resolves.toEqual({ ok: false, error: start.error });
    expect(set).not.toHaveBeenCalled();
  });
});
