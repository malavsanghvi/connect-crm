import { NextResponse, type NextRequest } from "next/server";

import { readPublicEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16: `middleware` is now `proxy` (Node.js runtime).
export async function proxy(request: NextRequest) {
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
