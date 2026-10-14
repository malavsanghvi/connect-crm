import { authorizeAssistant, fail, json, readJson } from "@/lib/assistant/http";
import { confirmResponse } from "@/lib/assistant/present";
import type { ConfirmResponse } from "@/lib/assistant/protocol";
import { recordProposals } from "@/lib/assistant/record";
import { createCommandContext } from "@/lib/commands/context";
import { defaultRegistry } from "@/lib/commands/registry";
import { confirmProposal } from "@/lib/commands/run";

// POST /api/assistant/confirm { proposalId, inputHash }: the person pressed the button on a confirmation card. This is the ONLY
// place a confirm-level command runs. The database uses the proposal up once, only for the person it was made for, only before it
// expires and only with the hash on the card; then the command runs as that person. If the database asks for a fresh security
// code, the answer has needsStepUp and a new card (retryProposal) to confirm again after the code is entered in its own window.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authorizeAssistant(req, { post: true, needsEnabled: true });
  if (!auth.ok) return auth.response;
  const read = await readJson(req);
  if (!read.ok) return read.response;
  const { proposalId, inputHash } = read.body;
  if (typeof proposalId !== "string" || !proposalId.trim() || proposalId.length > 100 || typeof inputHash !== "string" || !inputHash.trim() || inputHash.length > 200) {
    return fail(400, "That confirmation is incomplete, so nothing was done. Ask Niva again to get a new one.");
  }

  try {
    const base = await createCommandContext(auth.session, "assistant");
    const { store, recorded } = recordProposals(base.proposals);
    const ctx = { ...base, proposals: store };
    const result = await confirmProposal(ctx, proposalId.trim(), inputHash.trim(), { via: "assistant" });
    const registry = ctx.registry ?? defaultRegistry;
    const answer: ConfirmResponse = confirmResponse(result, recorded, (key) => registry.get(key), ctx.now?.());
    return json(200, answer);
  } catch (error) {
    console.error("[assistant] confirm failed unexpectedly:", error);
    return fail(500, "Something went wrong inside Niva. Check whether the change was made before you try again.");
  }
}
