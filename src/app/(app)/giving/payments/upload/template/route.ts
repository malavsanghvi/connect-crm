import { NextResponse, type NextRequest } from "next/server";
import writeXlsxFile from "write-excel-file/node";

import { uploadSetting } from "@/lib/data/giving-upload";
import { donationColumns, donationTemplateRows } from "@/lib/giving-upload/donations";
import { toCsv } from "@/lib/import/templates";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The donations upload template, in the community's words, money and dates: CSV, or Excel with a sheet that explains each column. */
export async function GET(request: NextRequest) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not download the template — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not download the template — the app could not load your session.", 500);
  const session = state.session;
  if (!canAccess(session, "recordPayment")) return problem("Could not download the template — you don't have access to this area.", 403);
  if (!isModuleEnabled(session, "giving")) return problem(`Could not download the template — ${moduleOffMessage("giving", session.center.name)}`, 403);
  const s = uploadSetting(session);
  const rows = donationTemplateRows({ household: s.household }, s.conv);
  if (request.nextUrl.searchParams.get("format") === "xlsx") {
    try {
      const text = (v: string) => ({ value: v, type: String });
      const bold = (v: string) => ({ value: v, type: String, fontWeight: "bold" as const });
      const buffer = await writeXlsxFile([
        // Every cell is text, so IDs and check numbers keep their leading zeros.
        { sheet: "Donations", data: [rows[0].map(bold), ...rows.slice(1).map((r) => r.map(text))] },
        {
          sheet: "Columns",
          data: [
            ["Column", "Required", "What goes in it"].map(bold),
            ...donationColumns({ household: s.household }).map((c) => [text(c.header), text(c.required ? "Required" : "Optional"), text(c.help)]),
          ],
        },
      ]).toBuffer();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="donations-upload-template.xlsx"',
        },
      });
    } catch (err) {
      console.error("[donation upload template] building the Excel file failed:", err);
      return problem("Could not build the Excel template. Download the CSV template instead.", 500);
    }
  }
  return new NextResponse(toCsv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="donations-upload-template.csv"' },
  });
}
