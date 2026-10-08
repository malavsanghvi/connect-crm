// Calendar layers members can overlay in the app (app.calendar_layers).

import { kindHas, moduleNotOffered } from "@/lib/kind";
import { word, type KindLike } from "@/lib/wording";

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

/** Where a layer's dates come from, in the prototype's words (`kind`: the organization's kind; omitted = a Jain Center's words). */
export function layerSource(layer: LayerLike, tradition: string | null, kind?: KindLike): string {
  switch (layer.kind) {
    case "tithi":
      return `Panchang: ${TRADITION_LABEL[tradition ?? ""] ?? "tradition"} (configurable)`;
    case "festival":
      return kind ? word(kind, "festival_dates") : "Parva and festival dates";
    case "pathshala":
      return "Pathshala terms and no-class days";
    case "events":
      return "Events module (automatic)";
    case "school_district":
      return layer.source_url ? "Published district feed" : "District feed (no address yet)";
    case "custom":
      return layer.source_url ? "Calendar link" : "Entries added here";
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

// ---------------------------------------------------------------------------
// Calendar subscriptions (0510): a layer follows an ICS link.
// ---------------------------------------------------------------------------

export type FeedLike = {
  source_url: string | null;
  feed_subscribed: boolean;
  feed_status: string;
  feed_synced_at: string | null;
  feed_error: string | null;
  feed_result: unknown;
};

/**
 * A calendar link as the database takes it: webcal:// is read as https://;
 * only http(s) addresses, no user name or password. The background service
 * also refuses private addresses (it resolves the host).
 */
export function parseFeedUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const v = raw.trim().replace(/^webcals?:\/\//i, "https://");
  if (!v) return { ok: false, error: "paste the calendar's public link (ICS or iCal address)." };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { ok: false, error: "that is not a web address. Paste the calendar's public ICS link, starting with https://." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "the link must start with https:// (or webcal://)." };
  if (u.username || u.password) return { ok: false, error: "the link must not contain a user name or password." };
  if (v.length > 2000) return { ok: false, error: "the link is longer than 2,000 characters." };
  return { ok: true, url: v };
}

/** The host a layer follows, for the table ("calendar.google.com"). */
export function feedHost(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function count(result: unknown, key: string): number | null {
  if (typeof result !== "object" || result === null) return null;
  const v = (result as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

/** One line for Calendar › Layers: where the subscription stands, in plain English. */
export function feedStatusLine(layer: FeedLike, formatWhen: (iso: string) => string): { tone: "ok" | "warn" | "bad"; text: string } | null {
  if (!layer.feed_subscribed) return null;
  if (layer.feed_status === "error") return { tone: "bad", text: `Last refresh failed — ${layer.feed_error ?? "no reason was recorded"}` };
  if (layer.feed_status === "pending") return { tone: "warn", text: "Refresh queued — the background service will fetch it shortly" };
  if (layer.feed_status === "ok" && layer.feed_synced_at) {
    const r = layer.feed_result;
    const parts = [
      ["inserted", "added"],
      ["updated", "changed"],
      ["removed", "removed"],
      ["events_created", "events created"],
    ]
      .map(([k, label]) => [count(r, k!), label] as const)
      .filter(([n]) => (n ?? 0) > 0)
      .map(([n, label]) => `${n} ${label}`);
    return { tone: "ok", text: `Refreshed ${formatWhen(layer.feed_synced_at)} · ${parts.length ? parts.join(", ") : "no changes"} · daily` };
  }
  return { tone: "warn", text: "Not refreshed yet" };
}

export const LAYER_KINDS: { kind: string; label: string }[] = [
  { kind: "custom", label: "Other (entries added here or from a link)" },
  { kind: "events", label: "Events" },
  { kind: "festival", label: "Parva and festival dates" },
  { kind: "tithi", label: "Tithi (panchang)" },
  { kind: "pathshala", label: "Pathshala" },
  { kind: "school_district", label: "School calendar" },
];

/**
 * The kinds of dates a layer can hold for this organization's kind: a tithi (panchang) layer only where the kind has a
 * tradition pack, a Pathshala layer only where the kind has Pathshala, and the festival layer in the kind's own words.
 */
export function layerKindsFor(kind: KindLike): { kind: string; label: string }[] {
  return LAYER_KINDS.filter((k) => layerVisibleFor(kind, k.kind)).map((k) => (k.kind === "festival" ? { ...k, label: word(kind, "festival_dates") } : k));
}

/** Whether a layer of this kind of dates belongs on this organization's calendar (a shared Jain tithi layer does not, for a chamber). */
export function layerVisibleFor(kind: KindLike, layerKind: string): boolean {
  if (layerKind === "tithi") return kindHas(kind, "tradition");
  if (layerKind === "pathshala") return !moduleNotOffered(kind, "pathshala");
  return true;
}

/** A layer key from its name ("School calendar (FBISD)" → "school_calendar_fbisd"), unique among `taken`. */
export function layerKey(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "layer";
  let k = base;
  let n = 2;
  while (taken.has(k)) k = `${base}_${n++}`;
  return k;
}
