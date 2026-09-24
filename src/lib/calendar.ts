// Calendar layers members can overlay in the app (app.calendar_layers).

export type LayerLike = {
  center_id: string | null;
  kind: string;
  source_url: string | null;
  default_on: boolean;
  owner_label: string | null;
};

export const TRADITION_LABEL: Record<string, string> = {
  shvetambar_murtipujak: "Shvetambar Murtipujak",
  sthanakvasi: "Sthanakvasi",
  terapanthi: "Terapanthi",
  digambar: "Digambar",
  other: "Other",
};

/** Where a layer's dates come from, in the prototype's words. */
export function layerSource(layer: LayerLike, tradition: string | null): string {
  switch (layer.kind) {
    case "tithi":
      return `Panchang: ${TRADITION_LABEL[tradition ?? ""] ?? "tradition"} (configurable)`;
    case "festival":
      return "Parva and festival dates";
    case "pathshala":
      return "Pathshala terms and no-class days";
    case "events":
      return "Events module (automatic)";
    case "school_district":
      return layer.source_url ? "Published district feed" : "District feed (no address yet)";
    default:
      return "Entries added here";
  }
}

/** Who maintains a layer. Shared layers (no center) are maintained by the platform. */
export function layerOwner(layer: LayerLike): string {
  if (layer.owner_label?.trim()) return layer.owner_label.trim();
  return layer.center_id === null ? "Platform" : "—";
}

/** "On", "Off", or "By family" for district layers families pick themselves. */
export function layerDefault(layer: LayerLike): "On" | "Off" | "By family" {
  if (layer.default_on) return "On";
  return layer.kind === "school_district" ? "By family" : "Off";
}

/** Prototype order: tithi, Pathshala, events, then district feeds; center layers before shared ones of a kind. */
const KIND_ORDER = ["tithi", "festival", "pathshala", "events", "custom", "school_district"];
export function sortLayers<T extends LayerLike & { name: string }>(layers: T[]): T[] {
  return [...layers].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      Number(a.center_id === null) - Number(b.center_id === null) ||
      a.name.localeCompare(b.name),
  );
}
