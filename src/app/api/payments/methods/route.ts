import { NextResponse, type NextRequest } from "next/server";

import { explainError, type DbErrorLike } from "@/lib/errors";
import { parseMemberMethods } from "@/lib/payments/plugins/view";
import { tokenClient } from "@/lib/payments/server";
import { isUuid } from "@/lib/search-params";

// How the member app discovers what it may offer (docs/PAYMENTS_PLAN.md §2.7):
//   GET /api/payments/methods?center_id=<uuid>
//   Authorization: Bearer <the member's own Supabase access token>
// → app.member_payment_methods (0581) decides with the member's own session: members of the
//   community only, adults only, Giving on; one entry per connected processor; Zelle in a sandbox
//   is a rehearsal that never carries the real address.
// 200: that answer (parsed, so only the fields of the contract) plus "client": {} — hosted Checkout
//   (owner decision Q1, approach A) needs no client key in the app, so nothing is added; a secret never is.
// Errors are JSON { error } in plain English: 400 no or bad center_id, 401 not signed in,
// 403 not allowed, 503 not configured, 500 anything else. No cookies are used, so any origin may call it.
export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "600",
};
const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: { ...CORS, "cache-control": "private, no-store" } });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** A refusal raised by our own SQL is already a plain sentence ("Only an adult of the family can pay for it."). */
function refusal(error: DbErrorLike): string {
  const msg = (error.message ?? "").trim();
  if (error.code === "42501" && msg && !/permission denied|row-level security/i.test(msg)) return msg;
  return explainError(error);
}

export async function GET(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply(401, { error: "Sign in to see how to give." });
  const center = req.nextUrl.searchParams.get("center_id");
  if (!isUuid(center)) return reply(400, { error: "center_id is missing or is not a community id." });
  const db = tokenClient(token, "member", "/api/payments/methods");
  if (!db) return reply(503, { error: "Weaver is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)." });
  let data: unknown;
  let error: DbErrorLike | null;
  try {
    ({ data, error } = await db.rpc("member_payment_methods", { p_center: center }));
  } catch (err) {
    console.error("[payments/methods] member_payment_methods failed:", err);
    return reply(500, { error: "Could not load how to give — the database could not be reached. Try again." });
  }
  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42501" || /JWT|jwt/.test(msg)) return reply(403, { error: refusal(error) });
    if (error.code === "22023" || error.code === "P0001") return reply(400, { error: explainError(error) });
    console.error("[payments/methods] member_payment_methods refused:", error);
    return reply(500, { error: `Could not load how to give — ${explainError(error)}.` });
  }
  const parsed = parseMemberMethods(data);
  if (!parsed.ok) {
    console.error("[payments/methods] unexpected answer from member_payment_methods:", data);
    return reply(500, { error: `Could not load how to give — ${parsed.error}.` });
  }
  // What is sent is the parsed answer, not the raw one: only the fields the contract names, and a
  // sandbox's Zelle never carries the real address even if the database ever sent it.
  return reply(200, { ...parsed.value, client: {} });
}
