// Flyer layouts (Flyers v3, owner 2026-10-12): the Poster's words arranged as BLOCKS in a PRESET, instead of one fixed stack.
//
// Pure (no server imports): the flyer panels are client components and import this file, and the renderer
// (flyer-layout-render.tsx) reads it. The Poster stays the engine: its art frame and bottom scene, the words set by code, the
// brand palette. A layout adds an arrangement on top, stored as `poster.layout` in the same events.flyer_design (still v1: the
// field is optional, so every flyer saved before renders exactly as it did).
//
// A PRESET is data, not a branch of code: an ordered list of blocks, a few style tokens (how the title, the subhead, the date
// are set), the order blocks are left out in when a flyer is too full, and what choosing it seeds. A BLOCK is present when it has
// content (and was not switched off); every block is optional. What is specific to a kind of organization or a tradition (a
// greeting such as "Shalom") lives in the data tables below, never in the code paths, and the default for an organization with
// no tradition is none; the organizer can always type their own.
//
// Nothing typed here (names, phone numbers, a note) is ever sent to an AI provider: the words are set by code over the art.

import type { FlyerCommunity, FlyerSize, PosterContent } from "./flyer";
import { cleanLine, flyerTextLength } from "./flyer-text";
import { flyerTraditionFor } from "./flyer-occasions";
import { isPosterIcon, type PosterIcon } from "./flyer-icons";

// ── Blocks ───────────────────────────────────────────────────────────────────

/** Every block a layout can hold, in the order the editor lists them. */
export const LAYOUT_BLOCKS = [
  "greeting_top",
  "logos",
  "eyebrow",
  "title",
  "subhead",
  "tagline",
  "hero",
  "host",
  "stat",
  "when",
  "agenda",
  "note",
  "paragraph",
  "credits",
  "donors",
  "closing",
  "cta",
  "contacts",
  "qr",
  "footer",
  "greeting_bottom",
] as const;
export type BlockKey = (typeof LAYOUT_BLOCKS)[number];

export const BLOCK_LABEL: Record<BlockKey, string> = {
  greeting_top: "greeting at the top",
  logos: "logos",
  eyebrow: "small line above the title",
  title: "title",
  subhead: "sub-title",
  tagline: "tagline",
  hero: "picture",
  host: "host card",
  stat: "highlight box",
  when: "date, time and place",
  agenda: "agenda",
  note: "note box",
  paragraph: "paragraph",
  credits: "thank-you cards",
  donors: "donors panel",
  closing: "closing message",
  cta: "call to action",
  contacts: "contacts",
  qr: "RSVP code",
  footer: "footer line",
  greeting_bottom: "greeting at the bottom",
};

export function isBlockKey(v: unknown): v is BlockKey {
  return typeof v === "string" && (LAYOUT_BLOCKS as readonly string[]).includes(v);
}

// ── Content (poster.layout) ──────────────────────────────────────────────────

export const LAYOUT_PRESET_KEYS = ["notice", "save_the_date", "ceremony", "event_day", "thank_you"] as const;
export type LayoutPreset = (typeof LAYOUT_PRESET_KEYS)[number];

export function isLayoutPreset(v: unknown): v is LayoutPreset {
  return typeof v === "string" && (LAYOUT_PRESET_KEYS as readonly string[]).includes(v);
}

export type LayoutContact = { name: string; detail: string };

/** How the picture is framed: an arched window, a rounded frame, a circle, or free (the picture as it is, for artwork with its own shape). */
export const HERO_SHAPES = ["arch", "rounded", "circle", "free"] as const;
export type HeroShape = (typeof HERO_SHAPES)[number];
export const HERO_SHAPE_LABEL: Record<HeroShape, string> = { arch: "Arched window", rounded: "Rounded frame", circle: "Circle", free: "Free (as it is)" };
export function isHeroShape(v: unknown): v is HeroShape {
  return typeof v === "string" && (HERO_SHAPES as readonly string[]).includes(v);
}

/** One group of people to thank: a heading (a team, a committee) with the icon beside it, and their names. */
export type CreditGroup = { heading: string; names: string; icon: PosterIcon };

/**
 * What a layout draws besides the Poster's own fields (the headline is design.headline, the date and time are poster.ribbon, the
 * venue is design.venue_line, and poster.subhead, .slogan (the tagline), .stat, .agenda, .paragraph, .footer, .logo and .partner
 * keep their meaning). Every text may be empty.
 */
export type PosterLayout = {
  preset: LayoutPreset;
  /** Blocks the organizer switched off although they have content (the content is kept, so switching back loses nothing). */
  off: BlockKey[];
  /** The word (or words) of the title set in the accent colour (and in script when the layout does so). Empty: a one-tone title. */
  accent: string;
  /** A small line above the title ("Monthly", "Annual"). */
  eyebrow: string;
  /** The greeting at the top and at the bottom (a faith's own greeting, "Welcome"...). */
  greeting: { top: string; bottom: string };
  /** The host or sponsor card: the community picks the label ("Hosted by", "Sponsored by", their own word) and types the names. */
  host: { label: string; names: string };
  /** A note box with an icon ("please bring…"). */
  note: { icon: PosterIcon; text: string };
  /** The call-to-action line ("RSVP at…", "Register now"). */
  cta: string;
  /** The small label above the contacts ("Please contact"). */
  contacts_label: string;
  /** Up to LAYOUT_CONTACTS_MAX people: a name and a phone number or an email. */
  contacts: LayoutContact[];
  /**
   * The picture of the event's subject, from the community's own approved albums (never AI-made: no people, faces or sacred figures
   * are drawn by Weaver), and how it is framed. The picture is placed by the renderer only.
   */
  hero: { photo_id: string | null; shape: HeroShape };
  /** For a thank-you: up to CREDIT_GROUPS_MAX groups of people, each on a card of its own. */
  credits: CreditGroup[];
  /** For a thank-you: a donors panel, its heading ("Our generous donors") and their names. */
  donors: { heading: string; names: string };
  /** For a thank-you: a closing message. */
  closing: string;
};

export const LAYOUT_CONTACTS_MAX = 3;
export const CREDIT_GROUPS_MAX = 6;

export const LAYOUT_LIMITS = {
  accent: 24,
  eyebrow: 28,
  greeting: 32,
  host_label: 24,
  host_names: 90,
  note_text: 160,
  cta: 90,
  contacts_label: 32,
  contact_name: 32,
  contact_detail: 40,
  credit_heading: 36,
  credit_names: 220,
  donors_heading: 36,
  donors_names: 300,
  closing: 220,
} as const;

const LIMIT_LABEL: Record<keyof typeof LAYOUT_LIMITS, string> = {
  accent: "accent word",
  eyebrow: "small line above the title",
  greeting: "greeting",
  host_label: "host card's label",
  host_names: "host card's names",
  note_text: "note",
  cta: "call to action",
  contacts_label: "contacts' label",
  contact_name: "contact's name",
  contact_detail: "contact's phone or email",
  credit_heading: "thank-you card's heading",
  credit_names: "thank-you card's names",
  donors_heading: "donors panel's heading",
  donors_names: "donors' names",
  closing: "closing message",
};

// ── Data by tradition ────────────────────────────────────────────────────────

/**
 * A tradition's own greeting, offered (never forced) when a layout is chosen for a community of that tradition. DATA, keyed by
 * the tradition, so a new tradition is a new row. A community with no tradition, or one without a row here, gets none, and the
 * community can always type its own. Review rows with a member of that tradition before adding them.
 */
export const FLYER_GREETINGS: Readonly<Record<string, string>> = Object.freeze({
  jain: "Jai Jinendra",
  hindu: "Namaste",
  sikh: "Sat Sri Akal",
  muslim: "Assalamu alaikum",
  jewish: "Shalom",
});

/** The greeting for a community's tradition, or "" (none). */
export function greetingFor(community: FlyerCommunity | null | undefined): string {
  if (!community) return "";
  const tradition = flyerTraditionFor(community.kind, community.tradition);
  return (tradition && FLYER_GREETINGS[tradition]) || "";
}

// ── Presets (data) ───────────────────────────────────────────────────────────

/** How a preset sets its parts: the renderer reads these tokens, so a preset is a row of data and not a branch of code. */
export type LayoutStyle = {
  title: {
    /** On a ribbon banner, or plain on the paper. */
    set: "plain" | "banner";
    /** The heavy serif (the brand's display font) or the heavy sans. */
    face: "display" | "sans";
    caps: boolean;
    /** The biggest the title is set (units; the flyer is 1080 wide). */
    max: number;
    /** The accent word in script, or only in the accent colour. */
    accent: "script" | "colour";
  };
  subhead: "serif" | "script" | "caps";
  tagline: "line" | "pill" | "script";
  /** Date, time and place: two cells with icons in a card, big plain lines, the same between ornament rules, or a coloured band. */
  when: "cells" | "plain" | "rules" | "band";
  /** The blocks drawn inside an arched window (a panel with a pointed arch on top) and how wide it is, or none. */
  window: { blocks: readonly BlockKey[]; width: number } | null;
  /** The RSVP code: a block of its own in the flow (centred), or a small card in the bottom-left corner over the art. */
  qr: "block" | "corner";
};

export type PresetSpec = {
  key: LayoutPreset;
  label: string;
  /** One line for the picker. */
  blurb: string;
  /** The shape it suits best (a hint; every layout works at every size). */
  suits: FlyerSize;
  /** The blocks in the order they flow, top to bottom. */
  order: readonly BlockKey[];
  /** The least important first: left out, one at a time, when a flyer is too full for its size. */
  dropOrder: readonly BlockKey[];
  style: LayoutStyle;
  /** What choosing the preset does to the art: the bottom scene drawn, or none (the frame is never touched). */
  scene: "code" | "none";
  seed: {
    /** Greeting at the top and bottom from the community's tradition ("both"), only at the bottom, or none. */
    greeting: "both" | "bottom" | "none";
    /** Start with the title's last word as its accent. */
    accent: boolean;
    /** Words a new layout starts with when the poster has none of its own (the organizer edits them). */
    subhead: string;
    host_label: string;
    contacts_label: string;
    note_icon: PosterIcon;
    /** The framing a new layout's picture starts with. */
    hero_shape: HeroShape;
    /** The thank-you cards' and the donors panel's starting headings. */
    donors_heading: string;
    /** Whether the date, time and place are shown (a thank-you has none by default). */
    when: boolean;
  };
};

export const LAYOUT_PRESETS: Readonly<Record<LayoutPreset, PresetSpec>> = {
  // Reference: a monthly programme notice (greeting, ribbon title, a host card, date and time cells, a note, contacts).
  notice: {
    key: "notice",
    label: "Notice",
    blurb: "A programme notice: ribbon title, host card, date and time, a note and who to call",
    suits: "tall",
    order: ["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "hero", "host", "stat", "when", "agenda", "note", "paragraph", "credits", "donors", "closing", "cta", "contacts", "qr", "footer", "greeting_bottom"],
    dropOrder: ["footer", "paragraph", "closing", "donors", "credits", "hero", "greeting_top", "agenda", "note", "tagline", "subhead", "eyebrow", "stat", "greeting_bottom"],
    style: { title: { set: "banner", face: "display", caps: false, max: 104, accent: "colour" }, subhead: "serif", tagline: "line", when: "cells", window: null, qr: "block" },
    scene: "none",
    seed: { greeting: "both", accent: true, subhead: "", host_label: "Hosted by", contacts_label: "Please contact", note_icon: "leaf", hero_shape: "rounded", donors_heading: "Our generous donors", when: true },
  },
  // Reference: a club picnic save-the-date (heavy title, script line, a pill, the date and time large, the address smaller).
  save_the_date: {
    key: "save_the_date",
    label: "Save the date",
    blurb: "Simple and square-friendly: a big title, a script line, the date and time, where to RSVP",
    suits: "square",
    order: ["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "hero", "when", "host", "stat", "agenda", "note", "paragraph", "credits", "donors", "closing", "cta", "contacts", "footer", "greeting_bottom"],
    dropOrder: ["footer", "paragraph", "closing", "donors", "credits", "hero", "greeting_top", "contacts", "agenda", "note", "host", "stat", "eyebrow", "greeting_bottom", "tagline"],
    style: { title: { set: "plain", face: "sans", caps: true, max: 176, accent: "colour" }, subhead: "script", tagline: "pill", when: "plain", window: null, qr: "corner" },
    scene: "code",
    seed: { greeting: "none", accent: false, subhead: "Save the date", host_label: "Hosted by", contacts_label: "Please contact", note_icon: "star", hero_shape: "rounded", donors_heading: "Our generous donors", when: true },
  },
  // Reference: a ceremony flyer (an arched window with the logo, a two-tone title and a script line; a date band between ornament
  // rules; the picture of the event's subject in a frame).
  ceremony: {
    key: "ceremony",
    label: "Ceremony",
    blurb: "An arched window with the title, the date between ornament rules, and a picture of what the event is about",
    suits: "post",
    order: ["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "when", "hero", "host", "stat", "agenda", "note", "paragraph", "credits", "donors", "closing", "cta", "contacts", "footer", "greeting_bottom"],
    dropOrder: ["footer", "paragraph", "closing", "donors", "credits", "agenda", "note", "greeting_top", "contacts", "cta", "host", "stat", "eyebrow", "subhead", "greeting_bottom", "hero"],
    style: {
      title: { set: "plain", face: "display", caps: false, max: 112, accent: "script" },
      subhead: "serif",
      tagline: "script",
      when: "rules",
      window: { blocks: ["logos", "eyebrow", "title", "subhead", "tagline"], width: 800 },
      qr: "corner",
    },
    scene: "none",
    seed: { greeting: "bottom", accent: true, subhead: "", host_label: "Hosted by", contacts_label: "Please contact", note_icon: "leaf", hero_shape: "arch", donors_heading: "Our generous donors", when: true },
  },
  // Reference: an event-day flyer (two logos, a huge title, a statistic, a dark date band, agenda rows, a short paragraph, the team).
  event_day: {
    key: "event_day",
    label: "Event day",
    blurb: "A busy day: a huge title, a highlight number, a date band, and the agenda row by row",
    suits: "tall",
    order: ["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "stat", "when", "agenda", "hero", "host", "note", "paragraph", "credits", "donors", "closing", "cta", "contacts", "footer", "greeting_bottom"],
    dropOrder: ["footer", "paragraph", "closing", "donors", "credits", "hero", "greeting_top", "note", "host", "contacts", "cta", "eyebrow", "greeting_bottom", "tagline", "stat", "subhead"],
    style: { title: { set: "plain", face: "display", caps: false, max: 142, accent: "colour" }, subhead: "caps", tagline: "line", when: "band", window: null, qr: "corner" },
    scene: "code",
    seed: { greeting: "none", accent: true, subhead: "", host_label: "Hosted by", contacts_label: "Please contact", note_icon: "star", hero_shape: "rounded", donors_heading: "Our generous donors", when: true },
  },
  // Reference: a thank-you to the people who made something happen (a ribbon title, a short story, a picture, one card for each team,
  // the donors, a closing message and a greeting).
  thank_you: {
    key: "thank_you",
    label: "Thank you",
    blurb: "Thank the people who made it happen: a card for each team, the donors, a closing message",
    suits: "tall",
    order: ["greeting_top", "logos", "eyebrow", "title", "subhead", "tagline", "paragraph", "hero", "credits", "donors", "closing", "host", "stat", "when", "agenda", "note", "cta", "contacts", "footer", "greeting_bottom"],
    dropOrder: ["footer", "host", "stat", "when", "agenda", "note", "cta", "contacts", "greeting_top", "tagline", "eyebrow", "paragraph", "hero", "closing", "donors", "subhead", "greeting_bottom", "credits"],
    style: { title: { set: "banner", face: "display", caps: false, max: 104, accent: "colour" }, subhead: "serif", tagline: "line", when: "cells", window: null, qr: "corner" },
    scene: "none",
    seed: { greeting: "bottom", accent: false, subhead: "", host_label: "Hosted by", contacts_label: "Please contact", note_icon: "heart", hero_shape: "rounded", donors_heading: "Our generous donors", when: false },
  },
};

export const LAYOUT_PRESET_LIST: readonly PresetSpec[] = LAYOUT_PRESET_KEYS.map((k) => LAYOUT_PRESETS[k]);

export function layoutPreset(key: LayoutPreset): PresetSpec {
  return LAYOUT_PRESETS[key];
}

// ── Present blocks ───────────────────────────────────────────────────────────

/** Whether a block has something to draw: it has content, and the organizer has not switched it off. */
export function blockPresent(
  key: BlockKey,
  p: { poster: PosterContent; layout: PosterLayout; hasLogo: boolean; venue: string; qr?: boolean; hero?: boolean },
): boolean {
  const { poster, layout } = p;
  if (key !== "title" && layout.off.includes(key)) return false;
  switch (key) {
    case "greeting_top":
      return Boolean(layout.greeting.top);
    case "greeting_bottom":
      return Boolean(layout.greeting.bottom);
    case "logos":
      // The community's name stands in for a logo it does not have (so the flyer always says whose it is).
      return poster.logo || poster.partner.on;
    case "eyebrow":
      return Boolean(layout.eyebrow);
    case "title":
      return true;
    case "subhead":
      return Boolean(poster.subhead);
    case "tagline":
      return Boolean(poster.slogan);
    case "hero":
      // The picture is drawn only when it was chosen AND the renderer has it (a photo that cannot be loaded leaves the block out, with a note).
      return Boolean(layout.hero.photo_id) && p.hero === true;
    case "credits":
      return layout.credits.some((g) => g.heading || g.names);
    case "donors":
      return Boolean(layout.donors.names);
    case "closing":
      return Boolean(layout.closing);
    case "host":
      return Boolean(layout.host.names);
    case "stat":
      return poster.stat.on && Boolean(poster.stat.value);
    case "when":
      return poster.ribbon.on && Boolean(poster.ribbon.date || poster.ribbon.time || p.venue);
    case "agenda":
      return poster.agenda.length > 0;
    case "note":
      return Boolean(layout.note.text);
    case "paragraph":
      return Boolean(poster.paragraph);
    case "cta":
      return Boolean(layout.cta);
    case "contacts":
      return layout.contacts.length > 0;
    case "qr":
      return p.qr === true;
    case "footer":
      return Boolean(poster.footer);
  }
}

/** The blocks to draw, in the preset's order. */
export function presentBlocks(poster: PosterContent, layout: PosterLayout, o: { hasLogo: boolean; venue: string; qr?: boolean; hero?: boolean }): BlockKey[] {
  const spec = layoutPreset(layout.preset);
  // The RSVP code is a block in the flow only for a layout that keeps it there; the others draw it in the corner.
  return spec.order.filter((key) => (key !== "qr" || spec.style.qr === "block") && blockPresent(key, { poster, layout, ...o }));
}

// ── Reading and checking ─────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** "Notice, Save the date, Ceremony, Event day or Thank you": the layouts' names in a sentence. */
export function layoutNames(): string {
  const names = LAYOUT_PRESET_KEYS.map((k) => LAYOUT_PRESETS[k].label);
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** A layout from the client or the database, checked; every error is a plain sentence for the organizer. */
export function parseLayout(raw: unknown): { ok: true; layout: PosterLayout } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The layout is missing. Choose a layout again." };
  const o = raw as Record<string, unknown>;
  if (!isLayoutPreset(o.preset)) return { ok: false, error: `Choose a layout: ${layoutNames()}.` };
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const greeting = obj(o.greeting);
  const host = obj(o.host);
  const note = obj(o.note);
  const hero = obj(o.hero);
  const donors = obj(o.donors);
  // Blocks a newer version of the flyer maker knows are skipped, not refused: the rest of the flyer still draws.
  const off = Array.isArray(o.off) ? [...new Set(o.off.filter(isBlockKey))] : [];
  const rawContacts = Array.isArray(o.contacts) ? o.contacts : [];
  if (rawContacts.length > LAYOUT_CONTACTS_MAX) return { ok: false, error: `The contacts block has room for ${LAYOUT_CONTACTS_MAX} people.` };
  const contacts: LayoutContact[] = [];
  for (const c of rawContacts) {
    const row = obj(c);
    const name = cleanLine(row.name);
    const detail = cleanLine(row.detail);
    if (name || detail) contacts.push({ name, detail });
  }
  const heroId = typeof hero.photo_id === "string" && hero.photo_id.trim() ? hero.photo_id.trim().toLowerCase() : null;
  if (heroId && !UUID.test(heroId)) return { ok: false, error: "Choose a picture from one of the albums." };
  const rawCredits = Array.isArray(o.credits) ? o.credits : [];
  if (rawCredits.length > CREDIT_GROUPS_MAX) return { ok: false, error: `The thank-you cards have room for ${CREDIT_GROUPS_MAX} groups.` };
  const credits: CreditGroup[] = [];
  for (const g of rawCredits) {
    const row = obj(g);
    const heading = cleanLine(row.heading);
    const names = cleanLine(row.names);
    if (heading || names) credits.push({ heading, names, icon: isPosterIcon(row.icon) ? row.icon : "people" });
  }
  const layout: PosterLayout = {
    preset: o.preset,
    off,
    accent: cleanLine(o.accent),
    eyebrow: cleanLine(o.eyebrow),
    greeting: { top: cleanLine(greeting.top), bottom: cleanLine(greeting.bottom) },
    host: { label: cleanLine(host.label), names: cleanLine(host.names) },
    note: { icon: isPosterIcon(note.icon) ? note.icon : "leaf", text: cleanLine(note.text) },
    cta: cleanLine(o.cta),
    contacts_label: cleanLine(o.contacts_label),
    contacts,
    hero: { photo_id: heroId, shape: isHeroShape(hero.shape) ? hero.shape : "rounded" },
    credits,
    donors: { heading: cleanLine(donors.heading), names: cleanLine(donors.names) },
    closing: cleanLine(o.closing),
  };
  const checks: [keyof typeof LAYOUT_LIMITS, string][] = [
    ["accent", layout.accent],
    ["eyebrow", layout.eyebrow],
    ["greeting", layout.greeting.top],
    ["greeting", layout.greeting.bottom],
    ["host_label", layout.host.label],
    ["host_names", layout.host.names],
    ["note_text", layout.note.text],
    ["cta", layout.cta],
    ["contacts_label", layout.contacts_label],
    ["donors_heading", layout.donors.heading],
    ["donors_names", layout.donors.names],
    ["closing", layout.closing],
    ...layout.credits.flatMap((g): [keyof typeof LAYOUT_LIMITS, string][] => [
      ["credit_heading", g.heading],
      ["credit_names", g.names],
    ]),
    ...layout.contacts.flatMap((c): [keyof typeof LAYOUT_LIMITS, string][] => [
      ["contact_name", c.name],
      ["contact_detail", c.detail],
    ]),
  ];
  for (const [key, value] of checks) {
    if (flyerTextLength(value) > LAYOUT_LIMITS[key]) return { ok: false, error: `The ${LIMIT_LABEL[key]} is longer than ${LAYOUT_LIMITS[key]} characters.` };
  }
  return { ok: true, layout };
}

// ── Starting points ──────────────────────────────────────────────────────────

/** The title's last word as its accent (a title of two or more words, the word short enough to stand out), else none. */
export function defaultAccent(headline: string): string {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  return words.length >= 2 && last && Array.from(last).length <= 16 ? last : "";
}

/**
 * A new layout's content for a preset: what its seed says, and the community's own greeting when it has one (`greeting`: the
 * server works it out with greetingFor(), so the panels need not know the community's tradition).
 */
export function defaultLayout(preset: LayoutPreset, e: { headline: string; greeting?: string }): PosterLayout {
  const spec = layoutPreset(preset);
  const greeting = cleanLine(e.greeting);
  return {
    preset,
    off: [],
    accent: spec.seed.accent ? defaultAccent(e.headline) : "",
    eyebrow: "",
    greeting: { top: spec.seed.greeting === "both" ? greeting : "", bottom: spec.seed.greeting === "none" ? "" : greeting },
    host: { label: spec.seed.host_label, names: "" },
    note: { icon: spec.seed.note_icon, text: "" },
    cta: "",
    contacts_label: spec.seed.contacts_label,
    contacts: [],
    hero: { photo_id: null, shape: spec.seed.hero_shape },
    credits: [],
    donors: { heading: spec.seed.donors_heading, names: "" },
    closing: "",
  };
}

/**
 * The poster with a layout chosen. Everything already typed is kept (a layout only changes how the words are arranged), so
 * moving from one layout to another loses nothing; a layout chosen for the first time starts from its own seed. The poster's
 * sub-title starts as the preset's own words when it has none, and the bottom scene follows the preset (a dense notice has none).
 */
export function withLayoutPreset(poster: PosterContent, preset: LayoutPreset, e: { headline: string; greeting?: string }): PosterContent {
  const spec = layoutPreset(preset);
  const layout: PosterLayout = poster.layout ? { ...poster.layout, preset } : defaultLayout(preset, e);
  return {
    ...poster,
    layout,
    // A thank-you has no date by default; the date block comes back with the next layout (what was typed is kept either way).
    ribbon: { ...poster.ribbon, on: spec.seed.when },
    subhead: poster.subhead || spec.seed.subhead,
    scene: spec.scene === "none" ? { source: "none" } : poster.scene.source === "none" ? { source: "code" } : poster.scene,
  };
}

/** The poster without a layout: the original stacked poster, with every word it had. */
export function withoutLayout(poster: PosterContent): PosterContent {
  const { layout: _layout, ...rest } = poster;
  void _layout;
  return rest;
}

// ── The title's words ────────────────────────────────────────────────────────

export type TitleWord = { text: string; accent: boolean };

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The headline's words, those matching the accent (the first run of them in the headline) marked. An accent not in the headline marks nothing. */
export function titleWords(headline: string, accent: string): TitleWord[] {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  const want = accent.trim().split(/\s+/).map(norm).filter(Boolean);
  const marks = new Array<boolean>(words.length).fill(false);
  if (want.length) {
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, j) => norm(words[i + j]!) === w)) {
        for (let j = 0; j < want.length; j++) marks[i + j] = true;
        break;
      }
    }
  }
  return words.map((text, i) => ({ text, accent: marks[i]! }));
}

/**
 * Whether every letter is one the bundled script font has (Latin, Latin-1 and punctuation). A word with anything else (Gujarati,
 * Devanagari, a letter with a macron) is set in the display font instead, so no letter is ever missing.
 */
export function scriptSafe(text: string): boolean {
  return /^[ -~ -ÿ -⁯]*$/.test(text);
}

/** Every word the layout adds (for choosing fonts). */
export function layoutText(l: PosterLayout): string {
  return [
    l.accent,
    l.eyebrow,
    l.greeting.top,
    l.greeting.bottom,
    l.host.label,
    l.host.names,
    l.note.text,
    l.cta,
    l.contacts_label,
    ...l.contacts.flatMap((c) => [c.name, c.detail]),
    ...l.credits.flatMap((g) => [g.heading, g.names]),
    l.donors.heading,
    l.donors.names,
    l.closing,
  ].join(" ");
}

// ── Preset thumbnails ────────────────────────────────────────────────────────

/** The colours a thumbnail is drawn in (a palette's paper, ink, accent and gold). */
export type ThumbColors = { paper: string; ink: string; accent: string; gold: string };

type Bar = { h: number; fill: "ink" | "accent" | "gold" | "card"; w: number; round?: boolean; gap?: number };
const THUMB_BARS: Record<BlockKey, Bar | null> = {
  greeting_top: { h: 5, fill: "gold", w: 0.34, round: true },
  logos: { h: 10, fill: "gold", w: 0.4, round: true },
  eyebrow: { h: 5, fill: "ink", w: 0.26, round: true },
  title: { h: 16, fill: "ink", w: 0.8 },
  subhead: { h: 6, fill: "gold", w: 0.5, round: true },
  tagline: { h: 7, fill: "accent", w: 0.6, round: true },
  hero: { h: 22, fill: "card", w: 0.5, round: true },
  host: { h: 12, fill: "card", w: 0.84, round: true },
  stat: { h: 14, fill: "card", w: 0.72, round: true },
  when: { h: 16, fill: "accent", w: 0.92 },
  agenda: { h: 15, fill: "card", w: 0.8 },
  note: { h: 10, fill: "card", w: 0.82, round: true },
  paragraph: { h: 8, fill: "ink", w: 0.7 },
  credits: { h: 18, fill: "card", w: 0.88 },
  donors: { h: 10, fill: "card", w: 0.84, round: true },
  closing: { h: 6, fill: "accent", w: 0.6, round: true },
  cta: { h: 6, fill: "accent", w: 0.5, round: true },
  contacts: { h: 12, fill: "card", w: 0.84, round: true },
  qr: { h: 12, fill: "ink", w: 0.2 },
  footer: { h: 4, fill: "ink", w: 0.4, round: true },
  greeting_bottom: { h: 6, fill: "accent", w: 0.4, round: true },
};

/** A small drawing of a preset: one bar for each block it starts with, in its order (built from the preset's own data, so a new preset needs no new drawing). */
export function presetThumbnailSvg(preset: LayoutPreset, c: ThumbColors, shown?: readonly BlockKey[]): string {
  const spec = layoutPreset(preset);
  const W = 100;
  const H = spec.suits === "square" ? 100 : 125;
  const keys = shown ?? sampleBlocks(spec);
  const bars = keys.map((k) => THUMB_BARS[k]).filter((b): b is Bar => Boolean(b));
  const total = bars.reduce((a, b) => a + b.h, 0);
  const gap = Math.max(2, Math.min(7, (H - 16 - total) / Math.max(1, bars.length - 1)));
  let y = Math.max(8, (H - (total + gap * (bars.length - 1))) / 2);
  const col = (f: Bar["fill"]) => (f === "ink" ? c.ink : f === "accent" ? c.accent : f === "gold" ? c.gold : c.paper);
  const parts = bars.map((b) => {
    const w = W * b.w;
    const x = (W - w) / 2;
    const rect =
      b.fill === "card"
        ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${b.h}" rx="${b.round ? 3 : 1}" fill="${c.gold}" fill-opacity="0.16" stroke="${c.gold}" stroke-width="0.8"/>`
        : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${b.h}" rx="${b.round ? b.h / 2 : 1}" fill="${col(b.fill)}"/>`;
    y += b.h + gap;
    return rect;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" rx="4" fill="${c.paper}"/><rect x="2.5" y="2.5" width="${W - 5}" height="${H - 5}" rx="3" fill="none" stroke="${c.gold}" stroke-width="1"/>` +
    parts.join("") +
    `</svg>`
  );
}

/** The blocks a preset's thumbnail shows: what a new flyer in that layout typically holds. */
function sampleBlocks(spec: PresetSpec): BlockKey[] {
  const typical: Record<LayoutPreset, BlockKey[]> = {
    notice: ["greeting_top", "logos", "eyebrow", "title", "subhead", "host", "when", "note", "contacts", "greeting_bottom"],
    save_the_date: ["logos", "title", "subhead", "tagline", "when", "cta"],
    ceremony: ["logos", "title", "tagline", "when", "hero", "footer"],
    event_day: ["logos", "title", "subhead", "tagline", "stat", "when", "agenda", "footer"],
    thank_you: ["logos", "title", "subhead", "paragraph", "credits", "donors", "closing", "greeting_bottom"],
  };
  return spec.order.filter((k) => typical[spec.key].includes(k));
}

/** The original stacked poster's thumbnail (the choice before the layouts): logos, title, sub-title, highlight box, date ribbon, agenda. */
export function originalThumbnailSvg(c: ThumbColors): string {
  return presetThumbnailSvg("notice", c, ["logos", "title", "subhead", "tagline", "stat", "when", "agenda", "paragraph"]);
}

/** The names of people typed into the layout (the host card, the contacts, the thank-you cards and the donors), for the check against the community's children. */
export function layoutPeople(l: PosterLayout): string[] {
  return [
    l.off.includes("host") ? "" : l.host.names,
    ...(l.off.includes("contacts") ? [] : l.contacts.map((c) => c.name)),
    ...(l.off.includes("credits") ? [] : l.credits.map((g) => g.names)),
    l.off.includes("donors") ? "" : l.donors.names,
  ].filter(Boolean);
}
