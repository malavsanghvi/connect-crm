// qbo.match_suggest_ai: ask the model about the QuickBooks customers that the
// deterministic rules left ambiguous (no candidate at 0.6 or more, or the top
// two within 0.1) — o-qbo-match, ONBOARDING_WAVE_B.
//
// What leaves the database (app.qbo_worker_ai_input): the customer's names,
// city and ZIP and email DOMAINS; for each candidate household its name, city,
// ZIP, members' first names and email domains. Never a full email, a phone
// number, an amount or a note. The model only proposes: proposals are stored
// as suggestions (method "ai", confidence at most 0.85) for the treasury to
// approve or reject. Customers with no candidate household are marked checked
// without being sent.
//
// Needs ANTHROPIC_API_KEY (Community Connect's own key). Without it the job
// fails at once as "not configured" and the screen says AI suggestions are off;
// deterministic matching keeps working.

import Anthropic from "@anthropic-ai/sdk";

import { providerStatus, type Env, type Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "qbo.match_suggest_ai";
export const MODEL = "claude-opus-5";
export const MAX_CONFIDENCE = 0.85;

export function configured(env: Env): Readiness {
  return providerStatus(env, "anthropic");
}

export type Candidate = { household_id: string; name: string; city: string | null; zip: string | null; member_first_names: string[]; email_domains: string[] };
export type AiCustomer = {
  qbo_id: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  company_name: string | null;
  city: string | null;
  zip: string | null;
  email_domains: string[];
  candidates: Candidate[];
};
export type Proposal = { qbo_id: string; household_id: string | null; confidence: number; reason: string };

export function answerSchema(qboIds: string[], householdIds: string[]) {
  return {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            qbo_id: { type: "string", enum: qboIds },
            household_id: { anyOf: [{ type: "string", enum: householdIds }, { type: "null" }] },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["qbo_id", "household_id", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["matches"],
    additionalProperties: false,
  } as const;
}

export function prompt(customers: AiCustomer[]): string {
  const lines = [
    "A community organization is linking the customers in its QuickBooks company to the families (households) in its member database.",
    "For each QuickBooks customer below, say which ONE candidate household it most likely is, or null when none fits.",
    "QuickBooks names are often family-style (\"Shah Family\", \"Mr & Mrs Ketan Shah\") or one spouse's name. Emails are shown as domains only.",
    "Be conservative: a shared surname alone is weak evidence; a matching first name, city/ZIP or email domain is stronger.",
    "Give a confidence from 0 to 1 and a one-sentence reason. A person reviews every answer.",
    "",
  ];
  for (const c of customers) {
    lines.push(
      `QuickBooks customer ${c.qbo_id}: "${c.display_name}"` +
        [c.given_name || c.family_name ? `first/last: ${c.given_name ?? "?"} ${c.family_name ?? "?"}` : null, c.company_name ? `company: ${c.company_name}` : null,
          c.city || c.zip ? `where: ${[c.city, c.zip].filter(Boolean).join(" ")}` : null, c.email_domains.length ? `email domains: ${c.email_domains.join(", ")}` : null]
          .filter(Boolean)
          .map((s) => `; ${s}`)
          .join(""),
    );
    for (const h of c.candidates) {
      lines.push(
        `  - household ${h.household_id}: "${h.name}"; members: ${h.member_first_names.join(", ") || "(none)"}` +
          `${h.city || h.zip ? `; where: ${[h.city, h.zip].filter(Boolean).join(" ")}` : ""}${h.email_domains.length ? `; email domains: ${h.email_domains.join(", ")}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/** Keep only answers about customers asked, households offered to THAT customer, confidence capped. */
export function cleanProposals(raw: unknown, customers: AiCustomer[]): Proposal[] {
  const offered = new Map(customers.map((c) => [c.qbo_id, new Set(c.candidates.map((h) => h.household_id))]));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { matches?: unknown }).matches) ? (raw as { matches: unknown[] }).matches : [];
  const out: Proposal[] = [];
  const seen = new Set<string>();
  for (const m of list) {
    const x = (m ?? {}) as Record<string, unknown>;
    if (typeof x.qbo_id !== "string" || !offered.has(x.qbo_id) || seen.has(x.qbo_id)) continue;
    seen.add(x.qbo_id);
    const hh = typeof x.household_id === "string" && offered.get(x.qbo_id)!.has(x.household_id) ? x.household_id : null;
    const c = typeof x.confidence === "number" && Number.isFinite(x.confidence) ? Math.min(MAX_CONFIDENCE, Math.max(0, x.confidence)) : 0;
    out.push({ qbo_id: x.qbo_id, household_id: hh, confidence: c, reason: typeof x.reason === "string" ? x.reason.slice(0, 300) : "" });
  }
  return out;
}

export async function run(job: Job, ctx: JobContext) {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);
  if (!job.center_id) throw new PermanentError("qbo.match_suggest_ai needs an organization.");
  const rows = await ctx.db.query<{ r: AiCustomer[] | null }>("select app.qbo_worker_ai_input($1, 50) as r", [job.center_id]);
  const all = rows[0]?.r ?? [];
  const ask = all.filter((c) => c.candidates.length > 0);
  const checked = all.map((c) => c.qbo_id);
  if (ask.length === 0) {
    if (checked.length) await ctx.db.query("select app.qbo_worker_store_ai($1, '[]'::jsonb, $2, $3) as r", [job.center_id, MODEL, checked]);
    return { asked: 0, checked: checked.length, stored: 0 };
  }

  // ANTHROPIC_BASE_URL only points tests at a local mock server.
  const client = new Anthropic({ apiKey: ctx.env.ANTHROPIC_API_KEY, baseURL: ctx.env.ANTHROPIC_BASE_URL || undefined, timeout: 120_000, maxRetries: 2 });
  const householdIds = [...new Set(ask.flatMap((c) => c.candidates.map((h) => h.household_id)))];
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "low", format: { type: "json_schema", schema: answerSchema(ask.map((c) => c.qbo_id), householdIds) } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt(ask) }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new NotConfiguredError("The Anthropic key on the background service was refused (ANTHROPIC_API_KEY).");
    }
    if (err instanceof Anthropic.BadRequestError) throw new PermanentError(`The matching request was not accepted: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new PermanentError("The model declined to suggest matches; match these customers by hand.");
  if (response.stop_reason === "max_tokens") throw new PermanentError("The suggestions were cut off; match these customers by hand.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PermanentError("The suggestions could not be read; match these customers by hand.");
  }
  const proposals = cleanProposals(parsed, ask).filter((p) => p.household_id !== null);
  const stored = await ctx.db.query<{ r: number }>("select app.qbo_worker_store_ai($1, $2::jsonb, $3, $4) as r", [
    job.center_id,
    JSON.stringify(proposals),
    response.model,
    checked,
  ]);
  ctx.log.info("AI match suggestions", { asked: ask.length, proposed: proposals.length });
  return { asked: ask.length, checked: checked.length, proposed: proposals.length, stored: stored[0]?.r ?? 0, model: response.model };
}
