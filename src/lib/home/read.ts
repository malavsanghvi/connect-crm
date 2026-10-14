// One read the Home cards make, as data: what came back, or why it did not. A failed read is never turned into a zero:
// the card says so in plain English with a retry (docs/ARCHITECTURE.md "Errors"). Pure.

export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

export const readOk = <T>(value: T): Read<T> => ({ ok: true, value });
export const readFailed = (error: string): Read<never> => ({ ok: false, error });

/** "Could not load the notices — the database could not be reached — check the connection and try again." */
export function problemSentence(what: string, reason: string): string {
  const why = reason.trim().replace(/[.\s]+$/, "") || "an unknown error occurred";
  return `Could not ${what} — ${why}.`;
}
