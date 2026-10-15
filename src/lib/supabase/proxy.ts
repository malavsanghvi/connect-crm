import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import { CENTER_COOKIE_NAME, authCookieNames, endedRedirect, guardDemoSession, isDemoApiPath } from "@/lib/demo-signin/guard";
import type { PublicEnv } from "@/lib/env";
import { requestIsHttps } from "@/lib/https";
import { PATHNAME_HEADER, clientScreen, newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { normalizeBaseDomain, sharedCookieDomain } from "@/lib/tenancy";

/** Paths reachable without a session (sign-in, the public community dashboard /c/<slug>, staff invitation links, the TLS check /api/tenancy/tls-ask, the public access request and sandbox-code redemption, the public website pages /site, and the signed Auth hooks, provider webhooks and unsubscribe links). Everything else redirects to /login. */
export const PUBLIC_PATHS = [
  "/login", "/c", "/invite", "/api/tenancy",
  // The public website's pages (www.<domain> serves them at / and /pricing; see src/lib/site.ts).
  "/site",
  // o-platform: the public access request and sandbox-code redemption.
  "/request-access", "/start",
  // "Try the demo" (B88): choose a demo person and start. It starts a session itself, so it needs no sign-in first.
  "/demo",
  // The member app's "Try the demo" (GET /api/demo/choices, POST /api/demo/session): called without a session; they answer their own CORS.
  "/api/demo",
  // o-messaging: Supabase Auth hooks, provider webhooks and email unsubscribe links (each checks its own signature).
  "/api/auth-hooks", "/api/webhooks", "/api/messaging/unsubscribe",
  // o-payments: checkout intents and the provider return page (each checks its own session or signature).
  "/api/payments",
  // Niva for admins: its routes check the signed-in person themselves and answer 401 as JSON (a redirect to the sign-in page would break the chat).
  "/api/assistant",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and performs an
 * optimistic sign-in redirect. This is a convenience only: every page and
 * Server Action re-checks the session, and the database enforces RLS.
 */
export async function updateSession(request: NextRequest, env: PublicEnv): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  // The member app's demo endpoints use no cookie: never read, refresh, redirect or clear one for them (see isDemoApiPath).
  if (isDemoApiPath(pathname)) return NextResponse.next();
  // Pass the pathname to server components and actions (x-client-screen on
  // their Supabase requests). Always overwritten here, never trusted from the client.
  const passThrough = () => {
    const forwarded = new Headers(request.headers);
    forwarded.set(PATHNAME_HEADER, clientScreen(pathname) ?? "/");
    return NextResponse.next({ request: { headers: forwarded } });
  };
  let response = passThrough();

  const supabase = createServerClient<Database, "app">(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: "app" },
    global: { headers: traceHeaders({ requestId: newRequestId(), screen: pathname }) },
    // o-https: Secure session cookies whenever the request came over HTTPS (Caddy sets X-Forwarded-Proto).
    cookieOptions: {
      domain: sharedCookieDomain(request.headers.get("host"), normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN)),
      secure: requestIsHttps(request.headers.get("x-forwarded-proto")),
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = passThrough();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims() validates the JWT (and refreshes an expiring session through setAll).
  const { data, error } = await supabase.auth.getClaims();
  if (error && error.name !== "AuthSessionMissingError") {
    console.error("[proxy] could not validate the session:", error.message);
  }
  const signedIn = Boolean(data?.claims?.sub);

  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    // Keep any refreshed auth cookies on the redirect.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  // "Try the demo": a demo session is let through only while the database says it is ok (two hours, the platform switch on). The
  // check is one call as the demo person, and only for demo addresses. When it ends, the session cookie is cleared and the person is
  // sent to the demo page (the database does the same on its side: the Auth session is deleted, so it cannot be refreshed either).
  // The demo page itself is never redirected, so a person can start again from it.
  if (signedIn) {
    const demo = await guardDemoSession(data?.claims, async () => {
      const { data: state, error: stateError } = await supabase.rpc("demo_session_state");
      if (stateError) throw stateError;
      return state;
    });
    const where = demo.kind === "ended" ? endedRedirect(pathname, demo.reason) : null;
    if (demo.kind === "ended" && where && where.kind !== "stay") {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (signOutError) {
        console.error("[proxy] could not sign the ended demo session out (its cookies are cleared anyway):", signOutError);
      }
      let out: NextResponse;
      if (where.kind === "api") {
        out = NextResponse.json({ error: "Your demo session has ended. Start a new one at /demo." }, { status: 401 });
        for (const cookie of response.cookies.getAll()) out.cookies.set(cookie);
      } else {
        const url = request.nextUrl.clone();
        url.pathname = "/demo";
        url.search = `?ended=${demo.reason}`;
        out = redirectTo(url);
      }
      const cookieDomain = sharedCookieDomain(request.headers.get("host"), normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN));
      for (const name of authCookieNames(request.cookies.getAll().map((c) => c.name))) {
        out.cookies.set(name, "", { path: "/", maxAge: 0, ...(cookieDomain ? { domain: cookieDomain } : {}) });
      }
      out.cookies.set(CENTER_COOKIE_NAME, "", { path: "/", maxAge: 0 });
      return out;
    }
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(url);
  }
  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next.split("?")[0] : "/";
    url.search = next && next.includes("?") ? `?${next.split("?").slice(1).join("?")}` : "";
    return redirectTo(url);
  }
  return response;
}
