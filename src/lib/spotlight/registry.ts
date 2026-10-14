// Which tours a person has. Decided on the server for the signed-in person (role they hold, screens they can open, modules the
// community has on), so a person who has no tour is sent nothing and sees no entry point. Convenience only: the screens themselves
// are protected by the database (RLS), and the tour only ever shows what the person can already open.

import { isModuleEnabled } from "@/lib/modules";
import { canAccess, type ScopedContext } from "@/lib/permissions";

import { TOURS } from "./tours";
import type { TourDef } from "./types";

/** True when the person holds one of the roles for the whole community (a role for one event, class or zone is not enough). */
export function holdsPersona(ctx: Pick<ScopedContext, "grants">, persona: readonly string[]): boolean {
  return (ctx.grants ?? []).some((g) => g.scope_kind === "center" && persona.includes(g.role_key));
}

/**
 * The person's role, plus the screens and modules the tour passes through. Being the owner or a platform admin does not make someone
 * a treasurer: a tour is for the person who does that work, so the role itself must be held.
 */
export function tourQualifies(tour: TourDef, ctx: ScopedContext): boolean {
  if (!holdsPersona(ctx, tour.persona)) return false;
  for (const key of tour.requires.access ?? []) if (!canAccess(ctx, key)) return false;
  for (const key of tour.requires.modules ?? []) if (!isModuleEnabled(ctx, key)) return false;
  return true;
}

/** The tours for this person, in the order they are listed. Plain data, safe to hand to a client component. */
export function toursFor(ctx: ScopedContext, all: readonly TourDef[] = TOURS): TourDef[] {
  return all.filter((t) => tourQualifies(t, ctx));
}
