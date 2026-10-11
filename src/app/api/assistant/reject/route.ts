import { authorizeAssistant, fail, json, readJson } from "@/lib/assistant/http";
import { createCommandContext } from "@/lib/commands/context";
import { rejectProposal } from "@/lib/commands/run";

// POST /api/assistant/reject { proposalId }: the person said no to a confirmation card. Nothing was done; the request cannot be
// used any more. Answers { ok: true } or { ok: false, error }.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authorizeAssistant(req, { post: true, needsEnabled: true });
  if (!auth.ok) return auth.response;
  const read = await readJson(req);
  if (!read.ok) return read.response;
  const { proposalId } = read.body;
  if (typeof proposalId !== "string" || !proposalId.trim() || proposalId.length > 100) return fail(400, "That request is incomplete. Nothing was changed.");

  try {
    const ctx = await createCommandContext(auth.session, "assistant");
    return json(200, await rejectProposal(ctx, proposalId.trim()));
  } catch (error) {
    console.error("[assistant] reject failed unexpectedly:", error);
    return fail(500, "Something went wrong inside Niva. Nothing was changed.");
  }
}
