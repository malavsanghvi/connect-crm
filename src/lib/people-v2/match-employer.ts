import "server-only";

import { userNames } from "@/lib/data/lookups";
import { explainError } from "@/lib/errors";
import { matchingCan } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { part, type Part } from "./slideover";

// The person's employer for gift matching (CatchTheMatch, migration 0759): on file only with the person's consent, adults only,
// read by CatchTheMatch's own roles (matching.view or matching.manage; never a platform admin as such). It is NOT the profile's
// "Employer" (people.employer): that one is only offered to confirm. Read as the signed-in person: the database decides what comes back.

export type MatchEmployerFacts = {
  /** What is on file, or null. */
  employer: string | null;
  /** member: the person gave it in the app; paper_form: the office recorded it from a signed paper form. */
  source: "member" | "paper_form" | null;
  recordedAt: string | null;
  /** Who recorded it (a paper form only). */
  recordedBy: string | null;
  /** The profile's employer, offered to prefill a paper form; null when something is on file already. */
  suggestion: string | null;
  /** matching.manage: may record one from a signed paper form. */
  canRecord: boolean;
};

export async function loadMatchEmployer(session: CrmSession, person: { id: string; profileEmployer: string | null }): Promise<Part<MatchEmployerFacts>> {
  if (!matchingCan(session, "view")) return part.noAccess();
  const { db, center } = session;
  const r = await db
    .from("person_match_employers")
    .select("employer_name, source, recorded_by, consented_at")
    .eq("center_id", center.id)
    .eq("person_id", person.id)
    .maybeSingle();
  if (r.error) {
    console.error("[match-employer] the employer for gift matching could not be read:", r.error);
    return part.error(`Could not load the employer for gift matching: ${explainError(r.error)}`);
  }
  // A withdrawn record keeps no employer (0759): it reads as nothing on file.
  const row = r.data?.employer_name ? r.data : null;
  const source = row?.source === "member" || row?.source === "paper_form" ? row.source : null;
  let recordedBy: string | null = null;
  if (row && source === "paper_form") {
    const names = await userNames(db, center.id, [row.recorded_by]);
    recordedBy = names.get(row.recorded_by)?.name ?? "someone in the office";
  }
  const profile = person.profileEmployer?.trim() || null;
  return part.ok({
    employer: row?.employer_name ?? null,
    source,
    recordedAt: row?.consented_at ?? null,
    recordedBy,
    suggestion: row ? null : profile,
    canRecord: matchingCan(session, "manage"),
  });
}

/** The line under the employer: where it came from and when. */
export function matchEmployerSourceLine(f: Pick<MatchEmployerFacts, "source" | "recordedBy">, firstName: string, when: string | null): string {
  const at = when ? `, ${when}` : "";
  if (f.source === "paper_form") return `From a signed paper form, recorded by ${f.recordedBy ?? "someone in the office"}${at}. ${firstName} can see and remove it in the member app.`;
  if (f.source === "member") return `Added by ${firstName} in the member app${at}. Only ${firstName} can change it.`;
  return "";
}
