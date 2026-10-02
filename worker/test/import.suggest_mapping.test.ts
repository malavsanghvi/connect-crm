import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { cleanSuggestions, prompt, run } from "../src/handlers/import.suggest_mapping";

const columns = [
  { header: "Senior status", samples: ["Yes", "No"], categorical: true },
  { header: "DOB", samples: ["1987-••-••"], categorical: false },
];
const fields = [
  { key: "date_of_birth", label: "Birth date", type: "date", description: "Decides who is a minor." },
  { key: "email", label: "Email", type: "email", description: "Main email." },
];
const payload = { entity: "people", entity_label: "People", columns, fields, run_id: "r1" };

let server: Server;
let url = "";
let lastBody: Record<string, unknown> | null = null;
/** Error answers the mock gives, in order, before it answers normally again: [status, error.type, message]. */
let failures: [number, string, string][] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = JSON.parse(b);
      res.setHeader("content-type", "application/json");
      const fail = failures.shift();
      if (fail) {
        res.statusCode = fail[0];
        res.end(JSON.stringify({ type: "error", error: { type: fail[1], message: fail[2] } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: String(lastBody?.model),
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                suggestions: [
                  { header: "DOB", field: "date_of_birth", confidence: 0.97, reason: "Dates of birth." },
                  { header: "Senior status", field: null, confidence: 0.2, reason: "No matching field." },
                  { header: "Ghost", field: "email", confidence: 1, reason: "Not a column." },
                ],
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const ctx = (env: Record<string, string>) =>
  ({ env, log: { info() {}, warn() {}, error() {}, debug() {} } }) as unknown as Parameters<typeof run>[1];
const job = { id: 1, payload, attempts: 1 } as unknown as Parameters<typeof run>[0];

describe("import.suggest_mapping", () => {
  it("says honestly that it is not configured without ANTHROPIC_API_KEY", async () => {
    await expect(run(job, ctx({}))).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it("sends headers and masked samples only, with a schema, and keeps usable suggestions", async () => {
    const res = (await run(job, ctx({ ANTHROPIC_API_KEY: "sk-test-fake", ANTHROPIC_BASE_URL: url }))) as { suggestions: unknown[] };
    expect(lastBody?.model).toBe("claude-opus-5-5");
    expect(lastBody?.fallbacks).toBe("default");
    expect(JSON.stringify(lastBody)).toContain("1987-••-••");
    expect((lastBody?.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(res.suggestions).toEqual([
      { header: "DOB", field: "date_of_birth", confidence: 0.97, reason: "Dates of birth." },
      { header: "Senior status", field: null, confidence: 0.2, reason: "No matching field." },
    ]);
  });

  it("uses the CLAUDE_MODEL override, like Niva", async () => {
    const res = (await run(job, ctx({ ANTHROPIC_API_KEY: "sk-test-fake", ANTHROPIC_BASE_URL: url, CLAUDE_MODEL: "claude-opus-5" }))) as { model: string };
    expect(lastBody?.model).toBe("claude-opus-5");
    expect(res.model).toBe("claude-opus-5");
  });

  it("says plainly what a failed call means, and retries only what can get better", async () => {
    const env = { ANTHROPIC_API_KEY: "sk-test-fake", ANTHROPIC_BASE_URL: url };
    failures = [[401, "authentication_error", "invalid x-api-key"]];
    const refused = await run(job, ctx(env)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(NotConfiguredError);
    expect((refused as Error).message).toBe("The Anthropic key on the background service was refused (ANTHROPIC_API_KEY; 401 authentication_error).");

    failures = [[400, "invalid_request_error", "You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC."]];
    const quota = await run(job, ctx(env)).catch((e: unknown) => e);
    expect(quota).toBeInstanceOf(PermanentError);
    expect((quota as Error).message).toContain("The AI service's spending limit was reached, so the mapping suggestions could not be made (400 invalid_request_error: You have reached");

    failures = [[404, "not_found_error", "model: claude-opus-5-5"]];
    const missing = await run(job, ctx(env)).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(PermanentError);
    expect((missing as Error).message).toContain("The AI model (claude-opus-5-5) is not available to this Anthropic account");

    // Busy: the SDK tries twice more itself, then the job fails retryably (a plain Error) with a readable message.
    failures = [[529, "overloaded_error", "Overloaded"], [529, "overloaded_error", "Overloaded"], [529, "overloaded_error", "Overloaded"]];
    const busy = await run(job, ctx(env)).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(Error);
    expect(busy).not.toBeInstanceOf(PermanentError);
    expect(busy).not.toBeInstanceOf(NotConfiguredError);
    expect((busy as Error).message).toBe("The AI service was busy or could not be reached (529 overloaded_error: Overloaded).");
    failures = [];
  }, 30_000);

  it("uses each field once and clamps confidence", () => {
    const out = cleanSuggestions(
      { suggestions: [{ header: "DOB", field: "email", confidence: 3, reason: "" }, { header: "Senior status", field: "email", confidence: -1, reason: "" }] },
      columns,
      fields,
    );
    expect(out.map((s) => [s.field, s.confidence])).toEqual([["email", 1], [null, 0]]);
    expect(prompt("People", columns, fields)).toContain('"Senior status" [category]');
  });
});
