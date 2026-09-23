// Errors are always shown to the user in plain English; the technical detail
// is logged on the server (docs/ARCHITECTURE.md "Errors").

export type ActionResult<T = undefined> =
  | { ok: true; error?: undefined; message?: string; data?: T }
  | { ok: false; error: string; message?: undefined; data?: undefined };

export type DbErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  name?: string;
};

function isDbError(e: unknown): e is DbErrorLike {
  return typeof e === "object" && e !== null && ("message" in e || "code" in e);
}

/** One plain-English reason for a PostgREST / Postgres / network error. */
export function explainError(error: unknown): string {
  if (!error) return "an unknown error occurred";
  if (typeof error === "string") return error;
  const e: DbErrorLike = isDbError(error) ? error : { message: String(error) };
  const code = e.code ?? "";
  const msg = (e.message ?? "").trim();

  if (code === "42501" || /row-level security|permission denied/i.test(msg)) {
    return "you don't have permission to make this change";
  }
  if (code === "23505") return "a record with the same key already exists";
  if (code === "23503") {
    return "it refers to a record that does not exist, or other records still depend on it";
  }
  if (code === "23514") {
    // Our own triggers raise check_violation with a plain sentence (e.g. the
    // two-person rule); Postgres' generic check failures start "new row …".
    return msg && !/^new row for relation|violates check constraint/i.test(msg) ? msg : "one of the values is not allowed";
  }
  if (code === "23502") return "a required value is missing";
  if (code === "22P02" || code === "22007" || code === "22008") return "one of the values has the wrong format";
  if (code === "22003") return "a number is too large";
  if (code === "PGRST116") return "the record was not found, or you can't see it";
  if (code === "PGRST301" || code === "PGRST303" || /jwt expired/i.test(msg)) {
    return "your session has expired — please sign in again";
  }
  if (code === "PGRST202") return "the database function is not available (has the latest migration been applied?)";
  if (code === "42P01" || code === "42703" || code === "PGRST204" || code === "PGRST200") {
    return "the database schema does not match this app (has the latest migration been applied?)";
  }
  if (/fetch failed|failed to fetch|network|ECONNREFUSED|ENOTFOUND|timed out/i.test(msg)) {
    return "the database could not be reached — check the connection and try again";
  }
  if (/second approver must be a different person/i.test(msg)) {
    return "you made the first request, so the two-person rule needs a different person to approve it";
  }
  if (/not allowed to approve this/i.test(msg)) return "you don't have permission to approve this";
  // RAISE EXCEPTION in our SQL functions (P0001) is already a plain sentence.
  return msg || "an unknown error occurred";
}

/**
 * Log the technical detail and return the user-facing failure:
 * "<what failed> — <why>".
 */
export function failure(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[crm] ${context}:`, error);
  const reason = explainError(error);
  return { ok: false, error: `${context} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}` };
}

export function success<T = undefined>(message?: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}
