import type { DbErrorLike } from "@/lib/errors";

type Page<T> = PromiseLike<{ data: T[] | null; error: DbErrorLike | null }>;

/**
 * Read every row of a query in pages (PostgREST caps a response at max_rows,
 * 1000 by default). The builder must apply a stable order. Stops at `max`
 * rows and says so via `truncated`, so a total is never silently partial.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
  { pageSize = 1000, max = 50_000 }: { pageSize?: number; max?: number } = {},
): Promise<{ data: T[]; error: DbErrorLike | null; truncated: boolean }> {
  const out: T[] = [];
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: out, error, truncated: false };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return { data: out, error: null, truncated: false };
  }
  return { data: out, error: null, truncated: true };
}

/** Split a list of ids into chunks small enough for an `in.(…)` filter in a URL. */
export function chunk<T>(items: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
