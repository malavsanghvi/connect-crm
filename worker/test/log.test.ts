import { describe, expect, it } from "vitest";

import { redact, scrubText } from "../src/log";
import { captureLog } from "./helpers";

describe("logs never carry secrets", () => {
  it("redacts fields whose names look like secrets, at any depth", () => {
    const out = redact({ api_key: "sk_live_1", nested: { refresh_token: "r", ok: 1 }, list: [{ password: "p" }], code: "123", status_code: 200 }) as Record<string, unknown>;
    expect(out.api_key).toBe("[redacted]");
    expect(out.nested).toEqual({ refresh_token: "[redacted]", ok: 1 });
    expect(out.list).toEqual([{ password: "[redacted]" }]);
    expect(out.code).toBe("[redacted]");
    expect(out.status_code).toBe(200);
  });
  it("scrubs connection-string passwords and URL query strings from text", () => {
    expect(scrubText("connect postgres://connect_worker.abc:Sup3r%40pw@host:5432/postgres failed")).toBe(
      "connect postgres://connect_worker.abc:[redacted]@host:5432/postgres failed",
    );
    expect(scrubText("GET https://api.example.com/oauth?code=abc&state=x done")).toBe("GET https://api.example.com/oauth?[redacted] done");
  });
  it("writes one JSON line per entry with the base fields", () => {
    const { log, lines } = captureLog();
    log.child({ job: "7" }).error("boom", { error: new Error("at postgres://u:pw@h/db"), secret: "x" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", msg: "boom", service: "test", job: "7", secret: "[redacted]", error: { name: "Error", message: "at postgres://u:[redacted]@h/db" } });
  });
});
