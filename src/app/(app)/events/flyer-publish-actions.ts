"use server";

// The event creator's flyer and publish panel (src/components/event-creator/flyer/flyer-panel.tsx, 2026-10-11).
//
// The flyer itself is made, saved and approved by the existing flyer maker (POST /api/events/<id>/flyer renders the
// preview, saveDesignedFlyerAction saves it, with { approve: true } recording the approval inside the design). This file
// adds what the panel needs around it:
//   loadFlyerPanelAction            what the panel starts from (the event, the saved design, the brand kit, AI art status)
//   withdrawFlyerApprovalAction     take the approval back (a scheduled publish is cancelled with it)
//   publishEventNowAction           the existing events.set_status command (draft -> published), after the same checks the
//                                   background service makes: the approved flyer, and the readiness list's publish blockers
//   scheduleEventPublishAction      set events.publish_at (0700); the background service publishes at that time
//   cancelScheduledPublishAction    clear it
// Every write runs as the signed-in person, so the database's policies decide (the people who may edit the event). Publishing
// now records events.set_status; the others record the keys 0701 lists.

import { revalidatePath } from "next/cache";

import { runCommandFromScreen, setEventStatusCommand } from "@/lib/commands/catalog/events";
import { SET_STATUS_DENIED } from "@/lib/commands/catalog/events/set-status";
import { eventActionContext } from "@/lib/data/events";
import type { Json } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { eventAreas } from "@/lib/events/access";
import { defaultFlyerDesign, memberAppEventLink, parseFlyerDesign, readFlyerSource, type FlyerDesign, type FlyerSource } from "@/lib/events/flyer";
import type { FlyerArtSetup, FlyerOccasion } from "@/lib/events/flyer-art";
import { festivalTitlesNear, flyerArtReadiness, listFlyerArt } from "@/lib/events/flyer-art-library";
import { suggestOccasion, type OccasionSuggestion } from "@/lib/events/flyer-occasions";
import { flyerBrandSummary, readFlyerBrand, type FlyerBrand } from "@/lib/events/flyer-brand";
import { DbFailure, FormError, runAction } from "@/lib/events/forms";
import { approvalState, checkPublishTime, drawnTakeOccasions, isGuestVisible, publishProblems } from "@/lib/events/publish-schedule";
import type { ReadinessEvent } from "@/lib/events/readiness";
import { isUuid } from "@/lib/search-params";

const EDIT_DENIED = "only event managers and this event's lead can make this event's flyer.";

const EVENT_COLUMNS =
  "id, center_id, name, description, status, starts_at, ends_at, venue, capacity, audience, confidential, rsvp_opens_at, rsvp_closes_at, lunch_enabled, lunch_starts_at, is_paid, member_price_cents, guest_price_cents, owner_person_id, flyer_path, flyer_source, flyer_design, publish_at, publish_failure";

export type PanelEvent = ReadinessEvent & {
  id: string;
  confidential: boolean;
  flyer_source: FlyerSource | null;
  flyer_design: Json | null;
  publish_at: string | null;
  publish_failure: string | null;
};

export type FlyerPanelSetup = {
  tz: string;
  event: PanelEvent;
  /** The saved design (the flyer maker's), or null: the panel then starts from `defaults`. */
  saved: FlyerDesign | null;
  /** A new flyer for this event: the Poster with drawn art, from the brand kit and the event's words. */
  defaults: FlyerDesign;
  brand: FlyerBrand;
  brandSummary: string;
  memberAppLink: string | null;
  guestVisible: boolean;
  art: FlyerArtSetup;
  /** The art packs "Another drawn take" may use for this kind of organization. */
  occasions: FlyerOccasion[];
  /** The occasions that suit this event, best first, each with its reason (shown in the art picker). */
  suggestions: OccasionSuggestion[];
  canEdit: boolean;
  userId: string;
};

function revalidate(eventId: string) {
  revalidatePath("/events", "layout");
  revalidatePath(`/events/${eventId}`, "page");
}

async function loadEvent(db: Awaited<ReturnType<typeof eventActionContext>>["db"], eventId: string, centerId: string): Promise<PanelEvent> {
  const res = await db.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (res.error) throw new DbFailure(res.error, "load the event");
  const e = res.data;
  if (!e || e.center_id !== centerId) throw new FormError("that event was not found.");
  return { ...e, flyer_source: readFlyerSource(e.flyer_source) };
}

/** What the panel starts from. Read-only; nothing is saved. */
export async function loadFlyerPanelAction(eventId: string): Promise<ActionResult<FlyerPanelSetup>> {
  return runAction<FlyerPanelSetup>("events.flyer_panel.load", "load the flyer", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const ctx = await eventActionContext((a) => eventAreas.event(a, eventId), "you can't see this event.");
    const { db, centerId, session, tz, userId } = ctx;
    const event = await loadEvent(db, eventId, centerId);
    const brand = readFlyerBrand(session.center.branding, process.env.NEXT_PUBLIC_SUPABASE_URL);
    const memberAppLink = memberAppEventLink(process.env.NEXT_PUBLIC_MEMBER_APP_URL, eventId);
    const community = { kind: session.kind };
    const defaults = defaultFlyerDesign({
      name: event.name,
      description: event.description,
      venue: event.venue,
      startsAt: event.starts_at,
      endsAt: event.ends_at,
      tz,
      qrAvailable: memberAppLink !== null,
      community,
    });
    const saved = parseFlyerDesign(event.flyer_design);
    const occasion = (saved.ok ? saved.design.poster?.occasion : null) ?? defaults.poster?.occasion ?? "general";
    const occasions = drawnTakeOccasions(session.kind, occasion);
    const [readiness, library, calendar] = await Promise.all([flyerArtReadiness(db, centerId), listFlyerArt(db, centerId, occasion), festivalTitlesNear(db, event.starts_at)]);
    const suggestions = suggestOccasion({ title: event.name, description: event.description, startsAt: event.starts_at, tz, kind: session.kind, calendar });
    return {
      ok: true,
      data: {
        tz,
        event,
        saved: saved.ok && event.flyer_source === "designed" ? saved.design : null,
        defaults,
        brand,
        brandSummary: flyerBrandSummary(brand),
        memberAppLink,
        guestVisible: isGuestVisible(event),
        art: { readiness, entries: library.entries, problem: library.problem },
        occasions,
        suggestions,
        canEdit: eventAreas.edit(ctx.access, eventId),
        userId,
      },
    };
  });
}

/** Take the flyer's approval back. A publish that was scheduled is cancelled too: nothing goes out without an approval. */
export async function withdrawFlyerApprovalAction(eventId: string): Promise<ActionResult> {
  return runAction("events.flyer_panel.unapprove", "withdraw the approval", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const { db, centerId } = await eventActionContext((a) => eventAreas.edit(a, eventId), EDIT_DENIED);
    const event = await loadEvent(db, eventId, centerId);
    const design = event.flyer_design && typeof event.flyer_design === "object" && !Array.isArray(event.flyer_design) ? { ...event.flyer_design } : null;
    if (!design || !("approval" in design)) return { ok: true, message: "The flyer was not approved, so there was nothing to withdraw." };
    delete (design as Record<string, unknown>).approval;
    const res = await db.from("events").update({ flyer_design: design as Json, publish_at: null }).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "withdraw the approval");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    revalidate(eventId);
    return { ok: true, message: event.publish_at ? "Approval withdrawn. The scheduled publish was cancelled too." : "Approval withdrawn." };
  }, { key: "events.flyer_unapprove", entityFrom: { kind: "event", id: eventId } });
}

function firstProblem(problems: string[]): string {
  const p = problems[0] ?? "";
  // Keep an acronym at the start readable ("RSVPs close…"), as runAction does.
  return !p || /^[A-Z]{2}/.test(p) ? p : p[0]!.toLowerCase() + p.slice(1);
}

/**
 * Publish now: the same command as the event page's Publish button (events.set_status, draft -> published), after the
 * checks the background service makes. The schedule, if any, is cleared by the database when the event leaves draft (0700).
 */
export async function publishEventNowAction(eventId: string): Promise<ActionResult> {
  return runAction("events.flyer_panel.publish", "publish the event", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const { db, centerId, session, tz } = await eventActionContext((a) => eventAreas.edit(a, eventId), SET_STATUS_DENIED);
    const event = await loadEvent(db, eventId, centerId);
    const problems = publishProblems(event, approvalState(event, event), new Date(), tz);
    if (problems.length) return { ok: false, error: `Could not publish the event — ${firstProblem(problems)}` };
    const r = await runCommandFromScreen(setEventStatusCommand, session, { event_id: eventId, status: "published" });
    if (!r.ok) return r;
    revalidate(eventId);
    return { ok: true, message: r.message };
  }, { key: "events.set_status", entityFrom: { kind: "event", id: eventId } });
}

/** Schedule the publish: `local` is a datetime-local value in the community's time zone, in the future and before the event. */
export async function scheduleEventPublishAction(eventId: string, local: string): Promise<ActionResult<{ publishAt: string }>> {
  return runAction<{ publishAt: string }>("events.flyer_panel.schedule", "schedule the publish", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const { db, centerId, tz } = await eventActionContext((a) => eventAreas.edit(a, eventId), SET_STATUS_DENIED);
    const event = await loadEvent(db, eventId, centerId);
    const time = checkPublishTime(local, tz, event.starts_at);
    if (!time.ok) throw new FormError(time.error);
    // Checked as it will be at the publish time (a start or an RSVP close before then would stop it there).
    const problems = publishProblems(event, approvalState(event, event), new Date(time.iso), tz);
    if (problems.length) return { ok: false, error: `Could not schedule the publish — ${firstProblem(problems)}` };
    const res = await db.from("events").update({ publish_at: time.iso, publish_failure: null }).eq("id", eventId).eq("status", "draft").select("id");
    if (res.error) throw new DbFailure(res.error, "schedule the publish");
    if (!res.data?.length) throw new FormError("the event is no longer a draft, or you can't edit it. Reload the page.");
    revalidate(eventId);
    return { ok: true, message: "Scheduled. It will be published at that time, after the same checks.", data: { publishAt: time.iso } };
  }, { key: "events.publish_schedule", entityFrom: { kind: "event", id: eventId } });
}

/** Cancel a scheduled publish: the event stays a draft. */
export async function cancelScheduledPublishAction(eventId: string): Promise<ActionResult> {
  return runAction("events.flyer_panel.unschedule", "cancel the schedule", async () => {
    if (!isUuid(eventId)) throw new FormError("that event was not found.");
    const { db } = await eventActionContext((a) => eventAreas.edit(a, eventId), SET_STATUS_DENIED);
    const res = await db.from("events").update({ publish_at: null, publish_failure: null }).eq("id", eventId).select("id");
    if (res.error) throw new DbFailure(res.error, "cancel the schedule");
    if (!res.data?.length) throw new FormError("you can't edit this event.");
    revalidate(eventId);
    return { ok: true, message: "Schedule cancelled. The event stays a draft." };
  }, { key: "events.publish_unschedule", entityFrom: { kind: "event", id: eventId } });
}
