import { type NextRequest } from "next/server";

import { finishConnect } from "@/lib/payments/connect-callback";

// Stripe Connect sends the organization's owner back here with ?code&state (or ?error).
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const error = q.get("error") ? `${q.get("error_description") ?? q.get("error")}` : null;
  return finishConnect(req, "stripe", q.get("state"), q.get("code"), error);
}
