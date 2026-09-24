// Form parsing for Server Actions in the Events module (moved from
// connect-admin lib/forms.ts, adapted to this app's ActionResult/failure()).

import { unstable_rethrow } from "next/navigation";

import { explainError, failure, type ActionResult } from "@/lib/errors";

import { fromDateTimeLocal, parseDollarsToCents } from "./format";

/** A validation problem written for the person filling in the form. */
export class FormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormError";
  }
}

/** A database step failed; `doing` says which step, in plain words ("save the event"). */
export class DbFailure extends Error {
  constructor(
    public readonly dbError: unknown,
    public readonly doing: string,
  ) {
    super(`${doing}: ${explainError(dbError)}`);
    this.name = "DbFailure";
  }
}

export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (v === null || typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function reqStr(fd: FormData, key: string, label: string): string {
  const v = str(fd, key);
  if (!v) throw new FormError(`${label} is required.`);
  return v;
}

export function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[], label: string, fallback?: T): T {
  const v = str(fd, key) ?? fallback ?? null;
  if (!v || !(allowed as readonly string[]).includes(v)) throw new FormError(`Choose a valid ${label.toLowerCase()}.`);
  return v as T;
}

export function int(fd: FormData, key: string, label: string, opts: { min?: number; max?: number } = {}): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  if (!/^-?\d+$/.test(v)) throw new FormError(`${label} must be a whole number.`);
  const n = Number(v);
  if (opts.min !== undefined && n < opts.min) throw new FormError(`${label} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw new FormError(`${label} must be at most ${opts.max}.`);
  return n;
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1";
}

export function isoDate(fd: FormData, key: string, label: string): string | null {
  const v = str(fd, key);
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new FormError(`${label} must be a date.`);
  return v;
}

export function dateTime(fd: FormData, key: string, label: string, tz: string): string | null {
  const v = str(fd, key);
  if (v === null) return null;
  const iso = fromDateTimeLocal(v, tz);
  if (!iso) throw new FormError(`${label} must be a date and time.`);
  return iso;
}

export function cents(fd: FormData, key: string, label: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const c = parseDollarsToCents(v);
  if (c === null) throw new FormError(`${label} must be an amount like 25 or 25.50.`);
  return c;
}

/** Comma- or space-separated dollar amounts → positive cents. */
export function centsList(raw: string | null, label: string): number[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((part) => {
      const c = parseDollarsToCents(part);
      if (c === null || c <= 0) throw new FormError(`${label}: "${part}" is not an amount.`);
      return c;
    });
}

export function all(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/** Throw a DbFailure if the query failed, else return its data. */
export function must<R extends { data: unknown; error: unknown }>(res: R, doing: string): NonNullable<R["data"]> | null {
  if (res.error) throw new DbFailure(res.error, doing);
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

/**
 * Wrap a Server Action body: validation errors become plain-English results,
 * database errors are logged and explained, redirects pass through.
 * `doing` completes "Could not …" ("save the event").
 */
export async function runAction<T = unknown>(context: string, doing: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof FormError) return { ok: false, error: `Could not ${doing} — ${lowerFirst(error.message)}` };
    if (error instanceof DbFailure) return failure(`Could not ${error.doing}`, error.dbError);
    console.error(`[events] ${context} failed:`, error);
    return failure(`Could not ${doing}`, error);
  }
}

function lowerFirst(s: string): string {
  // Keep proper nouns and acronyms ("RSVPs must close…", "Lunch starts…") readable.
  if (/^[A-Z]{2}/.test(s)) return s;
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
