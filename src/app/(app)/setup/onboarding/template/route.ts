import { NextResponse, type NextRequest } from "next/server";
import writeXlsxFile from "write-excel-file/node";

import { donationTemplateExample, donationTemplateHeader, PAYER_FIELDS } from "@/lib/onboarding/donations";
import { PERSON_FIELDS, personTemplateExample, personTemplateHeader } from "@/lib/onboarding/people";
import { toCsv } from "@/lib/import/templates";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";

function problem(message: string, status: number) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** The past-donations template for the onboarding flow: CSV, or Excel with a column guide sheet. */
export async function GET(request: NextRequest) {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not download the template — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not download the template — the app could not load your session.", 500);
  if (!canAccess(state.session, "dataImport")) return problem("Could not download the template — you don't have access to Data import.", 403);
  const format = request.nextUrl.searchParams.get("format") ?? "csv";
  const kind = request.nextUrl.searchParams.get("kind") === "people" ? "people" : "donations";
  const header = kind === "people" ? personTemplateHeader() : donationTemplateHeader();
  const example = kind === "people" ? personTemplateExample() : donationTemplateExample();
  const fields = kind === "people" ? PERSON_FIELDS : PAYER_FIELDS;
  const base = kind === "people" ? "members-and-family-template" : "past-donations-template";
  const sheet = kind === "people" ? "People" : "Donations";
  if (format === "xlsx") {
    try {
      const text = (v: string, bold = false) => ({ value: v, type: String, ...(bold ? { fontWeight: "bold" as const } : {}) });
      const buffer = await writeXlsxFile([
        { sheet, data: [header.map((h) => text(h, true)), example.map((v) => text(v))] },
        {
          sheet: "Columns",
          data: [
            ["Column", "Needed", "What goes in it"].map((h) => text(h, true)),
            ...fields.map((f) => [text(f.label), text(f.required ? "Required" : "Optional"), text(f.hint || "")]),
            [text("Any other column"), text("Optional"), text("Kept as custom data, so nothing you upload is lost.")],
          ],
        },
      ]).toBuffer();
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${base}.xlsx"`,
        },
      });
    } catch (error) {
      console.error("[onboarding/template] could not build the Excel template:", error);
      return problem("Could not build the Excel template. Download the CSV instead, or try again.", 500);
    }
  }
  return new NextResponse(toCsv([header, example]), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` },
  });
}
