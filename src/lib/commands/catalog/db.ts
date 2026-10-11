import type { DbErrorLike } from "@/lib/errors";

import { CommandDbError } from "../types";

/** The data of a query, or a CommandDbError (logged and explained in plain English by the command runner) when it failed. */
export function must<T>(res: { data: T | null; error: DbErrorLike | null }, doing: string): T | null {
  if (res.error) throw new CommandDbError(res.error, doing);
  return res.data;
}
