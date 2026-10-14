import { checklistCsv } from "@/lib/onboarding-checklist";

// The downloadable "get ready" checklist (public, no sign-in). Served at www.<domain>/get-ready/checklist.csv.
export const dynamic = "force-static";

export function GET() {
  return new Response(checklistCsv(), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="weaver-onboarding-checklist.csv"',
      "cache-control": "public, max-age=3600",
    },
  });
}
