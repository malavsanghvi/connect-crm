export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First value of a query param, trimmed; undefined when absent or blank. */
export function param(sp: RawSearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

export function pageParam(sp: RawSearchParams, key = "page"): number {
  const n = Number(param(sp, key));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Build a URL keeping the current params and applying overrides (undefined/"" removes). */
export function hrefWith(
  path: string,
  current: RawSearchParams,
  overrides: Record<string, string | number | undefined | null>,
): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "") usp.set(k, s);
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null || v === "") usp.delete(k);
    else usp.set(k, String(v));
  }
  const q = usp.toString();
  return q ? `${path}?${q}` : path;
}

/** Strip characters that would break a PostgREST or() / ilike filter. */
export function safeFilterText(input: string): string {
  return input.replace(/[%*,()"\\:]/g, " ").replace(/\s+/g, " ").trim();
}

export function isUuid(value: string | undefined | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
