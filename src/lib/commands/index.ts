// The command layer (src/lib/commands): one typed command per action. See types.ts for the idea and run.ts for the door.
export { CATALOG, ensureCatalog } from "./catalog";
export { onCommandEvent } from "./hooks";
export { defineCommand } from "./define";
export { InMemoryProposalStore, createRpcProposalStore, type ProposalStore } from "./proposals";
export { CommandRegistry, commandKeyFromToolName, defaultRegistry, getCommand, listCommands, modelTools, registerCommand, toolName, type ModelTool } from "./registry";
export { confirmProposal, rejectProposal, runCommand } from "./run";
export * from "./types";
