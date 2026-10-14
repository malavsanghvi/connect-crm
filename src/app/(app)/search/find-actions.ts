"use server";

import { findRecords } from "@/lib/data/find";
import { failure } from "@/lib/errors";
import type { FindScope } from "@/lib/find/giving";
import { canFindGiving } from "@/lib/giving-actions/context";
import type { FindResult } from "@/lib/find/types";
import { canAccess } from "@/lib/permissions";
import { authorizeActionWhere } from "@/lib/session";

/**
 * The find box (top bar, People home, Giving's Today): families and people by name in any script, phone digits, email, member numbers
 * and old or system IDs, as the signed-in person's own access allows; and, for people who work with Giving, its lane: payments by
 * receipt number or amount, pledges by number, bank lines, campaigns, and a payment to record ("200 check patel"). READ ONLY: it
 * changes nothing (a payment is recorded by the Record payment sheet's own button). The finance identifiers (QuickBooks, bank payer
 * names) are only matched for people who may read finance; children come back only as "Child · staff only" rows, never in Giving.
 */
export async function findAction(rawQuery: string, opts?: { scope?: FindScope }): Promise<FindResult> {
  const auth = await authorizeActionWhere((s) => canAccess(s, "households") || canFindGiving(s), "search", "people.view, people.manage or a Giving permission");
  if (!auth.ok) {
    // A role that cannot open People or Giving gets the same plain sentence as every other area, not an empty list.
    return { ok: false, error: /don't have permission/.test(auth.error) ? "You don't have access to this area." : auth.error };
  }
  const { session } = auth;
  try {
    const data = await findRecords(session, typeof rawQuery === "string" ? rawQuery : "", {
      scope: opts?.scope === "giving" ? "giving" : "people",
      people: canAccess(session, "households"),
      giving: canFindGiving(session),
    });
    return { ok: true, data };
  } catch (error) {
    const res = failure("Could not search", error);
    return { ok: false, error: res.error };
  }
}
