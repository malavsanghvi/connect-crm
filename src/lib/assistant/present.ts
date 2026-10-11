// How commands and proposals are shown to the person: the palette's list (CommandInfo) and the confirmation card (ProposalCard).
// Pure: no server imports.

import type { AnyCommand, CommandNeedsConfirmation, CommandPreview, CommandRunResult, PreviewLine } from "@/lib/commands";
import type { ProposalTicket } from "@/lib/commands/proposals";
import { fieldLabel, type JsonSchemaProp } from "@/lib/commands/schema";
import { describe, type CommandKind } from "@/lib/commands/text";

import type { CommandInfo, ConfirmResponse, ProposalCard, RunResponse } from "./protocol";

type FieldKind = CommandInfo["fields"][number]["type"];

function fieldKind(prop: JsonSchemaProp): { type: FieldKind; choices?: string[] } {
  if (prop.enum && prop.enum.length > 0) return { type: "choice", choices: [...prop.enum] };
  if (prop.type === "boolean") return { type: "choice", choices: ["yes", "no"] };
  if (prop.type === "integer") return { type: "number" };
  if (prop.format === "date") return { type: "date" };
  return { type: "text" };
}

/** A description written for a model, cut to its first sentence for a person. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const match = /^.*?[.!?](?=\s+[A-Z]|$)/.exec(flat);
  const sentence = match ? match[0] : flat;
  return sentence.length > 220 ? `${sentence.slice(0, 217).trimEnd()}...` : sentence;
}

/** One command as the palette and the panel list it. */
export function commandInfo(command: AnyCommand, kind?: CommandKind): CommandInfo {
  const shape = command.input.shape;
  const json = command.input.json();
  return {
    key: command.key,
    title: command.title,
    description: firstSentence(describe(command.description, kind)),
    level: command.level,
    /** "people" | "giving" | "events" | "messages" | "accounting" | "tasks": the part of the key before the dot. */
    area: command.key.split(".")[0],
    fields: Object.keys(shape)
      .filter((name) => !shape[name].hidden)
      .map((name) => {
      const kind = fieldKind(json.properties[name]);
      return { name, label: fieldLabel(name), required: !shape[name].optional, ...kind };
    }),
  };
}

function quoted(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "empty" : `"${value}"`;
}

/** A preview line as a plain sentence. */
export function lineText(line: PreviewLine): string {
  if (line.before !== undefined || line.after !== undefined) return `${line.label}: from ${quoted(line.before)} to ${quoted(line.after)}.`;
  if (line.value !== undefined && line.value !== "") return `${line.label}: ${line.value}.`;
  return `${line.label}.`;
}

/** What will happen, as sentences: the summary, then each line, then anything to know first. */
export function previewSentences(preview: CommandPreview): string[] {
  const out: string[] = [];
  if (preview.summary.trim()) out.push(preview.summary.trim());
  for (const line of preview.lines) out.push(lineText(line));
  for (const warning of preview.warnings ?? []) out.push(`Note: ${warning}`);
  return out;
}

/** How long a proposal lives when the database did not say (src/lib/commands/proposals.ts PROPOSAL_TTL_MS). */
const DEFAULT_TTL_MS = 15 * 60 * 1000;

/** The confirmation card for a proposal the command layer recorded. */
export function proposalCard(
  command: Pick<AnyCommand, "key" | "title">,
  proposal: Pick<CommandNeedsConfirmation, "proposalId" | "inputHash" | "preview" | "confirmText" | "expiresAt">,
  now: Date = new Date(),
): ProposalCard {
  return {
    id: proposal.proposalId,
    command: command.key,
    title: command.title,
    lines: previewSentences(proposal.preview),
    ...(proposal.preview.households && proposal.preview.households.length > 0 ? { cards: proposal.preview.households } : {}),
    confirmText: proposal.confirmText,
    inputHash: proposal.inputHash,
    expiresAt: proposal.expiresAt ?? new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// What the routes answer (RunResponse, ConfirmResponse)
// ---------------------------------------------------------------------------
function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** The button's label, the same way runCommand words it (src/lib/commands/run.ts confirmTextOf). */
export function confirmTextFor(command: Pick<AnyCommand, "title" | "confirmText">, input: unknown, preview: CommandPreview): string {
  if (typeof command.confirmText === "function") return command.confirmText(input as never, preview);
  return command.confirmText ?? `Yes, ${lowerFirst(command.title)}`;
}

/** The answer to POST /api/assistant/run for what runCommand returned. */
export function runResponse(result: CommandRunResult, command: Pick<AnyCommand, "key" | "title"> | undefined, now?: Date): RunResponse {
  if (!result.ok) return { ok: false, error: result.error, ...(result.needsStepUp ? { needsStepUp: true } : {}) };
  if (result.needsConfirmation) {
    if (!command) return { ok: false, error: "Niva could not show the confirmation. Nothing was changed. Try again." };
    return { ok: true, kind: "proposal", proposal: proposalCard(command, result, now) };
  }
  return { ok: true, kind: "result", title: command?.title ?? "Result", data: result.data ?? null, ...(result.message ? { text: result.message } : {}) };
}

/** A proposal the command layer recorded while a confirmation ran (see recordProposals). */
export type RecordedProposal = { command: string; input: unknown; preview: CommandPreview; ticket: ProposalTicket };

/**
 * The answer to POST /api/assistant/confirm. When the database asked for a fresh security code, the first confirmation is used
 * up and the command layer made a new one: it comes back as `retryProposal`, so the interface can show the card again after the
 * security window.
 */
export function confirmResponse(
  result: CommandRunResult,
  recorded: ReadonlyMap<string, RecordedProposal>,
  commandOf: (key: string) => Pick<AnyCommand, "key" | "title" | "confirmText"> | undefined,
  now?: Date,
): ConfirmResponse {
  if (result.ok && !result.needsConfirmation) {
    return { ok: true, message: result.message?.trim() || "Done.", ...(result.data !== undefined ? { data: result.data } : {}) };
  }
  if (result.ok) return { ok: false, error: "Niva could not finish that. Nothing was changed. Ask again to get a new confirmation." };
  const base: Extract<ConfirmResponse, { ok: false }> = { ok: false, error: result.error };
  if (!result.needsStepUp) return base;
  base.needsStepUp = true;
  const next = result.retry ? recorded.get(result.retry.proposalId) : undefined;
  const command = next ? commandOf(next.command) : undefined;
  if (next && command) {
    base.retryProposal = proposalCard(
      command,
      { proposalId: next.ticket.proposalId, inputHash: next.ticket.inputHash, expiresAt: next.ticket.expiresAt, preview: next.preview, confirmText: confirmTextFor(command, next.input, next.preview) },
      now,
    );
  }
  return base;
}
