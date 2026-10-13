import { NextResponse, type NextRequest } from "next/server";

import { withActivity } from "@/lib/activity/with-activity";
import { readGivingExport } from "@/lib/data/giving-export";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { explainError, isStepUpError, type DbErrorLike } from "@/lib/errors";
import { auditDetail, exportFileName, exportListFromParam, watermarkLine } from "@/lib/giving-export/csv";
import { toCsv } from "@/lib/import/templates";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";

// Export of a Giving list for the treasurer (docs/GIVING_REDESIGN.md slice 9; owner decisions 2026-10-13): Payments (All payments
// or Refunds) and Pledges, with the list's own filters (src/lib/data/giving-export.ts reads them through the list's queries).
//   1. data.export (the one data-export permission, held by treasurers): without it, 403 in words before anything is read.
//   2. app.giving_export_check (0747): the list's read permission, Giving (and its add-on) on, an authenticator, and a 2FA code that
//      no earlier Giving export used: one code, one file. A request without one is answered 403 with x-step-up, so the page asks
//      for a code and tries once more (the Export sheet asks for the code first).
//   3. The rows are read; a part that cannot be read stops the export (a file is never silently partial).
//   4. app.record_giving_export writes the audit entry export.giving_<list>: the count, the chips and whether a search was used,
//      never the file and never a search's text. Only then is the file sent.
// The file: a watermark line (community, who, when, the list and filter, the count), the header, the rows. A child's name is never
// in it (households are named by the adults' household card).

const BOM = "﻿";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function stepUp() {
  return new NextResponse("Could not export the list — each export needs a fresh code from your authenticator app.\n", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8", "x-step-up": "required" },
  });
}

/** Our own functions refuse in plain English (permission, a module that is off); Postgres' own refusals are explained. */
function refusal(error: DbErrorLike): { message: string; status: number } {
  const msg = (error.message ?? "").trim();
  const ours = msg !== "" && !/permission denied|row-level security/i.test(msg);
  if (error.code === "42501") return { message: ours ? msg : explainError(error), status: 403 };
  if (error.code === "22023") return { message: msg || explainError(error), status: 400 };
  return { message: explainError(error), status: 500 };
}

export async function GET(request: NextRequest) {
  return withActivity("giving.export_list", () => run(request));
}

async function run(request: NextRequest): Promise<NextResponse> {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not export the list — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not export the list — the app could not load your session.", 500);
  const session = state.session;
  if (!canAccess(session, "givingExport")) {
    return problem("Could not export the list — you don't have access to this area. Exporting needs the data-export permission; ask your administrator.", 403);
  }
  const sp: Record<string, string> = {};
  for (const [k, v] of request.nextUrl.searchParams) if (!(k in sp)) sp[k] = v;
  const list = exportListFromParam(sp.list);
  if (!list) return problem("Could not export the list — choose Payments or Pledges.", 400);

  // The code first, so a person without a fresh one is not made to wait for the list to be read.
  const checked = await session.db.rpc("giving_export_check", { p_center: session.center.id, p_list: list });
  if (checked.error) {
    if (isStepUpError(checked.error)) return stepUp();
    const r = refusal(checked.error);
    if (r.status === 500) console.error("[giving export] the export check failed:", checked.error);
    return problem(`Could not export the list — ${r.message}`, r.status);
  }

  const read = await readGivingExport(session, list, sp);
  if (!read.ok) return problem(read.error, read.status);

  const recorded = await session.db.rpc("record_giving_export", { p_center: session.center.id, p_list: list, p_detail: auditDetail(read.filter, read.count) });
  if (recorded.error) {
    if (isStepUpError(recorded.error)) return stepUp();
    const r = refusal(recorded.error);
    console.error("[giving export] recording the export failed:", recorded.error);
    return problem(`Could not export the list — ${r.message} Nothing was exported.`, r.status);
  }

  const tz = session.center.time_zone;
  const now = new Date();
  const mark = watermarkLine({
    community: session.center.name,
    who: session.person?.name ?? "A staff member",
    email: session.email,
    at: `${formatDateTime(now.toISOString(), tz)} (${tz})`,
    list,
    filter: read.filter,
    rows: read.count,
  });
  const body = BOM + toCsv([[mark], read.header, ...read.lines]);
  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(list, read.filter, todayInTz(tz, now))}"`,
      "cache-control": "no-store",
    },
  });
}
