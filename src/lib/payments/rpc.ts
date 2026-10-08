import type { DbErrorLike } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

// The functions of migration 0597 take nullable arguments (a null note, a null community meaning "every community") that the
// generated types cannot say: every argument is non-null there. So they are called through this untyped signature, as
// src/app/(app)/content/niva/actions.ts and settings/payments/actions.ts do. The answers are jsonb and are read by the
// parsers in change-control.ts, which check every field.
export type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
// Cast the client BEFORE binding rpc: db.rpc.bind(db) makes TypeScript instantiate the generated rpc() signature over every
// function in the schema, and past a certain size of database.types.ts that stops with TS2589 ("Type instantiation is
// excessively deep"). Binding the plain function type below costs nothing.
export const untypedRpc = (db: AppSupabase): RpcCaller => (db as unknown as { rpc: RpcCaller }).rpc.bind(db);
