import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { originFor, portalPublicUrl, resetPortalUrlCache } from "../src/portal-url";
import { captureLog, fakeDb } from "./helpers";

const status = (confirmed: boolean) => ({ version: 1, names: [{ name: "crm.cc.test", confirmed }] });

describe("portal address for links (o-https)", () => {
  beforeEach(() => resetPortalUrlCache());

  it("https only once the droplet confirmed the certificate", () => {
    expect(originFor("crm.cc.test", status(true))).toBe("https://crm.cc.test");
    expect(originFor("crm.cc.test", status(false))).toBe("http://crm.cc.test");
    expect(originFor("crm.cc.test", null)).toBe("http://crm.cc.test");
  });

  it("PORTAL_PUBLIC_URL wins and needs no database", async () => {
    const { db, calls } = fakeDb();
    const { log } = captureLog();
    expect(await portalPublicUrl({ db, log, env: { PORTAL_PUBLIC_URL: "https://portal.test/" } })).toBe("https://portal.test");
    expect(calls).toEqual([]);
  });

  it("otherwise the domain saved in Platform setup, with the droplet's HTTPS status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-https-"));
    const file = join(dir, "https-status.json");
    writeFileSync(file, JSON.stringify(status(true)));
    const { db } = fakeDb({ query: () => [{ a: { portal_domain: "crm.cc.test" } }] });
    const { log } = captureLog();
    expect(await portalPublicUrl({ db, log, env: { HTTPS_STATUS_FILE: file } })).toBe("https://crm.cc.test");
  });

  it("nothing saved: null (links stay relative, as before)", async () => {
    const { db } = fakeDb({ query: () => [{ a: { portal_domain: null } }] });
    const { log } = captureLog();
    expect(await portalPublicUrl({ db, log, env: {} })).toBeNull();
  });

  it("a database error is logged and gives null", async () => {
    const { db } = fakeDb({ query: () => { throw new Error("function missing"); } });
    const { log, lines } = captureLog();
    expect(await portalPublicUrl({ db, log, env: {} })).toBeNull();
    expect(lines.some((l) => l.level === "error" && String(l.error).includes("function missing"))).toBe(true);
  });
});
