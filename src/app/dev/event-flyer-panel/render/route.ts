// DEV ONLY. The flyer renderer for the panel's preview (/dev/event-flyer-panel), without a database or a session: the same
// renderFlyerPng the real route uses (POST /api/events/<id>/flyer), with the sample organization's brand kit and a drawn
// background. Photos and AI pictures need storage, so they are refused here. 404 in production.
//
//   POST /dev/event-flyer-panel/render   { design, kind: "church" | "chamber" | "temple" | "club", org?: the name in the footer }

import { devPreviewAllowed } from "@/lib/dev-preview";
import { memberAppEventLink, parseFlyerDesign } from "@/lib/events/flyer";
import { patternSvg } from "@/lib/events/flyer-patterns";
import { backgroundBox, flyerDims, patternColorsFor, renderFlyerPng } from "@/lib/events/flyer-render";

import { FIXTURES, PREVIEW_APP, brandForKind, isPreviewKind } from "../fixtures";

export const runtime = "nodejs";

const json = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  if (!devPreviewAllowed()) return new Response("Not found", { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(400, "The flyer request could not be read.");
  }
  const parsed = parseFlyerDesign(body.design);
  if (!parsed.ok) return json(400, parsed.error);
  const design = parsed.design;
  const f = FIXTURES[isPreviewKind(body.kind) ? body.kind : "church"];
  const brand = brandForKind(body.kind);
  const org = typeof body.org === "string" && body.org.trim() ? body.org.trim().slice(0, 80) : f.org;
  const dims = flyerDims(design.size, "preview");
  let background = null;
  if (design.template !== "poster") {
    if (design.background.source === "pattern") {
      const box = backgroundBox(design.template, dims);
      const svg = patternSvg(design.background.pattern, { w: box.w, h: box.h, ...patternColorsFor(design.template, brand) });
      background = { dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, w: box.w, h: box.h };
    } else if (design.background.source !== "plain") {
      return json(422, "The dev preview has no photos or AI pictures. Choose a drawn background.");
    }
  }
  const r = await renderFlyerPng(
    {
      design,
      brand,
      centerName: org,
      background,
      logo: null,
      logoDark: null,
      qrLink: memberAppEventLink(PREVIEW_APP, f.event.id),
      posterAssets: { frame: null, scene: null, partnerLogo: null },
    },
    "preview",
  );
  return new Response(Buffer.from(r.png), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Flyer-Notes": encodeURIComponent(JSON.stringify(r.notes)) },
  });
}
