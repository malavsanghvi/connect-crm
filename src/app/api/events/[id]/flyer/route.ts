// The flyer maker's renderer, for the portal's own flyer panel (CRM-internal).
//
//   POST /api/events/<event id>/flyer   Content-Type: application/json
//   { design: <events.flyer_design v1>, format: "png" | "pdf", scale: "preview" | "full" }
//
// 200: the image (image/png) or, for the Print size only, a one-page US
// Letter PDF (application/pdf), private and never cached, with
// X-Flyer-Notes = encodeURIComponent(JSON string[]) — plain sentences the
// panel shows as warnings (a brand font that could not be loaded, no logo,
// Gujarati shaping). Errors are JSON { error } in plain English: 400 a design
// problem, 403 not allowed (or signed out), 404 no such event, 422 the
// background can't be used, 503 the renderer is busy, 500 anything else.
//
// The signed-in organizer's own session reads everything (the event, the
// album photo, the AI art), so the database's rules decide; the same rule as
// editing the event (events.manage or this event's lead). Nothing is saved
// here — "Use this flyer" is saveDesignedFlyerAction.

import type { NextRequest } from "next/server";

import { eventActionContext } from "@/lib/data/events";
import { explainError } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { flyerFileName, parseFlyerDesign } from "@/lib/events/flyer";
import { FlyerBackgroundError, composeFlyer } from "@/lib/events/flyer-assets";
import { FlyerFontsMissingError } from "@/lib/events/flyer-fonts";
import { FlyerBusyError, renderFlyerPdf } from "@/lib/events/flyer-render";
import { FormError } from "@/lib/events/forms";
import { isModuleEnabled } from "@/lib/modules";
import { isUuid } from "@/lib/search-params";

export const runtime = "nodejs";

const json = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/events/[id]/flyer">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return json(404, "That event was not found.");
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(400, "The flyer request must be sent as JSON.");
  }
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
    body = raw as Record<string, unknown>;
  } catch {
    return json(400, "The flyer request could not be read. Reload the page and try again.");
  }
  const format = body.format === "pdf" ? "pdf" : body.format === "png" || body.format === undefined ? "png" : null;
  const scale = body.scale === "full" ? "full" : body.scale === "preview" || body.scale === undefined ? "preview" : null;
  if (!format || !scale) return json(400, "Ask for a PNG or a PDF, as a preview or at full size.");
  const parsed = parseFlyerDesign(body.design);
  if (!parsed.ok) return json(400, parsed.error);
  const design = parsed.design;
  if (format === "pdf" && design.size !== "print") return json(400, "A PDF is made for the Print size only. Switch the size to Print, or download a PNG.");

  let c: Awaited<ReturnType<typeof eventActionContext>>;
  try {
    c = await eventActionContext((a) => eventAreas.edit(a, id), "only event managers and this event's lead can make this event's flyer.");
  } catch (err) {
    if (err instanceof FormError) return json(403, capitalize(err.message));
    console.error("[events/flyer] could not check the session:", err);
    return json(500, "Could not make the flyer — the session could not be checked. Try again.");
  }

  const ev = await c.db.from("events").select("id, center_id, name").eq("id", id).maybeSingle();
  if (ev.error) {
    console.error("[events/flyer] could not load the event:", ev.error);
    return json(500, `Could not make the flyer — ${explainError(ev.error)}.`);
  }
  if (!ev.data || ev.data.center_id !== c.centerId) return json(404, "That event was not found.");

  try {
    const made = await composeFlyer({
      db: c.db,
      centerId: c.centerId,
      centerName: c.session.center.name,
      branding: c.session.center.branding,
      eventId: id,
      design,
      scale,
      contentModuleOn: isModuleEnabled(c.session, "content"),
    });
    const bytes = format === "pdf" ? await renderFlyerPdf(made.png, design.headline) : made.png;
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": format === "pdf" ? "application/pdf" : "image/png",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${flyerFileName(ev.data.name, design.size, format)}"`,
        "X-Flyer-Notes": encodeURIComponent(JSON.stringify(made.notes)),
      },
    });
  } catch (err) {
    if (err instanceof FlyerBackgroundError) return json(422, err.message);
    if (err instanceof FlyerBusyError) return json(503, err.message);
    if (err instanceof FlyerFontsMissingError) return json(500, `Could not make the flyer — ${err.message.toLowerCase()} Ask Weaver to redeploy.`);
    console.error(`[events/flyer] rendering the flyer for event ${id} failed:`, err);
    return json(500, "Could not make the flyer — the image renderer failed. Try again, or choose a different background.");
  }
}
