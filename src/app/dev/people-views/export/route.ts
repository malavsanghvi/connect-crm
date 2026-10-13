import type { NextRequest } from "next/server";

import { devPreviewAllowed } from "@/lib/dev-preview";
import { toCsv } from "@/lib/import/templates";
import { filtersFromParams, NO_FILTERS } from "@/lib/people-v2/ask";

import { exportLines, GAP_FILTERS } from "../fixtures";

/** DEV ONLY. The preview's stand-in for the Export button: the invented list as a CSV, with no 2FA check. Not found in production. */
export async function GET(request: NextRequest) {
  if (!devPreviewAllowed()) return new Response("Not found\n", { status: 404 });
  const flat = Object.fromEntries(request.nextUrl.searchParams);
  const asked = filtersFromParams(flat);
  const filters = Object.values(asked).some((v) => v !== null) ? asked : { ...NO_FILTERS, ...GAP_FILTERS };
  return new Response(String.fromCharCode(0xfeff) + toCsv(exportLines(filters)), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="adults-with-no-email.csv"' },
  });
}
