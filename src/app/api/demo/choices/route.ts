import { choicesReply, jsonReply, preflightReply } from "@/lib/demo-signin/app-api";
import { loadDemoChoices } from "@/lib/demo-signin/server";

// GET /api/demo/choices: the demo people to choose from, for the member app's "Try the demo" (docs/MEMBER_APP_DEMO.md). The same list the
// portal's /demo page shows (app.demo_choices(): a role, a name and a sentence each; never an address). Public; it uses no cookie.
export const dynamic = "force-dynamic";

export function OPTIONS(req: Request) {
  return preflightReply(req.headers.get("origin"));
}

export async function GET(req: Request) {
  return jsonReply(req.headers.get("origin"), choicesReply(await loadDemoChoices()));
}
