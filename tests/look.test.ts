import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The cookie that holds a person's choice of look, and the action that sets it. Next's request helpers are replaced.
const set = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set }),
  headers: async () => new Headers({ host: "portal.example.org", "x-forwarded-proto": "https" }),
}));

import { setLookAction } from "@/app/look-actions";
import { LOOK_COOKIE, parseLook } from "@/lib/look";

describe("parseLook", () => {
  it("names the cookie weaver_look", () => {
    expect(LOOK_COOKIE).toBe("weaver_look");
  });

  it("is the new look only for the exact value v2", () => {
    expect(parseLook("v2")).toBe("v2");
  });

  it("is the classic look for everything else: nothing, junk, other cases", () => {
    for (const value of [undefined, null, "", "classic", "V2", "v2 ", "v3", "true", "1", "new"]) {
      expect(parseLook(value as string | undefined | null), String(value)).toBe("classic");
    }
  });
});

describe("setLookAction", () => {
  beforeEach(() => set.mockReset());

  it("keeps the choice for a year, for the whole portal, on this browser", async () => {
    const res = await setLookAction("v2");
    expect(res).toEqual({ ok: true, data: { look: "v2" } });
    expect(set).toHaveBeenCalledTimes(1);
    const [name, value, options] = set.mock.calls[0];
    expect(name).toBe(LOOK_COOKIE);
    expect(value).toBe("v2");
    expect(options).toMatchObject({ path: "/", sameSite: "lax", maxAge: 31_536_000, secure: true });
    expect(options.httpOnly).not.toBe(true);
  });

  it("can switch back to the classic look", async () => {
    expect(await setLookAction("classic")).toEqual({ ok: true, data: { look: "classic" } });
    expect(set.mock.calls[0][1]).toBe("classic");
    expect(parseLook(set.mock.calls[0][1])).toBe("classic");
  });

  it("refuses a value that is not one of the two looks, and says so in plain English", async () => {
    const res = await setLookAction("sparkly" as never);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not change the look — /);
    expect(set).not.toHaveBeenCalled();
  });

  it("shows the failure when the cookie cannot be written", async () => {
    set.mockImplementationOnce(() => {
      throw new Error("cookies are read-only here");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await setLookAction("v2");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not change the look — /);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
