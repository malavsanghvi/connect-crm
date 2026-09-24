import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/lib/database.types";
import type { PublicEnv } from "@/lib/env";
import { PATHNAME_HEADER, clientScreen, newRequestId, traceHeaders } from "@/lib/supabase/trace";
import { normalizeBaseDomain, sharedCookieDomain } from "@/lib/tenancy";

/** Paths reachable without a session (sign-in, the public community dashboard /c/<slug>, staff invitation links, the TLS check /api/tenancy/tls-ask). Everything else redirects to /login. */
export const PUBLIC_PATHS = ["/login", "/c", "/invite", "/api/tenancy", "/api/webhooks", "/api/payments"];

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
    cookieOptions: { domain: sharedCookieDomain(request.headers.get("host"), normalizeBaseDomain(process.env.PORTAL_BASE_DOMAIN)) },
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
