// How a handler says a failure will not get better by retrying.

/** A handler whose platform secrets or settings are missing. Fails the job at once, honestly. */
export class NotConfiguredError extends Error {
  override name = "NotConfiguredError";
}

/** Bad input or a missing feature: retrying cannot help. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

export function isRetryable(err: unknown): boolean {
  return !(err instanceof NotConfiguredError || err instanceof PermanentError);
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
