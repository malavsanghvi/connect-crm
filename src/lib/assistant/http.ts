import "server-only";

import { chatMode, type ChatMode } from "@/lib/ai-gate";
import { requires2faForStaff, securityRedirect } from "@/lib/security";
import { loadSession, type CrmSession } from "@/lib/session";

import type { ChatEvent } from "./protocol";
import { ASSISTANT_MODULES_UNKNOWN, ASSISTANT_OFF, assistantEnabled, CHAT_AI_OFF, nivaForAdminsOn } from "./settings";

// What every route under /api/assistant does first: find the signed-in person (their own session, never a service account), make
// sure they work for this community, and make sure Niva for admins is switched on for it. Every refusal is a JSON answer
// { ok:false, error } in plain English with the right status; a signed-out person gets 401, not a redirect to the sign-in page
// ("/api/assistant" is in PUBLIC_PATHS, src/lib/supabase/proxy.ts, and each route checks its own session).
//
// The commands (/run, /confirm, /reject) use no model and need the community's switch only. The chat (/chat) calls the AI
// provider from here, so it also needs iWeaver (0755; `chat` says what it may do, src/lib/ai-gate.ts chatMode), and
// app.assistant_usage_check checks the same again in the database before every model call.

const NO_STORE = { "cache-control": "no-store" };

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export const fail = (status: number, error: string): Response => json(status, { ok: false, error });

export type Authorized = { ok: true; session: CrmSession; enabled: boolean; chat: ChatMode } | { ok: false; response: Response };

/** A POST from another website must not act as the signed-in person: the browser names the page it came from. */
export function sameOrigin(headers: Pick<Headers, "get">): boolean {
  const origin = headers.get("origin");
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const mine = [headers.get("x-forwarded-host"), headers.get("host")].filter((h): h is string => !!h).map((h) => h.split(",")[0].trim().toLowerCase());
  return mine.includes(host);
}

export type GateOptions = {
  /** A POST with a JSON body: checked for the page it came from and its content type. */
  post: boolean;
  /** Answer 403 when the community has not switched Niva for admins on. /commands says so in its own answer instead. */
  needsEnabled: boolean;
  /** The chat: answer 403 when iWeaver is off and the community is not onboarding (the route checks the onboarding page itself). */
  needsChat?: boolean;
};

export async function authorizeAssistant(req: Pick<Request, "headers">, gate: GateOptions): Promise<Authorized> {
  if (gate.post) {
    if (!sameOrigin(req.headers)) return { ok: false, response: fail(403, "This request did not come from the Weaver page you are signed in on, so it was not done. Reload the page and try again.") };
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return { ok: false, response: fail(415, "Niva could not read that request. Reload the page and try again.") };
  }
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, response: fail(401, "Your session has ended. Sign in again to use Niva.") };
  if (state.status !== "ok") {
    console.error(`[assistant] no session for the request: ${state.status}${"message" in state ? ` — ${state.message}` : ""}`);
    return { ok: false, response: fail(503, "Niva could not load your sign-in. Reload the page and try again.") };
  }
  const { session } = state;
  const isStaff = session.grants.length > 0 || session.isOwner || session.isPlatformAdmin;
  if (!isStaff) return { ok: false, response: fail(403, "Niva for admins is for the people who run the community. You don't have access to this area.") };
  // Staff of a community that asks for 2FA use Niva only after passing it, like the rest of the portal.
  if (securityRedirect({ requires: requires2faForStaff(session.center.rules), isStaff, aal: session.aal, pathname: "/" })) {
    return { ok: false, response: fail(403, "Finish your security check first (Account › Security), then use Niva.") };
  }
  // The community's switch, with its modules read (the commands); the chat needs iWeaver as well (0755).
  const enabled = nivaForAdminsOn(session.center.rules, session);
  if ((gate.needsEnabled || gate.needsChat) && !enabled) {
    if (!assistantEnabled(session.center.rules)) return { ok: false, response: fail(403, ASSISTANT_OFF) };
    console.error(`[assistant] the community's modules could not be read (${session.modulesStatus}); Niva for admins stays off`);
    return { ok: false, response: fail(503, ASSISTANT_MODULES_UNKNOWN) };
  }
  const chat = enabled ? chatMode(session) : "off";
  if (gate.needsChat && chat === "off") return { ok: false, response: fail(403, CHAT_AI_OFF) };
  return { ok: true, session, enabled, chat };
}

/** The JSON body of a POST, or the 400 answer. */
export async function readJson(req: Pick<Request, "json">): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return { ok: true, body: body as Record<string, unknown> };
  } catch {
    // fall through to the answer below
  }
  return { ok: false, response: fail(400, "Niva could not read that request. Reload the page and try again.") };
}

/** One JSON object per line, as the chat produces them. Stops asking the chat for more when the person goes away. */
export function ndjson(events: AsyncGenerator<ChatEvent>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (error) {
        console.error("[assistant] the chat stream failed:", error);
        controller.error(error);
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
  });
}
