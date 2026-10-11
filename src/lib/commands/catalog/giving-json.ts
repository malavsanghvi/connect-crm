// Small readers for the JSON the Giving summary functions answer with (0656, 0657). A value that is not the expected kind
// becomes null / 0 / [] here, so a command builds its answer from checked values only. Money stays integer cents.

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const asObj = (v: unknown): Obj => (isObj(v) ? v : {});

export const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A whole number (PostgREST sends bigint as a number; a numeric string is accepted too). 0 when it is not one. */
export function int(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : 0;
}

export const bool = (v: unknown): boolean => v === true;

/** true / false, or null when the database could not say. */
export const triState = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function rows(v: unknown): Obj[] {
  return asArr(v).filter(isObj);
}
