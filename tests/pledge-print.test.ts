import { describe, expect, it, vi } from "vitest";

import { FRAME_KEEP_MS, FRAME_WAIT_MS, fetchPledgePdf, pledgePdfAddress, printPledgePdf, type PrintEnv, type PrintFrame } from "@/lib/pledge-pdf/print";

// Print… on a pledge: the PDF comes from the server, the browser's print dialog opens on it, and when anything goes wrong the person
// reads why in plain English (with a retry in the button) instead of nothing happening.

const ID = "18400000-0000-4000-8000-000000000201";
const PDF = new Blob(["%PDF-1.7"], { type: "application/pdf" });

function response(status: number, type: string, body: BodyInit): Response {
  return new Response(body, { status, headers: { "content-type": type } });
}

describe("asking the server for the PDF", () => {
  it("goes to the pledge's own address, with the person's session", async () => {
    expect(pledgePdfAddress(ID)).toBe(`/giving/pledges/${ID}/pdf`);
    const fetcher = vi.fn(async () => response(200, "application/pdf", "%PDF-1.7 x"));
    const r = await fetchPledgePdf(ID, fetcher as unknown as typeof fetch);
    expect(r.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(`/giving/pledges/${ID}/pdf`, { credentials: "same-origin", cache: "no-store" });
  });

  it("passes on the server's own sentence when it could not make the PDF", async () => {
    const f = async () => response(403, "text/plain", "Could not make the pledge PDF — you don't have access to this area.\n");
    expect(await fetchPledgePdf(ID, f as unknown as typeof fetch)).toEqual({ ok: false, error: "Could not make the pledge PDF — you don't have access to this area." });
  });

  it("does not show a proxy's error page, but says what happened", async () => {
    const page = async () => response(502, "text/html", "<html><body>Bad gateway</body></html>");
    expect(await fetchPledgePdf(ID, page as unknown as typeof fetch)).toEqual({ ok: false, error: "Could not make the pledge PDF — the server answered 502. Try again." });
    const expired = async () => response(401, "text/html", "<html>login</html>");
    expect((await fetchPledgePdf(ID, expired as unknown as typeof fetch))).toEqual({ ok: false, error: "Could not make the pledge PDF — your session has expired. Sign in again." });
  });

  it("says so when the server cannot be reached", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await fetchPledgePdf(ID, down as unknown as typeof fetch)).toEqual({
      ok: false,
      error: "Could not make the pledge PDF — the server could not be reached. Check the connection and try again.",
    });
  });

  it("a 200 that is not a PDF is not printed", async () => {
    const odd = async () => response(200, "text/plain", "hello");
    expect((await fetchPledgePdf(ID, odd as unknown as typeof fetch)).ok).toBe(false);
  });
});

/** A browser made of fakes: a frame that loads when told to, a tab that opens or is blocked, a clock that runs when told to. */
function fakeEnv(opts: { printThrows?: boolean; frameThrows?: boolean; tabBlocked?: boolean; objectUrlThrows?: boolean } = {}) {
  const log: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let onLoad: (() => void) | null = null;
  const frame: PrintFrame = {
    print() {
      if (opts.printThrows) throw new Error("cannot print a PDF frame");
      log.push("print");
    },
    remove() {
      log.push("frame removed");
    },
  };
  const env: PrintEnv = {
    createObjectURL() {
      if (opts.objectUrlThrows) throw new Error("no url");
      log.push("url made");
      return "blob:x";
    },
    revokeObjectURL() {
      log.push("url revoked");
    },
    addFrame(_url, load) {
      if (opts.frameThrows) throw new Error("no frame");
      onLoad = load;
      log.push("frame added");
      return frame;
    },
    openTab() {
      log.push(opts.tabBlocked ? "tab blocked" : "tab opened");
      return !opts.tabBlocked;
    },
    later(fn, ms) {
      timers.push({ fn, ms });
    },
  };
  return { env, log, timers, load: () => onLoad?.(), runTimer: (ms: number) => timers.filter((t) => t.ms === ms).forEach((t) => t.fn()) };
}

describe("printing the PDF", () => {
  it("opens the print dialog once the PDF has loaded in a hidden frame, and tidies up later", async () => {
    const t = fakeEnv();
    const done = printPledgePdf(PDF, t.env);
    t.load();
    expect(await done).toEqual({ ok: true, via: "dialog" });
    expect(t.log).toEqual(["url made", "frame added", "print"]);
    t.runTimer(FRAME_KEEP_MS);
    expect(t.log.slice(-2)).toEqual(["frame removed", "url revoked"]);
  });

  it("opens the PDF in a new tab when a browser will not print a frame", async () => {
    const t = fakeEnv({ printThrows: true });
    const done = printPledgePdf(PDF, t.env);
    t.load();
    expect(await done).toEqual({ ok: true, via: "tab" });
    expect(t.log).toContain("tab opened");
    expect(t.log).toContain("frame removed");
  });

  it("opens the tab when the frame never loads, and when there is no frame at all", async () => {
    const slow = fakeEnv();
    const done = printPledgePdf(PDF, slow.env);
    slow.runTimer(FRAME_WAIT_MS);
    expect(await done).toEqual({ ok: true, via: "tab" });
    const none = fakeEnv({ frameThrows: true });
    expect(await printPledgePdf(PDF, none.env)).toEqual({ ok: true, via: "tab" });
  });

  it("says so, in plain English, when the browser blocks the new window too", async () => {
    const t = fakeEnv({ printThrows: true, tabBlocked: true });
    const done = printPledgePdf(PDF, t.env);
    t.load();
    const r = await done;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Could not open the pledge to print it — your browser blocked the new window. Allow pop-ups for this site, then try again.");
    t.runTimer(0);
    expect(t.log).toContain("url revoked");
  });

  it("says so when the browser cannot even open the PDF", async () => {
    const t = fakeEnv({ objectUrlThrows: true });
    expect(await printPledgePdf(PDF, t.env)).toEqual({ ok: false, error: "Could not print the pledge — the browser could not open the PDF. Try again." });
  });

  it("settles once: a late load after the tab opened does not print again", async () => {
    const t = fakeEnv();
    const done = printPledgePdf(PDF, t.env);
    t.runTimer(FRAME_WAIT_MS);
    await done;
    t.load();
    expect(t.log.filter((l) => l === "print")).toHaveLength(0);
  });
});
