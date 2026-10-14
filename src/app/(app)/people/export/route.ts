import { NextResponse, type NextRequest } from "next/server";

import { withActivity } from "@/lib/activity/with-activity";
import { todayInTz } from "@/lib/dates";
import { explainError, isStepUpError } from "@/lib/errors";
import { toCsv } from "@/lib/import/templates";
import { relationshipLabel } from "@/lib/people";
import { canAccess } from "@/lib/permissions";
import { effectiveBand, filtersFromParams, hasGap, listFor, listHeading, paramsFromFilters, type HouseholdFilters } from "@/lib/people-v2/ask";
import { exportFileName, HOUSEHOLD_EXPORT_HEADER, householdExportLines, PEOPLE_EXPORT_HEADER, peopleExportLines } from "@/lib/people-v2/gaps";
import { loadExportCards, loadGapPeople } from "@/lib/people-v2/gap-load";
import { loadFilteredHouseholds, loadZones } from "@/lib/people-v2/load";
import { sortKey } from "@/lib/people-v2/list";
import { loadSession, type CrmSession } from "@/lib/session";

// Export of a list on the People screen (the New look): the families, or the ADULTS of a people list such as "adults with no email". It
// follows the rule of the other exports (events/feedback/export): the database asks for a fresh 2FA check (app.record_export, 0154), the
// export is audited as export.<kind> with counts only (never the data), and a request without the check is answered 403 with the
// x-step-up header so the page opens the step-up box and tries once more. A child's record is never part of an export from here: the
// people list is adults only, whatever age band the address asks for, and a family's name has any child's first name taken out.

const BOM = "\uFEFF";
const MAX_FAMILIES = 100_000;

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function stepUp() {
  return new NextResponse("Could not export the list — this needs a fresh 2FA check.\n", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "x-step-up": "required" },
  });
}

function csvResponse(lines: readonly (readonly unknown[])[], fileName: string) {
  return new NextResponse(BOM + toCsv(lines), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"` } });
}

/** The words of the filters that are set, for the audit entry: which filters, never their values (a typed search can be a name). */
function filterKeys(f: HouseholdFilters): string[] {
  return Object.keys(paramsFromFilters({ ...f, q: null })).sort();
}

export async function GET(request: NextRequest) {
  return withActivity("people.export_list", () => run(request));
}

async function run(request: NextRequest): Promise<NextResponse> {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not export the list — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not export the list — the app could not load your session.", 500);
  const session = state.session;
  // Exporting hands over contact details in bulk, so it needs permission to manage people (people.manage), not only to view them.
  if (!canAccess(session, "householdsEdit")) return problem("Could not export the list — you don't have access to this area. Exporting a list needs permission to manage people.", 403);

  const sp: Record<string, string> = {};
  for (const [k, v] of request.nextUrl.searchParams) if (!(k in sp)) sp[k] = v;
  const filters = filtersFromParams(sp);
  const list = sp.list === "people" || sp.list === "households" ? sp.list : listFor(filters);

  if (list === "people" && !hasGap(filters) && effectiveBand(filters) === "minors") {
    return problem("Could not export the list — a list of children is not exported. Choose adults, or another list.", 400);
  }

  // Ask for the fresh 2FA check first, so a person without it is not made to wait for the list to be read.
  const asked = await session.db.rpc("assert_step_up", { p_action: `export.${list === "people" ? "people_list" : "household_list"}` });
  if (asked.error) {
    if (isStepUpError(asked.error)) return stepUp();
    console.error("[people export] the step-up check failed:", asked.error);
    return problem(`Could not export the list — ${explainError(asked.error)}.`, 500);
  }

  return list === "people" ? exportPeople(session, filters) : exportHouseholds(session, filters, sortKey(sp.sort));
}

async function record(session: CrmSession, kind: "people_list" | "household_list", rows: number, filters: HouseholdFilters): Promise<NextResponse | null> {
  const res = await session.db.rpc("record_export", { p_center: session.center.id, p_kind: kind, p_detail: { rows, filters: filterKeys(filters) } });
  if (!res.error) return null;
  if (isStepUpError(res.error)) return stepUp();
  console.error("[people export] record_export failed:", res.error);
  return problem(`Could not export the list — ${explainError(res.error)}.`, 500);
}

async function exportPeople(session: CrmSession, filters: HouseholdFilters): Promise<NextResponse> {
  const today = todayInTz(session.center.time_zone);
  const data = await loadGapPeople(session, filters);
  if (data.failed) return problem(`Could not export the list — ${data.problems[0]?.what ?? "the people"} could not be read: ${data.problems[0]?.message ?? "try again"}.`, 500);
  const cards = await loadExportCards(session, data.people.flatMap((p) => (p.household ? [p.household.id] : [])));
  if (cards.error) {
    console.error("[people export] the household cards failed:", cards.error);
    return problem(`Could not export the list — the household cards could not be read: ${explainError(cards.error)}.`, 500);
  }
  const blocked = await record(session, "people_list", data.people.length, filters);
  if (blocked) return blocked;
  const lines = [[...PEOPLE_EXPORT_HEADER], ...peopleExportLines(data.people, cards.cards, (role) => (role ? relationshipLabel(role, null) : ""), today)];
  return csvResponse(lines, exportFileName(listHeading(filters) ?? "people", today));
}

async function exportHouseholds(session: CrmSession, filters: HouseholdFilters, sort: ReturnType<typeof sortKey>): Promise<NextResponse> {
  const zonesRes = await loadZones(session);
  if (zonesRes.error) {
    console.error("[people export] the areas failed:", zonesRes.error);
    return problem(`Could not export the list — the areas could not be read: ${explainError(zonesRes.error)}.`, 500);
  }
  const zoneName = new Map(zonesRes.zones.map((z) => [z.id, z.name]));
  const found = await loadFilteredHouseholds(session, filters, { sort, zones: zonesRes.zones });
  if (found.fails.length > 0) return problem(`Could not export the list — ${found.fails[0].what} could not be read: ${explainError(found.fails[0].error)}.`, 500);
  if (found.sorted.length > MAX_FAMILIES) return problem(`Could not export the list — it has more than ${MAX_FAMILIES.toLocaleString("en-US")} families. Narrow it with a filter.`, 400);
  const cards = await loadExportCards(session, found.sorted.map((h) => h.id));
  if (cards.error) {
    console.error("[people export] the household cards failed:", cards.error);
    return problem(`Could not export the list — the household cards could not be read: ${explainError(cards.error)}.`, 500);
  }
  const blocked = await record(session, "household_list", found.sorted.length, filters);
  if (blocked) return blocked;
  const withBalance = found.giving && found.balanceMap !== null;
  const header = [...HOUSEHOLD_EXPORT_HEADER, ...(withBalance ? ["Open balance"] : [])];
  const zoneOf = new Map(found.sorted.map((h) => [h.id, h.zoneId]));
  const areaOf = (id: string) => {
    const zone = zoneOf.get(id);
    return (zone ? zoneName.get(zone) : null) ?? null;
  };
  const rows = found.sorted.map((h) => ({ id: h.id, number: h.number, openCents: found.balanceMap ? (found.balanceMap.get(h.id) ?? 0) : null }));
  return csvResponse([header, ...householdExportLines(rows, cards.cards, { withBalance, areaOf })], exportFileName("families", todayInTz(session.center.time_zone)));
}
