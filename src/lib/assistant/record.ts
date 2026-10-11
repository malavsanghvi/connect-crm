// A proposal store that remembers what was proposed through it. confirmProposal makes a NEW proposal when the database asks for a
// fresh security code (the first one is used up) and returns only its id and hash; this keeps the rest (the command, its input and
// what the person was shown) so the route can answer with a whole card to confirm again. It changes nothing else.

import type { ProposalStore } from "@/lib/commands/proposals";

import type { RecordedProposal } from "./present";

export function recordProposals(inner: ProposalStore): { store: ProposalStore; recorded: Map<string, RecordedProposal> } {
  const recorded = new Map<string, RecordedProposal>();
  const store: ProposalStore = {
    async propose(p) {
      const ticket = await inner.propose(p);
      recorded.set(ticket.proposalId, { command: p.command, input: p.input, preview: p.preview, ticket });
      return ticket;
    },
    confirm: (args) => inner.confirm(args),
    finish: (args) => inner.finish(args),
    reject: (args) => inner.reject(args),
  };
  return { store, recorded };
}
