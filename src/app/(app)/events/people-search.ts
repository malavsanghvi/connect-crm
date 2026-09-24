"use server";

import { searchPeople, type PersonOption } from "@/lib/data/events";
import type { ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";

/** People search for pickers. Runs as the signed-in user, so RLS decides who can be found. */
export async function searchPeopleAction(query: string): Promise<ActionResult<PersonOption[]>> {
  const auth = await authorizeAction("dashboard", "search people");
  if (!auth.ok) return auth;
  const { people, error } = await searchPeople(auth.session.db, auth.session.center.id, query);
  if (error) return { ok: false, error };
  return { ok: true, data: people };
}
