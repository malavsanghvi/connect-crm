// import.suggest_mapping: suggest which field each unmatched column of an
// uploaded file belongs to (ONBOARDING_PLAN Steps 3–5, "Map columns").
//
// Enqueued by app.import_request_ai_mapping (migration 0192). The payload holds
// ONLY what the portal already masked (src/lib/import/mask.ts):
//   entity, entity_label   the data type being imported
//   columns                [{ header, samples: string[] (masked), categorical }]
//   fields                 [{ key, label, type, description }] of that data type
//   run_id                 the import run (for the log line only)
// No raw cell value, no record ID, no person's name ever reaches the model.
//
// Result (app.jobs.result, read by app.import_ai_mapping_result):
//   { suggestions: [{ header, field, confidence, reason }], model }
// A person confirms every suggestion on the Map step; nothing is applied here.
//
// Needs ANTHROPIC_API_KEY on the background service (Community Connect's own
// key). Without it the job fails at once as "not configured" and the screen
// says only name-based matching ran.
//
// The Anthropic SDK (@anthropic-ai/sdk) is a dependency of the worker package
// (o-vault owns worker/package.json; see worker/README-import.md).

import Anthropic from "@anthropic-ai/sdk";

import { providerStatus, type Env, type Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "import.suggest_mapping";

export const MODEL = "claude-opus-5";

export function configured(env: Env): Readiness {
  return providerStatus(env, "anthropic");
}

type Column = { header: string; samples: string[]; categorical: boolean };
type Field = { key: string; label: string; type: string; description: string };
export type Suggestion = { header: string; field: string | null; confidence: number; reason: string };

/** The payload, checked: bounded sizes, strings only. */
export function readPayload(p: unknown): { entityLabel: string; columns: Column[]; fields: Field[] } {
  const o = (p ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  if (!Array.isArray(o.columns) || !Array.isArray(o.fields)) throw new PermanentError("import.suggest_mapping: the payload needs columns and fields.");
  const columns = o.columns.slice(0, 200).map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    return {
      header: str(x.header, 120),
      samples: Array.isArray(x.samples) ? x.samples.slice(0, 3).map((s) => str(s, 80)) : [],
      categorical: x.categorical === true,
    };
  });
  const fields = o.fields.slice(0, 100).map((f) => {
    const x = (f ?? {}) as Record<string, unknown>;
    return { key: str(x.key, 60), label: str(x.label, 120), type: str(x.type, 20), description: str(x.description, 300) };
  });
  if (columns.length === 0 || fields.length === 0) throw new PermanentError("import.suggest_mapping: nothing to map.");
  return { entityLabel: str(o.entity_label, 80) || str(o.entity, 80), columns, fields };
}

/** JSON schema for the answer (structured outputs): one entry per column. */
export function answerSchema(fieldKeys: string[]) {
  return {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            header: { type: "string" },
            field: { anyOf: [{ type: "string", enum: fieldKeys }, { type: "null" }] },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["header", "field", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["suggestions"],
    additionalProperties: false,
  } as const;
}

export function prompt(entityLabel: string, columns: Column[], fields: Field[]): string {
  return [
    `An organization is importing a spreadsheet of "${entityLabel}" into its community database.`,
    "Suggest which destination field each column below holds, or null when none fits (it will then be kept as a custom field).",
    "Sample values are masked: letters and digits are replaced with •, except for columns marked as categories.",
    "Use each destination field at most once. Only suggest a field when the header or the samples make it clear; a person reviews every suggestion.",
    "Keep each reason to one short sentence.",
    "",
    "Destination fields:",
    ...fields.map((f) => `- ${f.key}: ${f.label} (${f.type}) — ${f.description}`),
    "",
    "Columns:",
    ...columns.map((c) => `- "${c.header}"${c.categorical ? " [category]" : ""}: ${c.samples.map((s) => JSON.stringify(s)).join(", ") || "(no samples)"}`),
  ].join("\n");
}

/** Keep what the model said only where it is usable: known headers and fields, each field once, confidence 0–1. */
export function cleanSuggestions(raw: unknown, columns: Column[], fields: Field[]): Suggestion[] {
  const headers = new Set(columns.map((c) => c.header));
  const keys = new Set(fields.map((f) => f.key));
  const used = new Set<string>();
  const list = raw && typeof raw === "object" && Array.isArray((raw as { suggestions?: unknown }).suggestions) ? (raw as { suggestions: unknown[] }).suggestions : [];
  const out: Suggestion[] = [];
  for (const s of list) {
    const x = (s ?? {}) as Record<string, unknown>;
    if (typeof x.header !== "string" || !headers.has(x.header)) continue;
    let field = typeof x.field === "string" && keys.has(x.field) ? x.field : null;
    if (field && used.has(field)) field = null;
    if (field) used.add(field);
    const c = typeof x.confidence === "number" && Number.isFinite(x.confidence) ? Math.min(1, Math.max(0, x.confidence)) : 0;
    out.push({ header: x.header, field, confidence: c, reason: typeof x.reason === "string" ? x.reason.slice(0, 200) : "" });
  }
  return out;
}

export async function run(job: Job, ctx: JobContext) {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  const { entityLabel, columns, fields } = readPayload(job.payload);
  // ANTHROPIC_BASE_URL only points tests at a local mock server.
  const client = new Anthropic({ apiKey: ctx.env.ANTHROPIC_API_KEY, baseURL: ctx.env.ANTHROPIC_BASE_URL || undefined, timeout: 60_000, maxRetries: 2 });

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: answerSchema(fields.map((f) => f.key)) } },
      // A policy decline is re-run on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt(entityLabel, columns, fields) }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new NotConfiguredError("The Anthropic key on the background service was refused (ANTHROPIC_API_KEY).");
    }
    if (err instanceof Anthropic.BadRequestError) throw new PermanentError(`The mapping request was not accepted: ${err.message}`);
    throw err; // rate limits, 5xx and network errors: the queue retries
  }
  if (response.stop_reason === "refusal") throw new PermanentError("The model declined to suggest a mapping for this file.");
  if (response.stop_reason === "max_tokens") throw new PermanentError("The suggestion was cut off; map the columns by hand.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PermanentError("The suggestion could not be read; map the columns by hand.");
  }
  const suggestions = cleanSuggestions(parsed, columns, fields);
  ctx.log.info("mapping suggested", { run: (job.payload as { run_id?: string } | null)?.run_id ?? null, columns: columns.length, matched: suggestions.filter((s) => s.field).length });
  return { suggestions, model: response.model };
}
