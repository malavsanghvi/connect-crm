import { describe, expect, it } from "vitest";

import { layerDefault, layerOwner, layerSource, sortLayers } from "@/lib/calendar";
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
