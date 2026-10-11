// runCommand: the one door every command goes through, whoever is calling (a screen, the ⌘K palette, the Niva chat).
//
//   1. find the command, check the permission, the module and (for Niva) the community's switch;
//   2. check the input against the command's schema;
//   3. by level: read and draft run now; confirm records a proposal and stops (confirmProposal runs it after the person confirms
//      that exact proposal); only_you never runs and says where the person does it;
//   4. for Niva, clean what comes back: one-time secrets out, children out (D2), then hand it over.
//
// Errors become plain sentences ("Could not change the venue — you don't have permission…") with the technical detail logged on
// the server (failure() in src/lib/errors.ts). A fresh 2FA check (CCSTP) comes back as needsStepUp for the UI's own window.

import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";

import { filterChildren, leakedMinorNames } from "./child-filter";
import { commandAvailability } from "./enabled";
import { onCommandEvent } from "./hooks";
import { ProposalError } from "./proposals";
import { defaultRegistry } from "./registry";
import { stripSecrets, scrubSecretText } from "./secrets";
import {
  CommandDbError,
  CommandError,
  type AnyCommand,
  type CommandContext,
  type CommandErrorCode,
  type CommandEvent,
  type CommandExecResult,
  type CommandPreview,
  type CommandRunResult,
  type CommandVia,
} from "./types";

type Failed = Extract<CommandRunResult, { ok: false }>;

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

function fail(error: string, code: CommandErrorCode, extra: Partial<Failed> = {}): Failed {
  return { ok: false, error, code, ...extra };
}

// ---------------------------------------------------------------------------
// The record of a call
// ---------------------------------------------------------------------------
type Call = { key: string; cmd: AnyCommand | undefined; via: CommandVia; started: number; inputKeys: string[]; proposalId?: string };

function startCall(key: string, cmd: AnyCommand | undefined, via: CommandVia, input: unknown, proposalId?: string): Call {
  const inputKeys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
  return { key, cmd, via, started: Date.now(), inputKeys, proposalId };
}

function emit(ctx: CommandContext, call: Call, outcome: CommandEvent["outcome"], result?: { code?: CommandErrorCode; error?: string }): void {
  const { session } = ctx;
  const event: CommandEvent = {
    key: call.key,
    level: call.cmd?.level ?? null,
    via: call.via,
    outcome,
    code: result?.code,
    durationMs: Date.now() - call.started,
    at: (ctx.now?.() ?? new Date()).toISOString(),
    centerId: session.center.id,
    userId: session.userId,
    personId: session.person?.id ?? null,
    roles: session.roles.map((r) => r.key),
    requestId: session.requestId,
    proposalId: call.proposalId,
    inputKeys: call.inputKeys,
    error: result?.error,
  };
  try {
    onCommandEvent(event, session);
  } catch (error) {
    // The recorder must never break the action it records.
    console.error("[commands] the activity hook failed:", error);
  }
}

const DENIED: readonly CommandErrorCode[] = ["unknown_command", "no_access", "module_off", "switched_off", "only_you", "wrong_community"];

function done(ctx: CommandContext, call: Call, result: CommandRunResult, outcome?: CommandEvent["outcome"]): CommandRunResult {
  if (result.ok) {
    emit(ctx, call, outcome ?? "ok");
    return result;
  }
  const kind: CommandEvent["outcome"] = result.needsStepUp ? "needs_step_up" : DENIED.includes(result.code) ? "denied" : result.code === "invalid" ? "invalid" : "failed";
  emit(ctx, call, kind, { code: result.code, error: result.error });
  return result;
}

// ---------------------------------------------------------------------------
// What a model may see (D2 and the secrets rule)
// ---------------------------------------------------------------------------
const minorCache = new WeakMap<object, Promise<string[]>>();

async function minorNames(ctx: CommandContext): Promise<string[]> {
  if (!ctx.minors) throw new Error("no way to tell which names belong to children");
  const cached = minorCache.get(ctx.session);
  if (cached) return cached;
  const pending = ctx.minors.namesOfMinors(ctx.session);
  minorCache.set(ctx.session, pending);
  pending.catch(() => minorCache.delete(ctx.session));
  return pending;
}

const UNSAFE = "Niva could not check this answer for children's records, so it was not used. Try again, or do this on the screen.";

/**
 * What goes back to the caller. For a screen or the palette it is the answer as it is. For Niva it has no secrets and nothing
 * about a child; if that cannot be checked or a child's name is still in it, the answer is withheld (never sent).
 */
async function protect<T>(ctx: CommandContext, value: T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  if (ctx.via !== "assistant") return { ok: true, value };
  try {
    const names = await minorNames(ctx);
    const clean = filterChildren(stripSecrets(value).value, { minorNames: names, today: todayInTz(ctx.session.center.time_zone, ctx.now?.()) }).value;
    const leaked = leakedMinorNames(clean, names);
    if (leaked.length > 0) {
      console.error(`[commands] withheld a result: ${leaked.length} name(s) of people under 18 were still in it`);
      return { ok: false, error: UNSAFE };
    }
    return { ok: true, value: clean };
  } catch (error) {
    console.error("[commands] could not check a result for children's records:", error);
    return { ok: false, error: UNSAFE };
  }
}

/** Failures whose sentence comes from the command or the database (it may name a record), not from this file's own fixed wording. */
const DYNAMIC_FAILURES: readonly CommandErrorCode[] = ["failed", "needs_step_up", "proposal_failed"];

/** A failure's sentence, cleaned the same way before a model reads it. */
async function protectFailure(ctx: CommandContext, result: Failed): Promise<Failed> {
  if (ctx.via !== "assistant") return result;
  if (!DYNAMIC_FAILURES.includes(result.code)) return { ...result, error: scrubSecretText(result.error) };
  const text = await protect(ctx, scrubSecretText(result.error));
  return { ...result, error: text.ok ? (text.value as string) : UNSAFE };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------
async function execute(cmd: AnyCommand, ctx: CommandContext, input: unknown): Promise<CommandExecResult<unknown>> {
  try {
    return await cmd.execute!(ctx, input);
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: error.message };
    if (error instanceof CommandDbError) return failure(`Could not ${error.doing}`, error.dbError);
    return failure(`Could not ${lowerFirst(cmd.title)}`, error);
  }
}

function defaultPreview(cmd: AnyCommand, input: unknown): CommandPreview {
  const entries = input && typeof input === "object" ? Object.entries(input as Record<string, unknown>) : [];
  return {
    summary: cmd.title,
    lines: entries.filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ({ label: k.replace(/_/g, " "), value: typeof v === "string" ? v : JSON.stringify(v) })),
  };
}

async function buildPreview(cmd: AnyCommand, ctx: CommandContext, input: unknown): Promise<CommandPreview> {
  return cmd.preview ? cmd.preview(ctx, input) : defaultPreview(cmd, input);
}

function confirmTextOf(cmd: AnyCommand, input: unknown, preview: CommandPreview): string {
  if (typeof cmd.confirmText === "function") return cmd.confirmText(input, preview);
  return cmd.confirmText ?? `Yes, ${lowerFirst(cmd.title)}`;
}

function fromExec(result: Extract<CommandExecResult<unknown>, { ok: false }>): Failed {
  if (result.stepUp) return fail(result.error, "needs_step_up", { needsStepUp: true, stepUp: true });
  return fail(result.error, "failed");
}

async function propose(ctx: CommandContext, cmd: AnyCommand, input: unknown, preview: CommandPreview, thread: string | null) {
  return ctx.proposals.propose({ centerId: ctx.session.center.id, userId: ctx.session.userId, command: cmd.key, input, preview, thread });
}

function proposalFailure(error: unknown, doing: string): Failed {
  if (error instanceof ProposalError) return fail(error.message, "proposal_failed");
  const f = failure(doing, error);
  return fail(f.error, "proposal_failed");
}

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------
export type RunOptions = {
  /** Which door this came through. Defaults to the context's. */
  via?: CommandVia;
  /** The chat thread a proposal came from, when it came from the assistant. */
  thread?: string | null;
};

export async function runCommand<O = unknown>(ctx: CommandContext, key: string, input: unknown, opts: RunOptions = {}): Promise<CommandRunResult<O>> {
  const via = opts.via ?? ctx.via;
  const run: CommandContext = { ...ctx, via };
  const cmd = (run.registry ?? defaultRegistry).get(key);
  const call = startCall(key, cmd, via, input);
  const finish = async (result: CommandRunResult, outcome?: CommandEvent["outcome"]) => done(run, call, result.ok ? result : await protectFailure(run, result), outcome) as CommandRunResult<O>;

  if (!cmd) return finish(fail(`Weaver does not have an action called "${key}".`, "unknown_command"));

  const available = commandAvailability(cmd, run.session, via);
  if (!available.ok) return finish(fail(available.error, available.code));

  if (cmd.level === "only_you") {
    const where = cmd.pointTo;
    return finish(
      fail(`${cmd.title} is something only you can do${where ? `. ${where.label}` : ""}.`, "only_you", where ? { onlyYou: { label: where.label, href: where.href } } : {}),
    );
  }

  const parsed = cmd.input.parse(input);
  if (!parsed.ok) return finish(fail(`Could not ${lowerFirst(cmd.title)} — ${lowerFirst(parsed.error)}`, "invalid"));

  if (cmd.level === "confirm") {
    let preview: CommandPreview;
    try {
      preview = await buildPreview(cmd, run, parsed.value);
    } catch (error) {
      if (error instanceof CommandError) return finish(fail(error.message, error.code));
      const f = failure(`Could not prepare to ${lowerFirst(cmd.title)}`, error);
      return finish(fail(f.error, "failed"));
    }
    let ticket;
    try {
      ticket = await propose(run, cmd, parsed.value, preview, opts.thread ?? null);
    } catch (error) {
      return finish(proposalFailure(error, `Could not prepare to ${lowerFirst(cmd.title)}`));
    }
    call.proposalId = ticket.proposalId;
    const shown = await protect(run, { preview, confirmText: confirmTextOf(cmd, parsed.value, preview) });
    if (!shown.ok) return finish(fail(shown.error, "unsafe_result"));
    return finish({ ok: true, needsConfirmation: true, proposalId: ticket.proposalId, inputHash: ticket.inputHash, expiresAt: ticket.expiresAt, ...shown.value }, "proposed");
  }

  // read and draft
  const result = await execute(cmd, run, parsed.value);
  if (!result.ok) return finish(fromExec(result));
  const shown = await protect(run, { data: result.data, message: result.message });
  if (!shown.ok) return finish(fail(shown.error, "unsafe_result"));
  return finish({ ok: true, data: shown.value.data as O, ...(shown.value.message ? { message: shown.value.message } : {}) });
}

// ---------------------------------------------------------------------------
// confirmProposal / rejectProposal
// ---------------------------------------------------------------------------
/**
 * The person confirmed a proposal: use it up in the database (once, theirs, unexpired, same input), then do the action.
 * If the database asks for a fresh 2FA check the proposal is already used, so the answer carries `retry`: a new proposal for the
 * same action, to confirm again once the security code is entered.
 */
export async function confirmProposal<O = unknown>(ctx: CommandContext, proposalId: string, inputHash: string, opts: RunOptions = {}): Promise<CommandRunResult<O>> {
  const via = opts.via ?? ctx.via;
  const run: CommandContext = { ...ctx, via };
  const call = startCall("(confirm)", undefined, via, {}, proposalId);
  const finish = async (result: CommandRunResult, outcome?: CommandEvent["outcome"]) => done(run, call, result.ok ? result : await protectFailure(run, result), outcome) as CommandRunResult<O>;

  let confirmed;
  try {
    confirmed = await run.proposals.confirm({ proposalId, inputHash, userId: run.session.userId });
  } catch (error) {
    return finish(proposalFailure(error, "Could not confirm this"));
  }
  call.key = confirmed.command;
  const cmd = (run.registry ?? defaultRegistry).get(confirmed.command);
  call.cmd = cmd;

  const record = async (ok: boolean, summary: string): Promise<string | null> => {
    try {
      await run.proposals.finish({ proposalId, ok, summary: summary.slice(0, 500), correlation: run.session.requestId });
      return null;
    } catch (error) {
      console.error("[commands] could not record how a confirmed action went:", error);
      return "It was not recorded in the confirmation log.";
    }
  };
  const stop = async (result: Failed) => {
    await record(false, result.error);
    return finish(result);
  };

  if (confirmed.centerId !== run.session.center.id) {
    return stop(fail("That confirmation is for a different community, so nothing was done.", "wrong_community"));
  }
  if (!cmd || !cmd.execute) return stop(fail(`Weaver does not have an action called "${confirmed.command}".`, "unknown_command"));
  const available = commandAvailability(cmd, run.session, via);
  if (!available.ok) return stop(fail(available.error, available.code));
  const parsed = cmd.input.parse(confirmed.input);
  if (!parsed.ok) return stop(fail(`Could not ${lowerFirst(cmd.title)} — ${lowerFirst(parsed.error)}`, "invalid"));

  // The confirmed proposal's id travels with the run, so a command that must not happen twice can use it as its key.
  const result = await execute(cmd, { ...run, proposalId }, parsed.value);
  if (!result.ok) {
    const failed = fromExec(result);
    await record(false, result.stepUp ? "A fresh security code was needed." : result.error);
    if (!result.stepUp) return finish(failed);
    // The proposal is used up. Offer a new one for the same action so the person can enter the code and confirm again.
    try {
      const preview = await buildPreview(cmd, run, parsed.value).catch(() => defaultPreview(cmd, parsed.value));
      const retry = await propose(run, cmd, parsed.value, preview, null);
      return finish({ ...failed, retry: { proposalId: retry.proposalId, inputHash: retry.inputHash, expiresAt: retry.expiresAt } });
    } catch (error) {
      console.error("[commands] could not prepare a new confirmation after the security code was asked for:", error);
      return finish(failed);
    }
  }

  const note = await record(true, result.message ?? `${cmd.title}: done`);
  const shown = await protect(run, { data: result.data, message: [result.message, note].filter(Boolean).join(" ") || undefined });
  // The action has happened; if its answer cannot be shown safely, say so rather than call it a failure.
  if (!shown.ok) return finish({ ok: true, data: undefined as O, message: "Done. The details are not shown here." }, "confirmed");
  return finish({ ok: true, data: shown.value.data as O, ...(shown.value.message ? { message: shown.value.message } : {}) }, "confirmed");
}

/** The person said no to a proposal. */
export async function rejectProposal(ctx: CommandContext, proposalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const call = startCall("(reject)", undefined, ctx.via, {}, proposalId);
  try {
    await ctx.proposals.reject({ proposalId, userId: ctx.session.userId });
    emit(ctx, call, "rejected");
    return { ok: true };
  } catch (error) {
    const f = proposalFailure(error, "Could not turn this request down");
    emit(ctx, call, "failed", { code: f.code, error: f.error });
    return { ok: false, error: f.error };
  }
}

