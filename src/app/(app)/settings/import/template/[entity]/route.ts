import { NextResponse, type NextRequest } from "next/server";
import writeXlsxFile from "write-excel-file/node";

import { entityDef } from "@/lib/import/registry";
import { dictionary, dictionaryCsv, templateCsv, templateExample, templateHeader } from "@/lib/import/templates";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** Template for one data type: CSV, Excel (data + column dictionary sheets) or the dictionary alone. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not download the template — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not download the template — the app could not load your session.", 500);
  if (!canAccess(state.session, "dataImport")) return problem("Could not download the template — you don't have access to Data import.", 403);
  const { entity: key } = await params;
  const e = entityDef(key);
  if (!e) return problem("Could not download the template — the import tool does not load that kind of data.", 404);
  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  const base = `${e.key.replace(/_/g, "-")}-template`;
  if (format === "dictionary") {
    return new NextResponse(dictionaryCsv(e), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${e.key.replace(/_/g, "-")}-columns.csv"` },
    });
  }
  if (format === "xlsx") {
    try {
      const text = (v: string) => ({ value: v, type: String });
      const dict = dictionary(e);
      const buffer = await writeXlsxFile([
        {
          sheet: "Data",
          // Every column is text so identifiers keep their leading zeros.
          data: [templateHeader(e).map((h) => ({ value: h, type: String, fontWeight: "bold" as const })), templateExample(e).map(text)],
        },
        {
          sheet: "Columns",
          data: [
            ["Column", "Required", "Type", "What it is", "Example", "Allowed values"].map((h) => ({ value: h, type: String, fontWeight: "bold" as const })),
            ...dict.map((d) => [d.column, d.required, d.type, d.description, d.example, d.allowed].map(text)),
            [text("Any other column"), text("Optional"), text("Kept as a custom field"), text("Columns with no matching field are kept as custom fields (staff-only until reviewed)."), text(""), text("")],
          ],
        },
      ]).toBuffer();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${base}.xlsx"`,
        },
      });
    } catch (err) {
      console.error("[import template] building the Excel file failed:", err);
      return problem("Could not build the Excel template. Download the CSV template instead.", 500);
    }
  }
  return new NextResponse(templateCsv(e), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
  });
}
