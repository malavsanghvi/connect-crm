import "server-only";

import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import tls from "node:tls";

import { portalInstanceId } from "./instance";

// The portal address and the organizations' wildcard address, checked from this
// server: does the name resolve, does it answer HTTPS with a valid certificate,
// and does it reach THIS portal (the /api/tenancy/instance id). Plain lines,
// never a guess: anything that could not be checked says so.

export type Line = { label: string; ok: boolean; detail: string };
export type DomainCheck = { ok: boolean; summary: string; lines: Line[]; addresses: string[] };

const TIMEOUT = 5000;

async function resolve(host: string): Promise<{ addresses: string[]; error: string | null }> {
  try {
    const all = await dns.lookup(host, { all: true, verbatim: true });
    return { addresses: [...new Set(all.map((a) => a.address))], error: null };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { addresses: [], error: code === "ENOTFOUND" || code === "ENODATA" ? "no DNS record found" : `DNS lookup failed (${code ?? (err instanceof Error ? err.message : String(err))})` };
  }
}

function certificate(host: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolveP) => {
    let done = false;
    const finish = (r: { ok: boolean; detail: string }) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveP(r);
    };
    const socket = tls.connect({ host, port: 443, servername: host === "localhost" ? undefined : host, rejectUnauthorized: false, timeout: TIMEOUT }, () => {
      const cert = socket.getPeerCertificate();
      const until = cert?.valid_to ? new Date(cert.valid_to) : null;
      const issuer = cert?.issuer ? String((cert.issuer as unknown as Record<string, unknown>).O ?? (cert.issuer as unknown as Record<string, unknown>).CN ?? "") : "";
      if (socket.authorized) {
        finish({ ok: true, detail: `valid${issuer ? `, issued by ${issuer}` : ""}${until ? `, until ${until.toUTCString()}` : ""}` });
      } else {
        finish({ ok: false, detail: `the certificate is not trusted (${String(socket.authorizationError ?? "unknown reason")})` });
      }
    });
    socket.on("timeout", () => finish({ ok: false, detail: "no answer on port 443 within 5 seconds" }));
    socket.on("error", (err: NodeJS.ErrnoException) =>
      finish({ ok: false, detail: err.code === "ECONNREFUSED" ? "nothing answers on port 443 (HTTPS is not set up on the server yet)" : `HTTPS failed (${err.code ?? err.message})` }));
  });
}

async function reachesThisPortal(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status >= 300 && res.status < 400) return { ok: false, detail: `answers with a redirect (${res.status}) instead of the portal` };
    const body = (await res.json().catch(() => null)) as { instance?: string } | null;
    if (body?.instance === portalInstanceId()) return { ok: true, detail: "reaches this portal" };
    return { ok: false, detail: body?.instance ? "reaches a different Community Connect server" : `answers, but not as this portal (HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, detail: `could not reach it (${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)})` };
  }
}

export async function checkPortalDomain(domain: string): Promise<DomainCheck> {
  const lines: Line[] = [];
  const dnsRes = await resolve(domain);
  lines.push({ label: `DNS for ${domain}`, ok: dnsRes.addresses.length > 0, detail: dnsRes.error ?? `points at ${dnsRes.addresses.join(", ")}` });
  if (dnsRes.addresses.length === 0) return { ok: false, summary: `${domain} has no DNS record yet. Add the A record below at your DNS provider.`, lines, addresses: [] };
  const cert = await certificate(domain);
  lines.push({ label: "HTTPS certificate", ok: cert.ok, detail: cert.detail });
  const reach = await reachesThisPortal(`${cert.ok ? "https" : "http"}://${domain}/api/tenancy/instance`);
  lines.push({ label: cert.ok ? "Over HTTPS" : "Over plain HTTP", ok: reach.ok && cert.ok, detail: reach.detail });
  const ok = lines.every((l) => l.ok);
  const summary = ok
    ? `https://${domain} is live with a valid certificate and reaches this portal.`
    : !cert.ok
      ? `${domain} resolves, but HTTPS is not working yet: ${cert.detail}.`
      : `HTTPS works, but ${domain} ${reach.detail}.`;
  return { ok, summary, lines, addresses: dnsRes.addresses };
}

/** The wildcard record (a random name must resolve) and one real organization's HTTPS address. */
export async function checkWildcardDomain(base: string, sampleSlug: string): Promise<DomainCheck> {
  const lines: Line[] = [];
  const probe = `cc-check-${randomBytes(4).toString("hex")}.${base}`;
  const any = await resolve(probe);
  lines.push({ label: `Wildcard DNS (*.${base})`, ok: any.addresses.length > 0, detail: any.error ?? `any name under ${base} points at ${any.addresses.join(", ")}` });
  if (any.addresses.length === 0) return { ok: false, summary: `*.${base} has no DNS record yet. Add the wildcard A record below.`, lines, addresses: [] };
  const host = `${sampleSlug}.${base}`;
  const cert = await certificate(host);
  lines.push({ label: `HTTPS for ${host}`, ok: cert.ok, detail: cert.ok ? `${cert.detail} (issued on demand)` : cert.detail });
  const reach = await reachesThisPortal(`${cert.ok ? "https" : "http"}://${host}/api/tenancy/instance`);
  lines.push({ label: `${host} reaches this portal`, ok: reach.ok && cert.ok, detail: reach.detail });
  const ok = lines.every((l) => l.ok);
  return {
    ok,
    summary: ok ? `Organization addresses work: https://${host} has a certificate and reaches this portal.` : `Not working yet: ${lines.filter((l) => !l.ok).map((l) => `${l.label} — ${l.detail}`).join("; ")}.`,
    lines, addresses: any.addresses,
  };
}
