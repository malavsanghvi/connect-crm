// How a handler says a failure will not get better by retrying.

/** A handler whose platform secrets or settings are missing. Fails the job at once, honestly. */
export class NotConfiguredError extends Error {
  override name = "NotConfiguredError";
}

/** Bad input or a missing feature: retrying cannot help. */
export class PermanentError extends Error {
  override name = "PermanentError";
}

/** The community does not have a module the job's kind needs (iWeaver, 0755): the job is not run, and not tried again. */
export class ModuleOffError extends PermanentError {
  override name = "ModuleOffError";
}

export function isRetryable(err: unknown): boolean {
  return !(err instanceof NotConfiguredError || err instanceof PermanentError);
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
