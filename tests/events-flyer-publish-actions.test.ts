// The flyer and publish panel's Server Actions (src/app/(app)/events/flyer-publish-actions.ts): nothing is published or
// scheduled without an approved flyer and a ready event; publishing runs the existing events.set_status command; every
// action records its activity key; the schedule is written in UTC from the community's local time.
import { beforeEach, describe, expect, it, vi } from "vitest";

const held = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({
  activityParts: (option: string | { key: string; entityFrom?: unknown }) =>
    typeof option === "string" ? { key: option, opts: {} } : { key: option.key, opts: { entityFrom: option.entityFrom } },
  withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()),
}));
vi.mock("@/lib/data/events", () => ({
  eventActionContext: async (check: (a: unknown) => boolean, denied: string) => {
    const { FormError } = await import("@/lib/events/forms");
    const s = held.session as { permissions: string[]; db: unknown; center: { id: string; time_zone: string }; userId: string };
    const access = { permissions: s.permissions, isPlatformAdmin: false, isOwner: false, grants: [] };
    if (!check(access)) throw new FormError(denied);
    return { session: s, access, db: s.db, centerId: s.center.id, tz: s.center.time_zone, userId: s.userId };
  },
}));

import {
  cancelScheduledPublishAction,
  publishEventNowAction,
  scheduleEventPublishAction,
  withdrawFlyerApprovalAction,
} from "@/app/(app)/events/flyer-publish-actions";
import { withActivity } from "@/lib/activity/with-activity";
import { defaultFlyerDesign, flyerMadeFor } from "@/lib/events/flyer";
import { makeFlyerApproval } from "@/lib/events/publish-schedule";

import { fakeDb, fakeSession } from "./commands/helpers";

const EV = "5b1c0a2e-7d3f-4e8a-9b6c-1d2e3f4a5b6c";
const TZ = "America/Chicago";
const MANAGER = ["events.view", "events.manage"];

/** A chamber's draft expo, three weeks out, with (or without) an approved flyer. */
function world(o: { approved?: boolean; over?: Record<string, unknown>; permissions?: string[] } = {}) {
  const base = {
    id: EV,
    center_id: "center-1",
    name: "Small Business Expo",
    description: "Meet local businesses.",
    status: "draft",
    starts_at: "2026-11-12T23:00:00Z",
    ends_at: "2026-11-13T02:00:00Z",
    venue: "Main Hall",
    capacity: 200,
    audience: "members_and_guests",
    confidential: false,
    rsvp_opens_at: null,
    rsvp_closes_at: null,
    lunch_enabled: false,
    lunch_starts_at: null,
    is_paid: false,
    member_price_cents: null,
    guest_price_cents: null,
    owner_person_id: null,
    flyer_path: null as string | null,
    flyer_source: null as string | null,
    flyer_design: null as unknown,
    publish_at: null as string | null,
    publish_failure: null as string | null,
    ...o.over,
  };
  if (o.approved) {
    const d = defaultFlyerDesign({ name: base.name, description: base.description, venue: base.venue, startsAt: base.starts_at, endsAt: base.ends_at, tz: TZ, qrAvailable: true });
    base.flyer_path = `center-1/events/${EV}/flyer-1.png`;
    base.flyer_source = "designed";
    base.flyer_design = { ...d, made_for: flyerMadeFor(base), approval: makeFlyerApproval(d, base.name, "user-1") };
  }
  const db = fakeDb({ tables: { events: [base] } });
  held.session = fakeSession({ db, permissions: o.permissions ?? MANAGER });
  return { event: base, db };
}

const keys = () => vi.mocked(withActivity).mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(withActivity).mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T17:00:00Z"));
});

describe("publishEventNowAction", () => {
  it("refuses while the flyer is not approved, and changes nothing", async () => {
    const { event } = world();
    const res = await publishEventNowAction(EV);
    expect(res).toEqual({ ok: false, error: "Could not publish the event — approve the flyer first. A person approves everything that goes out." });
    expect(event.status).toBe("draft");
    expect(keys()).toEqual(["events.set_status"]);
  });

  it("refuses an event with a publish blocker, even with an approved flyer", async () => {
    const { event } = world({ approved: true, over: { is_paid: true } });
    const res = await publishEventNowAction(EV);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/^Could not publish the event — it is a paid event with no member price/);
    expect(event.status).toBe("draft");
  });

  it("publishes through events.set_status when the flyer is approved and the event is ready", async () => {
    const { event } = world({ approved: true });
    const res = await publishEventNowAction(EV);
    expect(res).toEqual({ ok: true, message: "Published · RSVPs open in the member app" });
    expect(event.status).toBe("published");
  });

  it("refuses when the event was renamed after the flyer was approved", async () => {
    const { event } = world({ approved: true });
    event.name = "Spring Business Expo";
    const res = await publishEventNowAction(EV);
    expect(!res.ok && res.error).toMatch(/name changed after the flyer was approved/);
  });

  it("is refused to a person who cannot edit the event", async () => {
    world({ approved: true, permissions: ["events.view"] });
    const res = await publishEventNowAction(EV);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/only event managers and this event's lead/);
  });
});

describe("scheduleEventPublishAction", () => {
  it("writes the community's local time as UTC and clears an old failure", async () => {
    const { event } = world({ approved: true, over: { publish_failure: "Not published at the scheduled time: x" } });
    const res = await scheduleEventPublishAction(EV, "2026-11-02T09:00");
    expect(res).toMatchObject({ ok: true, data: { publishAt: "2026-11-02T15:00:00.000Z" } });
    expect(event.publish_at).toBe("2026-11-02T15:00:00.000Z");
    expect(event.publish_failure).toBeNull();
    expect(keys()).toEqual(["events.publish_schedule"]);
  });

  it("refuses a time in the past or after the event starts", async () => {
    world({ approved: true });
    expect(await scheduleEventPublishAction(EV, "2026-10-01T09:00")).toEqual({ ok: false, error: "Could not schedule the publish — pick a time in the future." });
    const late = await scheduleEventPublishAction(EV, "2026-11-20T09:00");
    expect(!late.ok && late.error).toMatch(/^Could not schedule the publish — pick a time before the event starts/);
  });

  it("refuses without an approved flyer, and when RSVPs close before the publish time", async () => {
    world();
    const none = await scheduleEventPublishAction(EV, "2026-11-02T09:00");
    expect(!none.ok && none.error).toMatch(/approve the flyer first/);
    const { event } = world({ approved: true, over: { rsvp_closes_at: "2026-11-01T00:00:00Z" } });
    const closed = await scheduleEventPublishAction(EV, "2026-11-02T09:00");
    expect(!closed.ok && closed.error).toMatch(/— RSVPs close on .*, before the publish time./);
    expect(event.publish_at).toBeNull();
  });
});

describe("cancelScheduledPublishAction and withdrawFlyerApprovalAction", () => {
  it("cancels a schedule: the event stays a draft", async () => {
    const { event } = world({ approved: true, over: { publish_at: "2026-11-02T15:00:00.000Z" } });
    expect(await cancelScheduledPublishAction(EV)).toEqual({ ok: true, message: "Schedule cancelled. The event stays a draft." });
    expect(event.publish_at).toBeNull();
    expect(event.status).toBe("draft");
    expect(keys()).toEqual(["events.publish_unschedule"]);
  });

  it("withdraws the approval and cancels the schedule with it", async () => {
    const { event } = world({ approved: true, over: { publish_at: "2026-11-02T15:00:00.000Z" } });
    expect(await withdrawFlyerApprovalAction(EV)).toEqual({ ok: true, message: "Approval withdrawn. The scheduled publish was cancelled too." });
    expect((event.flyer_design as Record<string, unknown>).approval).toBeUndefined();
    expect((event.flyer_design as Record<string, unknown>).made_for).toBeDefined();
    expect(event.publish_at).toBeNull();
    expect(keys()).toEqual(["events.flyer_unapprove"]);
  });

  it("says so when there was no approval to withdraw", async () => {
    world();
    expect(await withdrawFlyerApprovalAction(EV)).toEqual({ ok: true, message: "The flyer was not approved, so there was nothing to withdraw." });
  });
});
