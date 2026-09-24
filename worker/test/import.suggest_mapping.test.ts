import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NotConfiguredError } from "../src/errors";
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
beforeAll(async () => {
  server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      lastBody = JSON.parse(b);
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
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
    expect(lastBody?.model).toBe("claude-opus-5");
    expect(JSON.stringify(lastBody)).toContain("1987-••-••");
    expect((lastBody?.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect(res.suggestions).toEqual([
      { header: "DOB", field: "date_of_birth", confidence: 0.97, reason: "Dates of birth." },
      { header: "Senior status", field: null, confidence: 0.2, reason: "No matching field." },
    ]);
  });

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
