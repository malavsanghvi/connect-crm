// Starting a demo session (B88 part 2), with every outside call passed in so it can be tested with fakes. The order matters:
//   1. the database decides (switch, person, limits) and, if it agrees, records the session and hands over that demo person's sign-in
//   2. the demo person's previous demo session, if the visitor has one, is ended (switching role)
//   3. the portal signs in with it (Supabase Auth, the password grant) and the session cookie is set
//   4. the database ties the new Auth session to the demo session (so it can end it and refuse its refresh)
// The password never leaves the server; a failure at any step ends in a plain sentence next to what the visitor did, and the real
// reason is logged.

import { failure, type ActionResult } from "@/lib/errors";

import { isDemoEmail, isUuid, parseBegin, refusalMessage, sessionIdFromAccessToken } from "./rules";

export type StartDeps = {
  /** A hash of the visitor's address (never the address itself). */
  hashIp(ip: string | null): string;
  /** app.worker_demo_begin(persona, ip hash): the raw answer. */
  begin(personaId: string, ipHash: string): Promise<unknown>;
  /** Ends the visitor's current demo session, if they have one. Best effort: a failure is logged by the caller, never fatal. */
  endPrevious(): Promise<void>;
  /** Signs in with the demo person's own sign-in and sets the session cookie. */
  signIn(email: string, password: string): Promise<{ ok: true; accessToken: string } | { ok: false; detail: unknown }>;
  /** Forgets the session just set (used when the last step fails). */
  signOut(): Promise<void>;
  /** app.worker_demo_attach(demo session, Auth session): the raw answer. */
  attach(demoSessionId: string, authSessionId: string | null): Promise<unknown>;
};

const DOING = "Could not start the demo";

export async function startDemoSession(
  input: { personaId: unknown; ip: string | null },
  deps: StartDeps,
): Promise<ActionResult<{ centerSlug: string; expiresAt: string }>> {
  if (!isUuid(input.personaId)) return { ok: false, error: `${DOING} — choose a person to explore as first.` };
  const persona = input.personaId.toLowerCase();

  let raw: unknown;
  try {
    raw = await deps.begin(persona, deps.hashIp(input.ip));
  } catch (error) {
    return failure(DOING, error);
  }
  const begin = parseBegin(raw);
  if (!begin) {
    console.error("[demo] the database answered with something unreadable (its keys):", raw && typeof raw === "object" ? Object.keys(raw) : typeof raw);
    return { ok: false, error: `${DOING} — the server gave an answer we could not read. Please try again in a minute.` };
  }
  if (!begin.ok) return { ok: false, error: `${DOING} — ${refusalMessage(begin.code)}` };
  // The database only ever hands over a demo person's sign-in. Refuse anything else here too, whatever the answer says.
  if (!isDemoEmail(begin.email)) {
    console.error("[demo] the database named a sign-in that is not on the demo domain; nothing was signed in");
    return { ok: false, error: `${DOING} — that is not a demo person, so nothing was signed in.` };
  }

  try {
    await deps.endPrevious();
  } catch (error) {
    console.error("[demo] could not end the previous demo session (the new one goes ahead):", error);
  }

  let signed: Awaited<ReturnType<StartDeps["signIn"]>>;
  try {
    signed = await deps.signIn(begin.email, begin.password);
  } catch (error) {
    signed = { ok: false, detail: error };
  }
  if (!signed.ok) {
    console.error("[demo] the demo sign-in did not work:", signed.detail);
    return { ok: false, error: `${DOING} — the demo sign-in did not work. Please try again in a minute. If it keeps happening, tell the Weaver team.` };
  }

  const authSessionId = sessionIdFromAccessToken(signed.accessToken);
  let attached: unknown;
  try {
    attached = await deps.attach(begin.demoSessionId, authSessionId);
  } catch (error) {
    attached = error;
  }
  const ok = !!attached && typeof attached === "object" && (attached as { ok?: unknown }).ok === true;
  if (!ok) {
    console.error("[demo] the new session could not be recorded; signing it out:", attached);
    try {
      await deps.signOut();
    } catch (error) {
      console.error("[demo] could not sign the unrecorded session out:", error);
    }
    return { ok: false, error: `${DOING} — the session could not be recorded. Nothing was started. Please try again.` };
  }
  return { ok: true, data: { centerSlug: begin.centerSlug, expiresAt: begin.expiresAt } };
}
