import type { DbErrorLike } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

import { CommandDbError } from "../types";

/** The data of a query, or a CommandDbError (logged and explained in plain English by the command runner) when it failed. */
export function must<T>(res: { data: T | null; error: DbErrorLike | null }, doing: string): T | null {
  if (res.error) throw new CommandDbError(res.error, doing);
  return res.data;
}

type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;

/**
 * Call a database function that answers with one JSON document (the Giving summary reads, migrations 0656 and 0657). The shape
 * is read by the command with the parsers in giving-json.ts, so the answer is checked where it is used; the one loose type is
 * here, in one place. A failure becomes a CommandDbError ("Could not read the pledges — …"), never an empty answer.
 */
export async function rpcJson(db: AppSupabase, fn: string, args: Record<string, unknown>, doing: string): Promise<unknown> {
  const res = await (db as unknown as { rpc: RpcCaller }).rpc(fn, args);
  if (res.error) throw new CommandDbError(res.error, doing);
  return res.data;
}
