// The member app's way into the demo (docs/MEMBER_APP_DEMO.md): two HTTP endpoints that say what the portal's /demo page says, as JSON.
//   GET  /api/demo/choices   the demo people to choose from (app.demo_choices(): never an address, never an id of a real thing)
//   POST /api/demo/session   the same start as the portal's page (start.ts), but the Auth session is RETURNED instead of set as a cookie
// Pure shaping, wording, status codes and CORS live here so they can be tested without a server; the route files are thin.

import { memberAppUrl, publicSiteDomain } from "@/lib/site";

import { isUuid, refusalMessage, type DemoChoices, type StartFailCode } from "./rules";
import type { StartResult } from "./start";

// ── Who may call from a browser (CORS) ──────────────────────────────────────
/** What a browser-run Expo app on a developer's machine uses; never allowed in production. */
export const DEV_ORIGINS: readonly string[] = ["http://localhost:8081", "http://localhost:19006", "http://127.0.0.1:8081"];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The origins whose pages may read an answer: the member web app (https://app.<domain>, or the address MEMBER_APP_URL names when it
 * is another one) and, outside production, the local Expo ones. React Native sends no Origin at all and is not affected.
 */
export function allowedOrigins(production: boolean = process.env.NODE_ENV === "production", domain: string = publicSiteDomain()): string[] {
  const out = new Set<string>([`https://app.${domain}`]);
  const configured = originOf(memberAppUrl(undefined, domain));
  if (configured) out.add(configured);
  if (!production) for (const o of DEV_ORIGINS) out.add(o);
  return [...out];
}

/**
 * The headers of every answer: never cached, and (for a page on an allowed origin only) the CORS headers. No credentials: the endpoints
 * use no cookie and ask for none. Any other origin gets none of them, so the browser refuses to hand it the answer.
 */
export function answerHeaders(origin: string | null, allowed: readonly string[] = allowedOrigins()): Record<string, string> {
  const base: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    return {
      ...base,
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    };
  }
  return base;
}

export type AppReply = { status: number; body: Record<string, unknown> };

/** A JSON answer. A plain Response on purpose: nothing here can set a cookie. */
export function jsonReply(origin: string | null, reply: AppReply): Response {
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { ...answerHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });
}

/** The answer to a preflight: 204 with the CORS headers for an allowed origin, 204 without them for any other (the browser then refuses). */
export function preflightReply(origin: string | null): Response {
  return new Response(null, { status: 204, headers: answerHeaders(origin) });
}

/** True when a request that names an origin comes from one that may call (a request with no Origin header, such as the app's, always may). */
export function originAllowed(origin: string | null, allowed: readonly string[] = allowedOrigins()): boolean {
  return origin === null || allowed.includes(origin);
}

// ── GET /api/demo/choices ───────────────────────────────────────────────────
const LISTING = "Could not load the demo";

export const OFF_MESSAGE = "The demo is switched off right now. Please try again later.";
export const NOT_READY_MESSAGE = "The demo is not ready yet. It has not been set up. Please try again later.";

/** What /demo shows, as JSON. The list is left out when the demo is off, as the page leaves it out. */
export function choicesReply(loaded: { ok: true; choices: DemoChoices } | { ok: false; error: string }): AppReply {
  // The technical reason was logged where the list was read; the app is told in plain words.
  if (!loaded.ok) return { status: 503, body: { ok: false, error: `${LISTING} — the list of demo people could not be loaded. Please try again in a minute.`, code: "failed" } };
  const { enabled, communities } = loaded.choices;
  if (!enabled) return { status: 200, body: { ok: true, enabled: false, communities: [], message: OFF_MESSAGE } };
  if (communities.length === 0) return { status: 200, body: { ok: true, enabled: true, communities: [], message: NOT_READY_MESSAGE } };
  return { status: 200, body: { ok: true, enabled: true, communities } };
}

// ── POST /api/demo/session ──────────────────────────────────────────────────
const DOING = "Could not start the demo";
const STATUS: Record<StartFailCode, number> = { off: 503, limit: 429, unknown_person: 404, failed: 500 };

const refused = (code: StartFailCode, error: string, status: number = STATUS[code]): AppReply => ({ status, body: { ok: false, error, code } });

export type AppSessionDeps = {
  /** app.demo_choices(), parsed (loadDemoChoices). */
  loadChoices(): Promise<{ ok: true; choices: DemoChoices } | { ok: false; error: string }>;
  /** The shared start (startDemoForApp): the core with a sign-in that keeps nothing. */
  start(personaId: string, ip: string | null): Promise<{
    result: StartResult;
    session: { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: "bearer" } | null;
  }>;
};

/** The wording for a request this endpoint cannot read (not JSON, not an object, too big). */
export const UNREADABLE_REQUEST = `${DOING} — the request was not understood. Send JSON like {"persona": "<id from the list of people>"}.`;
/** The wording for a page on an origin that may not call. */
export const FOREIGN_ORIGIN = `${DOING} — this address is not allowed to start a demo.`;

/** An ISO time for the end of the session, whatever form the database used; the database's own text if it cannot be read as a time. */
function isoTime(v: string): string {
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? v : t.toISOString();
}

/**
 * The whole of POST /api/demo/session after the body is read: check the request, check the person is on the list the app was shown,
 * start through the shared core, and shape the answer. The database stays the authority (the switch, the person, the limits); the list
 * check here only gives the community's name and keeps a made-up id from ever using up a start.
 */
export async function sessionReply(body: unknown, ip: string | null, deps: AppSessionDeps): Promise<AppReply> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return refused("failed", UNREADABLE_REQUEST, 400);
  const persona = (body as { persona?: unknown }).persona;
  if (!isUuid(persona)) return refused("unknown_person", `${DOING} — choose a person to explore as first.`, 400);

  const loaded = await deps.loadChoices();
  if (!loaded.ok) return refused("failed", `${DOING} — the list of demo people could not be loaded. Please try again in a minute.`, 503);
  if (!loaded.choices.enabled) return refused("off", `${DOING} — ${refusalMessage("off")}`);
  const wanted = persona.toLowerCase();
  const community = loaded.choices.communities.find((c) => c.people.some((p) => p.id.toLowerCase() === wanted));
  const person = community?.people.find((p) => p.id.toLowerCase() === wanted);
  if (!community || !person) return refused("unknown_person", `${DOING} — ${refusalMessage("unknown_persona")}`);

  const { result, session } = await deps.start(wanted, ip);
  if (!result.ok) return refused(result.code, result.error);
  if (!session) {
    console.error("[demo] a start succeeded but no session was kept to hand over");
    return refused("failed", `${DOING} — the demo sign-in did not work. Please try again in a minute. If it keeps happening, tell the Weaver team.`);
  }
  return {
    status: 200,
    body: {
      ok: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: "bearer",
      },
      // The role is said as the list said it (the main adult is "Community member · Adult"), so the app shows one thing everywhere.
      demo: { ends_at: isoTime(result.data.expiresAt), role: person.role || result.data.role, name: result.data.name, community: community.name },
    },
  };
}
