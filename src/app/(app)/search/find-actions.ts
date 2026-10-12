"use server";

import { findRecords } from "@/lib/data/find";
import { failure } from "@/lib/errors";
import type { FindResult } from "@/lib/find/types";
import { authorizeAction } from "@/lib/session";

/**
 * The find box (top bar and People home): families and people by name in any script, phone digits, email, member numbers and
 * old or system IDs, as the signed-in person's own access allows. READ ONLY: it changes nothing. The finance identifiers (QuickBooks,
 * bank payer names) are only matched for people who may read finance; children come back only as "Child · staff only" rows.
 */
export async function findAction(rawQuery: string): Promise<FindResult> {
  const auth = await authorizeAction("households", "search");
  if (!auth.ok) {
    // A role that cannot open People gets the same plain sentence as every other area, not an empty list.
    return { ok: false, error: /don't have permission/.test(auth.error) ? "You don't have access to this area." : auth.error };
  }
  try {
    return { ok: true, data: await findRecords(auth.session, typeof rawQuery === "string" ? rawQuery : "") };
  } catch (error) {
    const res = failure("Could not search", error);
    return { ok: false, error: res.error };
  }
}
