// DEV ONLY. Invented sample events for the flyer and publish panel's preview (/dev/event-flyer-panel): a church, a chamber
// of commerce and a temple, so the panel is seen for several kinds of organization. Nothing here is real data.

import type { FlyerPanelSetup, PanelEvent } from "@/app/(app)/events/flyer-publish-actions";
import { defaultFlyerDesign, flyerMadeFor, memberAppEventLink } from "@/lib/events/flyer";
import type { FlyerArtSetup, FlyerOccasion } from "@/lib/events/flyer-art";
import { flyerBrandSummary, readFlyerBrand, type FlyerBrand } from "@/lib/events/flyer-brand";
import { fromDateTimeLocal } from "@/lib/events/format";
import { makeFlyerApproval, suggestedPublishTime } from "@/lib/events/publish-schedule";

export const PREVIEW_KINDS = ["church", "chamber", "temple"] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];
export const PREVIEW_APP = "https://app.example.org";

export type Fixture = {
  org: string;
  tz: string;
  brand: FlyerBrand;
  tradition: boolean;
  art: FlyerArtSetup;
  event: { id: string; name: string; description: string; venue: string; starts_at: string; ends_at: string; audience: string };
};

const NO_KEY: FlyerArtSetup = { readiness: { state: "no_key", message: "AI art needs a Gemini key — ask your Weaver admin (Platform › Setup)." }, entries: [], problem: null };
const READY: FlyerArtSetup = { readiness: { state: "ready", model: "gemini-3.1-flash-image", cents: 4 }, entries: [], problem: null };

export const FIXTURES: Record<PreviewKind, Fixture> = {
  church: {
    org: "Grace Community Church",
    tz: "America/Chicago",
    brand: readFlyerBrand({ primary: "#1F3A68", accent: "#B8862B", background: "#FBF8F2" }, null),
    tradition: false,
    art: NO_KEY,
    event: {
      id: "d0000000-0000-4000-8000-00000000c401",
      name: "Christmas Eve Candlelight Service",
      description: "Carols, readings and candlelight for the whole family. Everyone is welcome.",
      venue: "Grace Church Sanctuary",
      starts_at: "2026-12-25T00:00:00Z",
      ends_at: "2026-12-25T01:30:00Z",
      audience: "public",
    },
  },
  chamber: {
    org: "Riverside Chamber of Commerce",
    tz: "America/New_York",
    brand: readFlyerBrand({ primary: "#0E5A61", accent: "#C2571A", background: "#F6FAFA" }, null),
    tradition: false,
    art: READY,
    event: {
      id: "d0000000-0000-4000-8000-00000000c402",
      name: "Small Business Expo and Awards Night",
      description: "Meet more than sixty local businesses, then stay for the community awards. Free for members and their guests.",
      venue: "Riverside Convention Hall",
      starts_at: "2026-11-12T22:00:00Z",
      ends_at: "2026-11-13T02:00:00Z",
      audience: "members_and_guests",
    },
  },
  temple: {
    org: "Shanti Temple Society",
    tz: "America/Los_Angeles",
    brand: readFlyerBrand({ primary: "#6B1F3A", accent: "#D98E04", background: "#FFF8EC" }, null),
    tradition: true,
    art: READY,
    event: {
      id: "d0000000-0000-4000-8000-00000000c403",
      name: "Diwali Festival of Lights",
      description: "An evening of lamps, music and a shared dinner for families and friends.",
      venue: "Temple Community Hall",
      starts_at: "2026-11-09T01:00:00Z",
      ends_at: "2026-11-09T05:00:00Z",
      audience: "members_and_guests",
    },
  },
};

export function isPreviewKind(v: unknown): v is PreviewKind {
  return typeof v === "string" && (PREVIEW_KINDS as readonly string[]).includes(v);
}

/**
 * The panel's setup for one sample event, as loadFlyerPanelAction would answer it. `state`: "draft" (nothing approved),
 * "scheduled" (the flyer approved and the publish set for the suggested time), "live" (published) or "failed" (the scheduled
 * publish refused, with its reason).
 */
export type PreviewState = "draft" | "scheduled" | "live" | "failed";

export function sampleSetup(kind: PreviewKind, state: PreviewState, now: Date = new Date()): FlyerPanelSetup {
  return setupForEvent(FIXTURES[kind], state, now);
}

/** A sample brand kit per kind of organization (the creator's dev preview has a club as well). */
const CLUB_BRAND = readFlyerBrand({ primary: "#1E5631", accent: "#C2571A", background: "#F7FAF5" }, null);
export function brandForKind(kind: unknown): FlyerBrand {
  return isPreviewKind(kind) ? FIXTURES[kind].brand : kind === "club" ? CLUB_BRAND : FIXTURES.church.brand;
}

/** The panel's setup for any sample event (the panel's own preview, or the creator's preview with the real panel in its slot). */
export function setupForEvent(f: Fixture, state: PreviewState, now: Date = new Date()): FlyerPanelSetup {
  const memberAppLink = memberAppEventLink(PREVIEW_APP, f.event.id);
  const occasions: FlyerOccasion[] = f.tradition ? ["diwali", "general"] : ["general"];
  const defaults = defaultFlyerDesign({ name: f.event.name, description: f.event.description, venue: f.event.venue, startsAt: f.event.starts_at, endsAt: f.event.ends_at, tz: f.tz, qrAvailable: true });
  if (defaults.poster && !occasions.includes(defaults.poster.occasion)) defaults.poster = { ...defaults.poster, occasion: occasions[0]! };
  const approved = state !== "draft";
  const scheduledLocal = suggestedPublishTime(f.event.starts_at, f.tz, now);
  const event: PanelEvent = {
    ...f.event,
    status: state === "live" ? "published" : "draft",
    capacity: 250,
    confidential: false,
    rsvp_opens_at: null,
    rsvp_closes_at: null,
    lunch_enabled: false,
    lunch_starts_at: null,
    is_paid: false,
    member_price_cents: null,
    guest_price_cents: null,
    owner_person_id: null,
    flyer_path: approved ? `dev/events/${f.event.id}/flyer-1.png` : null,
    flyer_source: approved ? "designed" : null,
    flyer_design: approved ? (JSON.parse(JSON.stringify({ ...defaults, made_for: flyerMadeFor(f.event), approval: makeFlyerApproval(defaults, f.event.name, "dev-user", new Date(now.getTime() - 3_600_000)) })) as PanelEvent["flyer_design"]) : null,
    publish_at: state === "scheduled" ? fromDateTimeLocal(scheduledLocal, f.tz) : null,
    publish_failure: state === "failed" ? "Not published at the scheduled time: its venue changed after the flyer was approved, so the flyer shows the old venue. Approve the flyer again." : null,
  };
  return {
    tz: f.tz,
    event,
    saved: approved ? defaults : null,
    defaults,
    brand: f.brand,
    brandSummary: flyerBrandSummary(f.brand),
    memberAppLink,
    guestVisible: true,
    art: f.art,
    occasions,
    canEdit: true,
    userId: "dev-user",
  };
}
