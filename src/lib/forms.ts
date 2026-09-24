// Form parsing for Server Actions (moved from connect-admin): every problem
// is a sentence for the person filling in the form. A database step that
// fails is logged with its technical detail and explained in plain English
// (docs/ARCHITECTURE.md "Errors").

import { unstable_rethrow } from "next/navigation";

import { explainError, type ActionResult } from "@/lib/errors";
import { fromDateTimeLocal, parseDollarsToCents } from "@/lib/pathshala/format";

/** A validation problem written for the person filling in the form. */
export class FormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormError";
  }
}

export function ok<T = undefined>(message?: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + "T00:00:00Z"))) throw new FormError(`${label} must be a date.`);
  return v;
}

export function dateTime(fd: FormData, key: string, label: string, tz: string): string | null {
  const v = str(fd, key);
  if (v === null) return null;
  const iso = fromDateTimeLocal(v, tz);
  if (!iso) throw new FormError(`${label} must be a date and time.`);
  return iso;
}

export function time(fd: FormData, key: string, label: string): string | null {
  const v = str(fd, key);
  if (v === null) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(v)) throw new FormError(`${label} must be a time.`);
  return v;
}

export function cents(fd: FormData, key: string, label: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const c = parseDollarsToCents(v);
  if (c === null) throw new FormError(`${label} must be an amount like 25 or 25.50.`);
  return c;
}

export function all(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
}

/** Dates entered one per line or comma-separated. */
export function dateList(fd: FormData, key: string, label: string): string[] {
  const raw = str(fd, key);
  if (!raw) return [];
  const items = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  for (const d of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new FormError(`${label}: "${d}" is not a date (use YYYY-MM-DD).`);
  }
  return [...new Set(items)].sort();
}

/** A database step failed; `doing` says which step in plain words. */
export class DbFailure extends Error {
  constructor(
    public readonly dbError: unknown,
    public readonly doing: string,
  ) {
    super(`${doing}: ${(dbError as { message?: string })?.message ?? String(dbError)}`);
    this.name = "DbFailure";
  }
}

/** Throw a DbFailure if the query failed, else return its data. */
export function must<R extends { data: unknown; error: unknown }>(res: R, doing: string): NonNullable<R["data"]> | null {
  if (res.error) throw new DbFailure(res.error, doing);
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

function sentence(doing: string, error: unknown): string {
  const reason = explainError(error);
  return `Could not ${doing} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`;
}

/**
 * Wrap a Server Action body: validation errors become plain-English results,
 * unexpected errors are logged and explained, redirects pass through.
 */
export async function runAction<T = unknown>(context: string, doing: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof FormError) return { ok: false, error: error.message };
    if (error instanceof DbFailure) {
      console.error(`[crm] ${context}: could not ${error.doing}:`, error.dbError);
      return { ok: false, error: sentence(error.doing, error.dbError) };
    }
    console.error(`[crm] ${context}:`, error);
    return { ok: false, error: sentence(doing, error) };
  }
}
