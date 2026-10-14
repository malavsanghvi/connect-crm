import { describe, expect, it } from "vitest";

import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";

import { guardStalePage, isStalePageError, STALE_PAGE_MESSAGE } from "@/lib/stale-page";

const notFound = () =>
  new UnrecognizedActionError('Server Action "70297322620a5695a98e9c0250b993f12b535fcdae" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');

describe("a page left open across a deploy", () => {
  it("recognises Next's unrecognised-action error, and the same words from a plain Error", () => {
    expect(isStalePageError(notFound())).toBe(true);
    expect(isStalePageError(new Error('Server Action "abc" was not found on the server.'))).toBe(true);
  });

  it("does not mistake other failures for it", () => {
    expect(isStalePageError(new Error("Could not record the payment."))).toBe(false);
    expect(isStalePageError(null)).toBe(false);
    expect(isStalePageError("Server Action")).toBe(false);
  });

  it("turns the stale-action error into a plain sentence with stale set, so the form can offer Reload", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const action = guardStalePage(async (_prev: unknown, _fd: FormData) => {
      throw notFound();
    });
    const res = await action(null, new FormData());
    expect(res).toEqual({ ok: false, error: STALE_PAGE_MESSAGE, stale: true });
    expect(STALE_PAGE_MESSAGE).toMatch(/nothing was saved/);
  });

  it("passes a normal result through untouched", async () => {
    const action = guardStalePage(async (_prev: unknown, fd: FormData) => ({ ok: true as const, message: String(fd.get("x")) }));
    const fd = new FormData();
    fd.set("x", "Published.");
    expect(await action(null, fd)).toEqual({ ok: true, message: "Published." });
  });

  it("still throws anything that is not a stale page, so the error screen shows it", async () => {
    const boom = new Error("boom");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const action = guardStalePage(async (_prev: unknown, _fd: FormData) => {
      throw boom;
    });
    await expect(action(null, new FormData())).rejects.toBe(boom);
  });
});
