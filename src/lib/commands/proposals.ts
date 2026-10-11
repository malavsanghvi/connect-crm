// Confirmation enforced on the server: propose, confirm, execute (ADMIN_REDESIGN "To build first"). Today ActionForm confirms only
// in the browser and the action runs the moment it is called. A confirm-level command instead records a PROPOSAL (what it will do,
// as the person saw it) and runs only after the person confirms that exact proposal: one time, bound to the person, expiring, and
// bound to a hash of the input so a changed request cannot ride on an old confirmation.
//
// The store is an interface. The database one calls app.assistant_propose / assistant_confirm / assistant_finish /
// assistant_reject (migration 0616+, stream A-DB); the in-memory one is for tests and has the same rules.

import { createHash, randomUUID } from "node:crypto";

import { explainError } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import type { AppSupabase } from "@/lib/supabase/server";

import type { CommandPreview } from "./types";

export type ProposalInput = {
  centerId: string;
  userId: string;
  command: string;
  input: unknown;
  preview: CommandPreview;
  /** The chat thread it came from, when it came from the assistant. */
  thread?: string | null;
};

export type ProposalTicket = { proposalId: string; inputHash: string; expiresAt: string | null };
export type ConfirmedProposal = { command: string; input: unknown; centerId: string };

export type ProposalErrorCode = "not_found" | "not_yours" | "used" | "expired" | "wrong_hash" | "rejected" | "unavailable" | "failed";

/** A confirmation that cannot be used. The message is a sentence for the person. */
export class ProposalError extends Error {
  constructor(
    message: string,
    readonly code: ProposalErrorCode,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}

export interface ProposalStore {
  /** Record what is about to happen. */
  propose(p: ProposalInput): Promise<ProposalTicket>;
  /** Use it up (once). Throws ProposalError when it is expired, used, someone else's or does not match the hash. */
  confirm(args: { proposalId: string; inputHash: string; userId: string }): Promise<ConfirmedProposal>;
  /** Record how the confirmed action went. */
  finish(args: { proposalId: string; ok: boolean; summary: string; correlation: string | null }): Promise<void>;
  /** The person said no. */
  reject(args: { proposalId: string; userId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// In memory (tests)
// ---------------------------------------------------------------------------
/** JSON with sorted keys, so the same input always has the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashProposalInput(p: { centerId: string; command: string; input: unknown }): string {
  return createHash("sha256").update(canonicalJson({ center: p.centerId, command: p.command, input: p.input })).digest("hex");
}

type Rec = ProposalInput & {
  id: string;
  hash: string;
  expiresAt: Date;
  status: "pending" | "confirmed" | "rejected" | "voided" | "executed" | "failed";
  summary?: string;
  correlation?: string | null;
};

export const PROPOSAL_TTL_MS = 15 * 60 * 1000;

export class InMemoryProposalStore implements ProposalStore {
  readonly records = new Map<string, Rec>();
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(opts: { ttlMs?: number; now?: () => Date } = {}) {
    this.ttlMs = opts.ttlMs ?? PROPOSAL_TTL_MS;
    this.now = opts.now ?? (() => new Date());
  }

  async propose(p: ProposalInput): Promise<ProposalTicket> {
    const id = randomUUID();
    const hash = hashProposalInput(p);
    const expiresAt = new Date(this.now().getTime() + this.ttlMs);
    // Keep a copy: a later change to the caller's object must not change what was proposed.
    this.records.set(id, { ...p, input: JSON.parse(JSON.stringify(p.input ?? {})), id, hash, expiresAt, status: "pending" });
    return { proposalId: id, inputHash: hash, expiresAt: expiresAt.toISOString() };
  }

  async confirm(args: { proposalId: string; inputHash: string; userId: string }): Promise<ConfirmedProposal> {
    const r = this.records.get(args.proposalId);
    if (!r) throw new ProposalError("That confirmation was not found. Ask again to get a new one.", "not_found");
    if (r.userId !== args.userId) throw new ProposalError("That confirmation belongs to someone else.", "not_yours");
    if (r.status === "rejected") throw new ProposalError("That request was turned down, so nothing was done.", "rejected");
    if (r.status !== "pending") throw new ProposalError("That confirmation was already used. Ask again if you want it done again.", "used");
    if (this.now().getTime() >= r.expiresAt.getTime()) {
      r.status = "voided";
      throw new ProposalError("That confirmation has expired, so nothing was done. Ask again to get a new one.", "expired");
    }
    if (r.hash !== args.inputHash) {
      // A confirmation that does not match what was proposed is never reused.
      r.status = "voided";
      throw new ProposalError("The details changed since you were asked, so nothing was done. Ask again to get a new confirmation.", "wrong_hash");
    }
    r.status = "confirmed";
    return { command: r.command, input: JSON.parse(JSON.stringify(r.input ?? {})), centerId: r.centerId };
  }

  async finish(args: { proposalId: string; ok: boolean; summary: string; correlation: string | null }): Promise<void> {
    const r = this.records.get(args.proposalId);
    if (!r) throw new ProposalError("That confirmation was not found.", "not_found");
    r.status = args.ok ? "executed" : "failed";
    r.summary = args.summary;
    r.correlation = args.correlation;
  }

  async reject(args: { proposalId: string; userId: string }): Promise<void> {
    const r = this.records.get(args.proposalId);
    if (!r) throw new ProposalError("That confirmation was not found.", "not_found");
    if (r.userId !== args.userId) throw new ProposalError("That confirmation belongs to someone else.", "not_yours");
    if (r.status !== "pending") throw new ProposalError("That confirmation was already used.", "used");
    r.status = "rejected";
  }
}

// ---------------------------------------------------------------------------
// In the database (the app)
// ---------------------------------------------------------------------------
function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The proposal functions of the database. They run as the signed-in person (the session's own client), so the person is bound by
 * the database, not by this code. Their answers are jsonb, read here field by field.
 */
export function createRpcProposalStore(db: AppSupabase): ProposalStore {
  const rpc = untypedRpc(db);

  function fail(fn: string, error: { code?: string | null; message?: string | null }, doing: string): never {
    console.error(`[commands] ${fn} failed:`, error);
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new ProposalError(`Could not ${doing} — confirmations are not available yet (the latest database update has not been applied).`, "unavailable");
    }
    throw new ProposalError(`Could not ${doing} — ${explainError(error)}`, "failed");
  }

  return {
    async propose(p) {
      const res = await rpc("assistant_propose", {
        p_center: p.centerId,
        p_command: p.command,
        p_input: p.input ?? {},
        p_preview: p.preview,
        p_thread: p.thread ?? null,
      });
      if (res.error) fail("assistant_propose", res.error, "prepare the confirmation");
      const o = asObject(res.data);
      if (!o || typeof o.proposal_id !== "string" || typeof o.input_hash !== "string") {
        console.error("[commands] assistant_propose returned something unexpected:", res.data);
        throw new ProposalError("Could not prepare the confirmation — the database answered in a way this app does not understand.", "failed");
      }
      return { proposalId: o.proposal_id, inputHash: o.input_hash, expiresAt: typeof o.expires_at === "string" ? o.expires_at : null };
    },

    async confirm(args) {
      const res = await rpc("assistant_confirm", { p_proposal: args.proposalId, p_input_hash: args.inputHash });
      if (res.error) fail("assistant_confirm", res.error, "confirm this");
      const o = asObject(res.data);
      if (o?.ok === false) {
        const why = typeof o.error === "string" ? o.error : typeof o.message === "string" ? o.message : "this confirmation cannot be used";
        throw new ProposalError(`Could not confirm this — ${why}`, "failed");
      }
      if (!o || o.ok !== true || typeof o.command !== "string" || typeof o.center_id !== "string") {
        console.error("[commands] assistant_confirm returned something unexpected:", res.data);
        throw new ProposalError("Could not confirm this — the database answered in a way this app does not understand.", "failed");
      }
      return { command: o.command, input: o.input ?? {}, centerId: o.center_id };
    },

    async finish(args) {
      const res = await rpc("assistant_finish", { p_proposal: args.proposalId, p_ok: args.ok, p_summary: args.summary, p_correlation: args.correlation });
      if (res.error) fail("assistant_finish", res.error, "record how it went");
    },

    async reject(args) {
      const res = await rpc("assistant_reject", { p_proposal: args.proposalId });
      if (res.error) fail("assistant_reject", res.error, "turn this request down");
    },
  };
}
