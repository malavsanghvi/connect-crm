import { NextResponse, type NextRequest } from "next/server";

import { readPublicEnv } from "@/lib/env";
import { requestIsHttps } from "@/lib/https";
import { SITE_NOT_FOUND_HTML, siteRoute } from "@/lib/site";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: `middleware` is now `proxy` (Node.js runtime).
export async function proxy(request: NextRequest) {
  // The public website (www.weaverams.org) is served without a session or any database call; its
  // routing rules are in src/lib/site.ts. Every other host is the portal.
  const site = siteRoute({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    https: requestIsHttps(request.headers.get("x-forwarded-proto")),
  });
  if (site.kind === "redirect") return NextResponse.redirect(site.location, 308);
  if (site.kind === "not-found") return new NextResponse(SITE_NOT_FOUND_HTML, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  // The website's pages ("/" and "/pricing") are mapped to /site by the host rewrites in next.config.ts, not here.
  if (site.kind === "pass") return NextResponse.next();

  const check = readPublicEnv();
  // Without configuration there is no session to refresh; pages render the
  // setup screen that names the missing variables.
  if (!check.ok) return NextResponse.next();
  return updateSession(request, check.env);
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)",
  ],
};
