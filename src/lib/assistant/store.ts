// The two database pieces of Niva for admins that the chat touches besides the command layer: the monthly limit and the
// conversation log (migration 0617, PR "the database half of Niva for admins"). Both are called as the signed-in person, through
// the same client the commands use. Until that migration is applied the functions do not exist: that is "no limit yet" and "no
// log yet", said once in the server log, never an error for the person.

import { explainError, type DbErrorLike } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import type { AppSupabase } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------
/** PostgREST (PGRST202) or Postgres (42883): the function is not in the database yet. */
export function isMissingFunction(error: DbErrorLike | null | undefined): boolean {
  return !!error && (error.code === "PGRST202" || error.code === "42883");
}

/** PostgREST (PGRST205) or Postgres (42P01): the table is not in the database yet. */
export function isMissingTable(error: DbErrorLike | null | undefined): boolean {
  return !!error && (error.code === "PGRST205" || error.code === "42P01");
}

const said = new Set<string>();
function sayOnce(key: string, text: string): void {
  if (said.has(key)) return;
  said.add(key);
  console.error(`[assistant] ${text}`);
}
/** For the tests: forget what was said, so each test sees the first time. */
export function forgetWhatWasSaid(): void {
  said.clear();
}

/** The database raises its own sentences ("You don't have access to this area."); use them, and explain anything else. */
function plainReason(error: DbErrorLike): string {
  const message = (error.message ?? "").trim();
  if (error.code === "42501" && message && !/permission denied|row-level security/i.test(message)) return message.replace(/[.!?]$/, "");
  return explainError(error);
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// The monthly limit (app.assistant_usage_check / assistant_usage_status)
// ---------------------------------------------------------------------------
export type UsageVerdict =
  | { state: "allowed"; used: number; limit: number | null }
  | { state: "blocked"; used: number; limit: number | null; reason: string }
  /** The database part is not applied yet: no limit applies. */
  | { state: "unmetered" }
  | { state: "failed"; error: string };

export type UsageStatus = { used: number; limit: number | null; month: string };

export interface UsageMeter {
  /** Count one chat message against the community's month. */
  check(): Promise<UsageVerdict>;
  /** The numbers without counting. Null when there are none to show. */
  status(): Promise<UsageStatus | null>;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function databaseUsageMeter(db: AppSupabase, centerId: string): UsageMeter {
  const rpc = untypedRpc(db);
  return {
    async check() {
      const res = await rpc("assistant_usage_check", { p_center: centerId, p_cost: 1 });
      if (res.error) {
        if (isMissingFunction(res.error)) {
          sayOnce("usage-check", "app.assistant_usage_check does not exist yet (migration 0617 is not applied), so no monthly limit applies.");
          return { state: "unmetered" };
        }
        console.error("[assistant] app.assistant_usage_check failed:", res.error);
        return { state: "failed", error: `Could not start — ${plainReason(res.error)}.` };
      }
      const o = obj(res.data);
      if (!o || typeof o.allowed !== "boolean") {
        console.error("[assistant] app.assistant_usage_check answered something unexpected:", res.data);
        return { state: "failed", error: "Could not check this community's monthly limit for Niva — the database answered in a way this app does not understand. Try again." };
      }
      const used = num(o.used);
      const limit = typeof o.limit === "number" ? o.limit : null;
      if (o.allowed) return { state: "allowed", used, limit };
      const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim() : "Niva has used up this community's actions for the month. It starts again on the 1st.";
      return { state: "blocked", used, limit, reason };
    },

    async status() {
      const res = await rpc("assistant_usage_status", { p_center: centerId });
      if (res.error) {
        if (isMissingFunction(res.error)) sayOnce("usage-status", "app.assistant_usage_status does not exist yet (migration 0617 is not applied).");
        else console.error("[assistant] app.assistant_usage_status failed:", res.error);
        return null;
      }
      const o = obj(res.data);
      if (!o) return null;
      return { used: num(o.used), limit: typeof o.limit === "number" ? o.limit : null, month: typeof o.month === "string" ? o.month : "" };
    },
  };
}

// ---------------------------------------------------------------------------
// The conversation log (app.assistant_log_message, app.assistant_messages)
// ---------------------------------------------------------------------------
export type LogRole = "user" | "assistant" | "tool";
export type HistoryTurn = { role: "user" | "assistant"; text: string };

export interface ConversationLog {
  /** The earlier turns of this conversation (the person's own, newest last). Empty when there are none or none can be read. */
  history(threadId: string): Promise<HistoryTurn[]>;
  /** Add a line. `blocked` carries a sentence when this conversation cannot be used (someone else's, or too long). */
  append(threadId: string, role: LogRole, text: string, commandKey?: string): Promise<{ blocked?: string }>;
}

/** The conversation text is kept 30 days and cut to 8,000 characters by the database; send a bit less. */
const MAX_LOGGED = 7_900;
const HISTORY_LINES = 20;

// A loose view of the client: the new tables are not in the generated types until that migration is merged.
type LooseRows = PromiseLike<{ data: { role: string; content: string }[] | null; error: DbErrorLike | null }>;
type LooseDb = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): { eq(column: string, value: string): { in(column: string, values: string[]): { order(column: string, options: { ascending: boolean }): { limit(n: number): LooseRows } } } };
    };
  };
};

/** Raised by the function in plain English; these mean this conversation cannot take another line. */
const UNUSABLE_THREAD = /belongs to someone else|getting long|don'?t have access|sign in to use niva/i;

export function databaseConversationLog(db: AppSupabase, centerId: string): ConversationLog {
  const rpc = untypedRpc(db);
  return {
    async history(threadId) {
      const res = await (db as unknown as LooseDb)
        .from("assistant_messages")
        .select("role, content")
        .eq("center_id", centerId)
        .eq("thread_id", threadId)
        .in("role", ["user", "assistant"])
        .order("created_at", { ascending: false })
        .limit(HISTORY_LINES);
      if (res.error) {
        if (isMissingTable(res.error)) sayOnce("history", "app.assistant_messages does not exist yet (migration 0617 is not applied), so a conversation has no memory.");
        else console.error("[assistant] could not read the earlier part of the conversation:", res.error);
        return [];
      }
      const turns = (res.data ?? [])
        .filter((r) => (r.role === "user" || r.role === "assistant") && typeof r.content === "string")
        .reverse()
        .map((r) => ({ role: r.role as "user" | "assistant", text: r.content }));
      // A conversation sent to the model starts with the person's words.
      while (turns.length > 0 && turns[0].role !== "user") turns.shift();
      return turns;
    },

    async append(threadId, role, text, commandKey) {
      const content = text.length > MAX_LOGGED ? `${text.slice(0, MAX_LOGGED)} ... (shortened)` : text;
      if (!content.trim()) return {};
      const res = await rpc("assistant_log_message", { p_center: centerId, p_thread: threadId, p_role: role, p_content: content, p_command_key: commandKey ?? null });
      if (!res.error) return {};
      if (isMissingFunction(res.error)) {
        sayOnce("log", "app.assistant_log_message does not exist yet (migration 0617 is not applied), so conversations are not logged.");
        return {};
      }
      console.error("[assistant] could not log a line of the conversation:", res.error);
      const message = (res.error.message ?? "").trim();
      if (message && UNUSABLE_THREAD.test(message)) return { blocked: message };
      return {};
    },
  };
}
