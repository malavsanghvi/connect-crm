import { describe, expect, it } from "vitest";

import { feedHost, feedStatusLine, layerDefault, layerKey, layerOwner, layerSource, parseFeedUrl, sortLayers } from "@/lib/calendar";
import { visibleNav } from "@/lib/permissions";

const layer = (o: Partial<{ center_id: string | null; kind: string; source_url: string | null; default_on: boolean; owner_label: string | null; name: string }>) => ({
  center_id: "c1",
  kind: "custom",
  source_url: null,
  default_on: false,
  owner_label: null,
  name: "X",
  ...o,
});

describe("calendar layers", () => {
  it("describes the source like the prototype", () => {
    expect(layerSource(layer({ kind: "tithi" }), "shvetambar_murtipujak")).toBe("Panchang: Shvetambar Murtipujak (configurable)");
    expect(layerSource(layer({ kind: "events" }), null)).toBe("Events module (automatic)");
    expect(layerSource(layer({ kind: "school_district", source_url: "https://x/ics" }), null)).toBe("Published district feed");
  });
  it("shows owner and default", () => {
    expect(layerOwner(layer({ owner_label: " Pathshala principal " }))).toBe("Pathshala principal");
    expect(layerOwner(layer({ center_id: null }))).toBe("Platform");
    expect(layerDefault(layer({ default_on: true }))).toBe("On");
    expect(layerDefault(layer({ kind: "school_district" }))).toBe("By family");
    expect(layerDefault(layer({}))).toBe("Off");
  });
  it("orders tithi, Pathshala, events, then districts", () => {
    const sorted = sortLayers([
      layer({ kind: "school_district", center_id: null, name: "Katy ISD" }),
      layer({ kind: "events", name: "Events" }),
      layer({ kind: "tithi", name: "Jain tithi" }),
      layer({ kind: "pathshala", name: "Pathshala" }),
    ]);
    expect(sorted.map((l) => l.name)).toEqual(["Jain tithi", "Pathshala", "Events", "Katy ISD"]);
  });
});

describe("module gating", () => {
  it("store pickup volunteers see only Orders by pickup", () => {
    const store = visibleNav({ permissions: ["store.pickup"], isPlatformAdmin: false }).find((m) => m.key === "store")!;
    expect(store.tabs.map((t) => t.href)).toEqual(["/store/orders"]);
    expect(store.href).toBe("/store/orders");
  });
  it("calendar is for content staff", () => {
    expect(visibleNav({ permissions: ["content.manage"], isPlatformAdmin: false }).some((m) => m.key === "calendar")).toBe(true);
    expect(visibleNav({ permissions: ["bolis.view"], isPlatformAdmin: false }).map((m) => m.key)).toEqual(["home", "bolis"]);
  });
});

describe("calendar subscriptions", () => {
  it("takes a public calendar link, reading webcal:// as https://", () => {
    expect(parseFeedUrl(" webcal://calendar.google.com/calendar/ical/x/public/basic.ics ")).toEqual({ ok: true, url: "https://calendar.google.com/calendar/ical/x/public/basic.ics" });
    expect(parseFeedUrl("https://example.org/a.ics")).toEqual({ ok: true, url: "https://example.org/a.ics" });
    expect(parseFeedUrl("")).toMatchObject({ ok: false });
    expect(parseFeedUrl("ftp://example.org/a.ics")).toMatchObject({ ok: false, error: expect.stringContaining("https://") });
    expect(parseFeedUrl("https://me:pw@example.org/a.ics")).toMatchObject({ ok: false, error: expect.stringContaining("password") });
    expect(parseFeedUrl("not a link")).toMatchObject({ ok: false });
    expect(feedHost("https://calendar.google.com/x")).toBe("calendar.google.com");
  });
  it("says where a subscription stands", () => {
    const base = { source_url: "https://x.org/a.ics", feed_subscribed: true, feed_synced_at: "2026-09-25T10:00:00Z", feed_error: null, feed_result: {} };
    const when = () => "Sep 25";
    expect(feedStatusLine({ ...base, feed_subscribed: false, feed_status: "none" }, when)).toBeNull();
    expect(feedStatusLine({ ...base, feed_status: "pending" }, when)).toMatchObject({ tone: "warn" });
    expect(feedStatusLine({ ...base, feed_status: "error", feed_error: "The calendar link was not found." }, when)).toEqual({ tone: "bad", text: "Last refresh failed — The calendar link was not found." });
    expect(feedStatusLine({ ...base, feed_status: "ok", feed_result: { inserted: 3, updated: 0, removed: 1, events_created: 2 } }, when)).toEqual({
      tone: "ok",
      text: "Refreshed Sep 25 · 3 added, 1 removed, 2 events created · daily",
    });
    expect(feedStatusLine({ ...base, feed_status: "ok", feed_result: { inserted: 0 } }, when)?.text).toBe("Refreshed Sep 25 · no changes · daily");
  });
  it("makes unique layer keys from names", () => {
    expect(layerKey("School calendar (FBISD)", new Set())).toBe("school_calendar_fbisd");
    expect(layerKey("Events", new Set(["events"]))).toBe("events_2");
    expect(layerKey("!!!", new Set())).toBe("layer");
    expect(layerSource(layer({ kind: "custom", source_url: "https://x/ics" }), null)).toBe("Calendar link");
  });
});
