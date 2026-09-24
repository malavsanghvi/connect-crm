import { NextResponse } from "next/server";

import { portalInstanceId } from "@/lib/platform-setup/instance";

// Public (under /api/tenancy): the platform setup wizard's "does this address
// reach this server?" check. Answers a per-process random id and nothing else.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ instance: portalInstanceId() }, { headers: { "cache-control": "no-store" } });
}
