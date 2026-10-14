// The PDF of one pledge, drawn like an invoice with the community's own branding: GET /giving/pledges/<pledge id>/pdf
//
// For whoever the Pledges list shows the pledge to (giving.view or giving.manage), in their own community: the database decides
// again (app.pledge_document, 0791), and a pledge of another community is "not found". 200 is application/pdf shown inline with a file
// name made from the pledge's number and the community's name; anything else is a short plain-English sentence as text (the Print
// button shows it next to the pledge, with a retry). Nothing is saved and nothing is sent: this is the copy staff print, and the
// background service draws the same page (src/lib/pledge-pdf) for the email's attachment.

import type { NextRequest } from "next/server";

import { rpcJson } from "@/lib/commands/catalog/db";
import { communityMajority } from "@/lib/commands/child-filter";
import { CommandDbError } from "@/lib/commands/types";
import { explainError } from "@/lib/errors";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { buildPledgeDocument, type PledgeDocData } from "@/lib/pledge-pdf/document";
import { firstDrawableLogo } from "@/lib/pledge-pdf/logo";
import { renderPledgePdf } from "@/lib/pledge-pdf/render";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";

export const runtime = "nodejs";

function problem(message: string, status: number) {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

/** One of the community's own logo files: the public branding bucket only, a few seconds at most, never an error for the PDF. */
async function fetchLogo(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/giving/pledges/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem("Could not make the pledge PDF — that address does not name a pledge.", 404);
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not make the pledge PDF — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not make the pledge PDF — the app could not load your session. Try again.", 500);
  const session = state.session;
  if (!canAccess(session, "pledgeCopy")) return problem("Could not make the pledge PDF — you don't have access to this area.", 403);
  if (!isModuleEnabled(session, "giving")) return problem(`Could not make the pledge PDF — ${moduleOffMessage("giving", session.center.name)}`, 403);

  let data: PledgeDocData | null;
  try {
    data = (await rpcJson(
      session.db,
      "pledge_document",
      { p_center: session.center.id, p_pledge: id, p_majority: communityMajority(session.center) },
      "read the pledge",
    )) as PledgeDocData | null;
  } catch (error) {
    const db = error instanceof CommandDbError ? error.dbError : error;
    console.error("[pledge pdf] could not read the pledge:", db);
    const code = (db as { code?: string } | null)?.code;
    if (code === "P0002") return problem("Could not make the pledge PDF — that pledge was not found.", 404);
    if (code === "42501") return problem("Could not make the pledge PDF — you don't have access to this area.", 403);
    return problem(`Could not make the pledge PDF — ${explainError(db)}. Try again.`, 500);
  }
  if (!data || !data.pledge) return problem("Could not make the pledge PDF — that pledge was not found.", 404);

  try {
    const view = buildPledgeDocument(data, { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null });
    const logo = await firstDrawableLogo(view.logoUrls, fetchLogo);
    const { bytes } = await renderPledgePdf(view, logo);
    const body = new Uint8Array(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${view.fileName}"`,
        "content-length": String(body.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[pledge pdf] could not draw the PDF:", error);
    return problem("Could not make the pledge PDF — it could not be drawn. Try again; if it keeps failing, tell Weaver support.", 500);
  }
}
