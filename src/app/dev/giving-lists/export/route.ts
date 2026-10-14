import type { NextRequest } from "next/server";

import { devPreviewAllowed } from "@/lib/dev-preview";
import { exportFileName, exportListFromParam } from "@/lib/giving-export/csv";
import { LISTS_COMMUNITY, ROWING_CLUB, sampleExportLines, type ListsRole } from "@/lib/giving-lists/fixtures";
import { toCsv } from "@/lib/import/templates";

const ROLES: readonly ListsRole[] = ["treasurer", "approver", "volunteer"];

/**
 * DEV ONLY. The preview's stand-in for Giving's export route: the invented Payments or Pledges list as the real file looks (the
 * watermark, the header, the rows), with no 2FA check and no audit entry. Not found in production.
 */
export async function GET(request: NextRequest) {
  if (!devPreviewAllowed()) return new Response("Not found\n", { status: 404 });
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const list = exportListFromParam(sp.list) ?? "payments";
  const role = ROLES.find((r) => r === sp.role) ?? "treasurer";
  const community = sp.community === "rowing" ? ROWING_CLUB : LISTS_COMMUNITY;
  const lines = sampleExportLines(list, role, sp, community);
  return new Response(String.fromCharCode(0xfeff) + toCsv(lines), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(list, { chips: {}, search: null }, "2026-10-12")}"`,
    },
  });
}
