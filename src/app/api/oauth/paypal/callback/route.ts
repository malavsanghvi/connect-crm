import { type NextRequest } from "next/server";

import { finishConnect } from "@/lib/payments/connect-callback";

// "Connect with PayPal" sends the merchant back here with our ?state and PayPal's
// merchantIdInPayPal (and permissionsGranted). The merchant id is checked with
// PayPal by the background service (oauth.exchange) before it counts.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const denied = q.get("permissionsGranted") === "false" ? "PayPal says the permissions were not granted." : null;
  return finishConnect(req, "paypal", q.get("state"), q.get("merchantIdInPayPal"), denied);
}
