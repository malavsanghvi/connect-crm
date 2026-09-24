import "server-only";

import { explainError } from "@/lib/errors";
import { FormError } from "@/lib/forms";
import { loadSession, type CrmSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// Server helpers for the Pathshala module (moved from connect-admin's
// lib/session.ts + lib/action-context.ts). Pages load through `load()` so a
// failed read becomes one plain-English message with a retry; actions start
// with `actionContext()` so the session and permission are re-checked.

export class LoadError extends Error {
  constructor(public readonly friendly: string) {
    super(friendly);
    this.name = "LoadError";
  }
}

type QueryResult = { data: unknown; error: unknown };

function loadFailure(what: string, error: unknown): LoadError {
  console.error(`[pathshala] could not load ${what}:`, error);
  const reason = explainError(error);
  return new LoadError(`Could not load ${what} — ${reason}${/[.!?]$/.test(reason) ? "" : "."}`);
}

/** Unwrap a list query; logs the technical detail and throws a plain-English LoadError. */
export function rows<R extends QueryResult>(res: R, what: string): NonNullable<R["data"]> {
  if (res.error) throw loadFailure(what, res.error);
  return (res.data ?? []) as NonNullable<R["data"]>;
}

/** Unwrap a maybeSingle query. */
export function row<R extends QueryResult>(res: R, what: string): NonNullable<R["data"]> | null {
  if (res.error) throw loadFailure(what, res.error);
  return (res.data ?? null) as NonNullable<R["data"]> | null;
}

/** Run a page's loader; any failure becomes a plain-English message for <LoadProblem>. */
export async function load<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof LoadError) return { ok: false, error: error.friendly };
    // redirect()/notFound() throw control-flow errors that must propagate.
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("[pathshala] page load failed:", error);
    return { ok: false, error: `Could not load this page — ${explainError(error)}.` };
  }
}

export type Viewer = CrmSession & { displayName: string; personId: string | null };

export function viewerOf(session: CrmSession): Viewer {
  return {
    ...session,
    displayName: session.person?.name ?? session.email ?? "Signed in",
    personId: session.person?.id ?? null,
  };
}

/**
 * Every Pathshala Server Action starts here: re-check the session and the
 * permission (actions are reachable by direct POST, so the page's check is
 * not enough). RLS remains the final word on every row.
 */
export async function actionContext(
  check?: (v: Viewer) => boolean,
  denied = "You don't have permission to do that.",
): Promise<{ viewer: Viewer; supabase: AppSupabase; centerId: string; tz: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") throw new FormError("Your session has ended. Sign in again, then retry.");
  if (state.status === "env_missing") throw new FormError("The app is not configured yet.");
  if (state.status === "center_missing") throw new FormError(`Center "${state.slug}" was not found.`);
  if (state.status === "error") throw new FormError(state.message);
  const viewer = viewerOf(state.session);
  if (check && !check(viewer)) throw new FormError(denied);
  return { viewer, supabase: viewer.db, centerId: viewer.center.id, tz: viewer.center.time_zone };
}

// ---------------------------------------------------------------------------
// People names and search (connect-admin lib/data/people.ts)
// ---------------------------------------------------------------------------
export type PersonOption = { id: string; name: string; detail: string | null };

function fullName(p: { first_name: string; last_name: string; preferred_name: string | null }) {
  return `${p.preferred_name || p.first_name} ${p.last_name}`.trim();
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((x): x is string => Boolean(x)))];
}

/**
 * Names for person ids. Reads `people` (RLS decides which rows come back),
 * then falls back to the opt-in `directory` view for the rest. Missing
 * names come back as undefined; callers show a neutral label.
 */
export async function resolvePeopleNames(supabase: AppSupabase, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = uniq(ids);
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data, error } = await supabase.from("people").select("id, first_name, last_name, preferred_name").in("id", unique);
  if (error) console.error("[pathshala] name lookup failed; falling back to the member directory:", error);
  for (const p of data ?? []) names.set(p.id, fullName(p));
  const rest = unique.filter((id) => !names.has(id));
  if (rest.length) {
    const { data: dir, error: dirError } = await supabase.from("directory").select("person_id, name").in("person_id", rest);
    if (dirError) console.error("[pathshala] directory name lookup failed; those names show as a neutral label:", dirError);
    for (const d of dir ?? []) if (d.person_id && d.name) names.set(d.person_id, d.name);
  }
  return names;
}

/** Names for auth user ids (approvers, authors, voters). Needs people.view to see others. */
export async function resolveUserNames(
  supabase: AppSupabase,
  centerId: string,
  userIds: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = uniq(userIds);
  const out = new Map<string, string>();
  if (!unique.length) return out;
  const { data, error } = await supabase.from("center_users").select("user_id, person_id").eq("center_id", centerId).in("user_id", unique);
  if (error) {
    console.error("[pathshala] user→person lookup failed; names show as a neutral label:", error);
    return out;
  }
  const people = await resolvePeopleNames(supabase, (data ?? []).map((r) => r.person_id));
  for (const r of data ?? []) {
    const n = people.get(r.person_id);
    if (n) out.set(r.user_id, n);
  }
  return out;
}

/** Search people by name, email or phone (RLS-limited) plus the member directory. */
export async function searchPeople(
  supabase: AppSupabase,
  centerId: string,
  query: string,
): Promise<{ people: PersonOption[]; error: string | null }> {
  const q = query.trim();
  if (q.length < 2) return { people: [], error: null };
  const safe = q.replace(/[%,()*"\\:]/g, " ").replace(/\s+/g, " ").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  if (!parts.length) return { people: [], error: null };
  let builder = supabase
    .from("people")
    .select("id, first_name, last_name, preferred_name, email, member_number")
    .eq("center_id", centerId)
    .is("merged_into_id", null)
    .limit(20);
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 7) {
    builder = builder.like("phone_e164", `%${digits.slice(-10)}`);
  } else if (safe.includes("@")) {
    builder = builder.ilike("email", `%${safe}%`);
  } else if (parts.length >= 2) {
    builder = builder.ilike("first_name", `${parts[0]}%`).ilike("last_name", `${parts.slice(1).join(" ")}%`);
  } else {
    builder = builder.or(`first_name.ilike.${safe}%,last_name.ilike.${safe}%,preferred_name.ilike.${safe}%,member_number.ilike.${safe}%`);
  }
  const { data, error } = await builder;
  if (error) {
    console.error("[pathshala] people search failed:", error);
    return { people: [], error: `The people search failed — ${explainError(error)}.` };
  }
  const found: PersonOption[] = (data ?? []).map((p) => ({
    id: p.id,
    name: fullName(p),
    detail: [p.member_number, p.email].filter(Boolean).join(" · ") || null,
  }));
  if (found.length < 20 && digits.length < 7) {
    const { data: dir, error: dirError } = await supabase
      .from("directory")
      .select("person_id, name, zone")
      .eq("center_id", centerId)
      .ilike("name", `%${safe}%`)
      .limit(20);
    if (dirError) console.error("[pathshala] directory search failed; showing people results only:", dirError);
    for (const d of dir ?? []) {
      if (d.person_id && d.name && !found.some((f) => f.id === d.person_id)) {
        found.push({ id: d.person_id, name: d.name, detail: d.zone ? `${d.zone} zone` : "Member directory" });
      }
    }
  }
  return { people: found.slice(0, 20), error: null };
}
