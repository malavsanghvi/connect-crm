// messaging.domain_verify: add a sending domain at the email provider and read
// back its DNS records (action "create"), or ask the provider to check the DNS
// again (action "verify"). With no domain_id it is the re-verify sweep the
// worker queues every 15 minutes: every pending domain (and each verified one
// once a day, since DNS can break) is checked.

import { providerStatus, type Env, type Readiness } from "../config";
import { NotConfiguredError, PermanentError, messageOf } from "../errors";
import { reqFrom } from "../messaging";
import { MissingConfigError, ProviderError, createDomain, verifyDomain, type DomainState } from "../../../src/lib/messaging/providers";
import type { Job, JobContext } from "../types";

export const kind = "messaging.domain_verify";

export function configured(env: Env): Readiness {
  return providerStatus(env, "email");
}

type Domain = { id: string; domain: string; provider: "resend" | "postmark"; provider_domain_id: string | null; status: string };

async function one(ctx: JobContext, id: string, action: string): Promise<Record<string, unknown>> {
  const d = (await ctx.db.query<{ d: Domain | null }>("select app.worker_email_domain($1) as d", [id]))[0]?.d;
  if (!d) return { domain_id: id, skipped: "not found" };
  const req = reqFrom(ctx.http);
  let state: DomainState;
  try {
    state = action === "create" || !d.provider_domain_id
      ? await createDomain(req, ctx.env, d.provider, d.domain)
      : await verifyDomain(req, ctx.env, d.provider, d.provider_domain_id, d.domain);
  } catch (err) {
    if (err instanceof MissingConfigError) throw new NotConfiguredError(err.message);
    if (err instanceof ProviderError && err.permanent) {
      await ctx.db.query("select app.worker_email_domain_result($1, $2, $3, $4, $5)", [id, null, null, "failed", messageOf(err)]);
      throw new PermanentError(messageOf(err));
    }
    throw err;
  }
  await ctx.db.query("select app.worker_email_domain_result($1, $2, $3, $4, $5)", [
    id, state.providerDomainId || null, JSON.stringify(state.records), state.status,
    state.status === "verified" ? null : "The DNS records are not all in place yet",
  ]);
  return { domain_id: id, domain: d.domain, status: state.status, records: state.records.length };
}

export async function run(job: Job, ctx: JobContext) {
  const p = job.payload ?? {};
  if (typeof p.domain_id === "string") return one(ctx, p.domain_id, String(p.action ?? "verify"));
  const due = await ctx.db.query<{ id: string }>("select id from app.worker_email_domains_due($1) as id", [50]);
  const results: Record<string, unknown>[] = [];
  for (const { id } of due) {
    try {
      results.push(await one(ctx, id, "verify"));
    } catch (err) {
      if (err instanceof NotConfiguredError) throw err;
      ctx.log.error("could not check a domain", { domain_id: id, error: err });
      results.push({ domain_id: id, error: messageOf(err) });
    }
  }
  return { checked: results.length, results };
}
