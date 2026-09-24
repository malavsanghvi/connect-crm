// HTTPS for the portal (o-https): pure helpers. The droplet side is
// deploy/caddy-sites.mjs (Caddy sites) and deploy/https-confirm.mjs, which checks
// every minute whether each name's certificate works and writes the status file
// read here (src/lib/https-server.ts). Redirects to https:// and HSTS happen only
// for names that file marks as confirmed.

export type HttpsNameState = "https_ok" | "https_failed" | "dns_elsewhere" | "dns_missing" | "not_checked";

export type HttpsName = {
  name: string;
  source: "droplet_ip" | "site_domain" | "platform_setting" | "certificate" | string;
  state: HttpsNameState | string;
  confirmed: boolean;
  reason: string;
  valid_to: string | null;
};

export type HttpsStatus = {
  version: number;
  checked_at: string;
  public_ip: string | null;
  ip_certificate: { enabled: boolean; note: string | null };
  caddy_version: string | null;
  portal_names_error: string | null;
  names: HttpsName[];
};

/** The status file as written by https-confirm.mjs; null when it is not that shape. */
export function parseHttpsStatus(raw: unknown): HttpsStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || typeof r.checked_at !== "string" || !Array.isArray(r.names)) return null;
  const ipc = (r.ip_certificate ?? {}) as Record<string, unknown>;
  const names: HttpsName[] = [];
  for (const n of r.names as unknown[]) {
    if (!n || typeof n !== "object") continue;
    const x = n as Record<string, unknown>;
    if (typeof x.name !== "string" || typeof x.state !== "string") continue;
    names.push({
      name: x.name,
      source: typeof x.source === "string" ? x.source : "certificate",
      state: x.state,
      confirmed: x.confirmed === true,
      reason: typeof x.reason === "string" ? x.reason : "",
      valid_to: typeof x.valid_to === "string" ? x.valid_to : null,
    });
  }
  return {
    version: 1,
    checked_at: r.checked_at,
    public_ip: typeof r.public_ip === "string" ? r.public_ip : null,
    ip_certificate: { enabled: ipc.enabled === true, note: typeof ipc.note === "string" ? ipc.note : null },
    caddy_version: typeof r.caddy_version === "string" ? r.caddy_version : null,
    portal_names_error: typeof r.portal_names_error === "string" ? r.portal_names_error : null,
    names,
  };
}

/** The confirmer runs every minute; older than this means it has stopped. */
export const STATUS_STALE_MS = 10 * 60_000;

export type HttpsSummary = {
  tone: "ok" | "warn" | "bad";
  headline: string;
  /** One line per name that matters: the portal domain, the droplet address, SITE_DOMAIN. */
  lines: { name: string; tone: "ok" | "warn" | "bad"; text: string }[];
  /** The owner's next step, in plain English; null when nothing is needed. */
  next: string | null;
};

type SummaryInput =
  | { ok: true; status: HttpsStatus }
  | { ok: false; reason: "missing" | "unreadable"; detail?: string };

/**
 * What Platform setup says about HTTPS. `portalDomain` is the domain saved in the
 * wizard (app.platform_settings 'portal_domain'), when there is one.
 */
export function summarizeHttps(input: SummaryInput, portalDomain: string | null, now: number = Date.now()): HttpsSummary {
  if (!input.ok) {
    return input.reason === "missing"
      ? {
          tone: "warn",
          headline: "HTTPS has not been set up on this server yet",
          lines: [],
          next: "Deploy the portal once (Actions › Deploy in connect-crm). The deploy installs the HTTPS check; its first result appears here within a minute.",
        }
      : {
          tone: "bad",
          headline: "The HTTPS status could not be read",
          lines: [],
          next: `The server's status file could not be read${input.detail ? ` (${input.detail})` : ""}. The site keeps working on http:// meanwhile.`,
        };
  }
  const s = input.status;
  const lines: HttpsSummary["lines"] = [];
  const pick = (n: HttpsName) => n.source !== "certificate" || n.name === portalDomain;
  const shown = s.names.filter(pick);
  const toneOf = (n: HttpsName): "ok" | "warn" | "bad" => (n.confirmed ? "ok" : n.state === "https_failed" ? "bad" : "warn");
  for (const n of shown) lines.push({ name: n.name, tone: toneOf(n), text: n.reason });
  if (portalDomain && !s.names.some((n) => n.name === portalDomain)) {
    lines.unshift({ name: portalDomain, tone: "warn", text: `Saved, and checked on the next run (every minute). The server has not looked at ${portalDomain} yet.` });
  }
  if (!s.ip_certificate.enabled) {
    lines.push({
      name: s.public_ip ?? "this server's address",
      tone: "warn",
      text: s.ip_certificate.note ?? "The server address has no HTTPS certificate: it stays on http:// (a domain name gets HTTPS instead).",
    });
  }
  const age = now - Date.parse(s.checked_at);
  const stale = !(age >= 0 && age < STATUS_STALE_MS);
  const portal = portalDomain ? s.names.find((n) => n.name === portalDomain) : undefined;
  const anyOk = shown.some((n) => n.confirmed);
  let tone: HttpsSummary["tone"];
  let headline: string;
  let next: string | null = null;
  if (portal?.confirmed) {
    tone = "ok";
    headline = `HTTPS works on ${portal.name}`;
  } else if (portalDomain) {
    tone = portal?.state === "https_failed" ? "bad" : "warn";
    headline = `${portalDomain} is not on HTTPS yet`;
    next = portal?.reason ?? `Point an A record for ${portalDomain} at ${s.public_ip ?? "the server"}; HTTPS starts within minutes of DNS updating, with no redeploy.`;
  } else if (anyOk) {
    tone = "ok";
    headline = `HTTPS works on ${shown.filter((n) => n.confirmed).map((n) => n.name).join(", ")}`;
    next = "Save the portal's domain name to give members an address they can remember; HTTPS for it starts by itself once its DNS points here.";
  } else {
    tone = "warn";
    headline = "The portal is on http:// only";
    next = `Save the portal's domain name, then point its A record at ${s.public_ip ?? "the server"}. HTTPS starts within minutes of DNS updating, with no redeploy.`;
  }
  if (stale) {
    tone = tone === "ok" ? "warn" : tone;
    lines.push({ name: "HTTPS check", tone: "warn", text: `The last check ran ${isNaN(age) ? "at an unknown time" : `${Math.round(age / 60_000)} minutes ago`}; it should run every minute (service connect-https-confirm on the server).` });
  }
  if (s.portal_names_error) lines.push({ name: "Saved addresses", tone: "warn", text: `The check could not read the saved addresses: ${s.portal_names_error}` });
  return { tone, headline, lines, next };
}

/** Was this request made over HTTPS (behind Caddy: X-Forwarded-Proto)? */
export function requestIsHttps(forwardedProto: string | null | undefined): boolean {
  return (forwardedProto ?? "").split(",")[0].trim().toLowerCase() === "https";
}
