import { NextResponse, type NextRequest } from "next/server";

import { explainError } from "@/lib/errors";
import type { Problem } from "@/lib/import/mapping";
import { problemRowsCsv } from "@/lib/import/templates";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The rows of one run that had a problem or failed: the original row plus what is wrong. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not download the problem rows — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not download the problem rows — the app could not load your session.", 500);
  if (!canAccess(state.session, "dataImport")) return problem("Could not download the problem rows — you don't have access to Data import.", 403);
  const { id } = await params;
  if (!isUuid(id)) return problem("Could not download the problem rows — that import was not found.", 404);
  const { db } = state.session;
  const run = await db.rpc("import_run_get", { p_run: id });
  if (run.error) {
    console.error("[import problems] run read failed:", run.error);
    return problem(`Could not download the problem rows — ${explainError(run.error)}.`, 500);
  }
  const r = run.data as { run_number: number; file_name: string | null; mapping: { headers?: string[] } | null };
  const rows = await db.from("import_rows").select("row_no, raw, problems, status, message").eq("run_id", id).order("row_no").limit(50000);
  if (rows.error) {
    console.error("[import problems] rows read failed:", rows.error);
    return problem(`Could not download the problem rows — ${explainError(rows.error)}.`, 500);
  }
  const list = (rows.data ?? []).map((x) => {
    const probs = (Array.isArray(x.problems) ? x.problems : []) as Problem[];
    const extra: Problem[] = x.status === "failed" && x.message && !probs.some((p) => p.message === x.message) ? [{ level: "error", column: null, message: x.message }] : [];
    const raw = x.raw && typeof x.raw === "object" && !Array.isArray(x.raw) ? (x.raw as Record<string, string>) : {};
    return { row_no: x.row_no, raw, problems: [...probs, ...extra] };
  });
  const headers = r.mapping?.headers?.length ? r.mapping.headers : [...new Set(list.flatMap((x) => Object.keys(x.raw)))];
  const name = `import-${r.run_number}-problem-rows.csv`;
  return new NextResponse(problemRowsCsv(headers, list), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"` },
  });
}
