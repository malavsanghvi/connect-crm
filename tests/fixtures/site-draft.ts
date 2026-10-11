// Shared pieces of the website-draft tests (root tests and the background service's tests): the kinds as the 0594 seed words them, a
// made-up set of Weaver's own records, and helpers for reading the text of a draft.

import { parseKindProfile, type KindProfile } from "../../src/lib/kind";
import type { DraftBlock, SiteDraft } from "../../src/lib/site-draft/types";
import { parseWeaverData, type WeaverData } from "../../src/lib/site-draft/weaver";

// ── Kinds, as the 0594 seed words them ───────────────────────────────────────────────────────────────────────────
export const kind = (key: string, label: string, faith: boolean, tradition: boolean, terms: Record<string, string | null>, modules: Record<string, { availability: string; label: string | null }> = {}): KindProfile =>
  parseKindProfile({ category: { key, label, faith_based: faith, uses_tradition: tradition, terms }, modules })!;
export const JAIN = kind("jain_center", "Jain Center", true, true, { greeting: "Jai Jinendra", practice_tab: "Jain Way", give_tab: "Give", family_tab: "Family", store: "Satvik Store", school: "Pathshala", learning: "Gyan Path", place: "derasar" });
export const CHAMBER = kind("chamber_of_commerce", "Chamber of commerce", false, false, { greeting: "Welcome", practice_tab: null, give_tab: "Pay", family_tab: "My business", store: "Store", school: null, learning: null, place: "office" }, { pathshala: { availability: "not_available", label: null }, bolis: { availability: "not_available", label: null } });
export const SECULAR = kind("nonprofit_secular", "Non-profit (not faith-based)", false, false, { greeting: "Welcome", practice_tab: null, give_tab: "Give", family_tab: "Family", store: "Store", school: null, learning: null, place: "office" }, { pathshala: { availability: "not_available", label: null } });
export const FAITH = kind("faith_other", "Faith-based non-profit (other faiths)", true, false, { greeting: "Welcome", practice_tab: "Learn", give_tab: "Give", family_tab: "Family", store: "Store", school: "Religious school", learning: "Learning path", place: "place of worship" });
export const KIND_OF: Record<string, KindProfile> = { temple: JAIN, chamber: CHAMBER, church: FAITH, club: SECULAR };
export const JAIN_WORDS = /pathshala|derasar|darshan|aarti|pujan|puja\b|bhandar|\bboli|jain|jinendra|panchang|tithi|parva|navkarsi|chauvihar|satvik|gyan/i;

// ── Weaver's own records (made up) ───────────────────────────────────────────────────────────────────────────────
export const weaverJson = (over: Record<string, unknown> = {}) => ({
  center: { name: "Maple Hall Community", short_name: "Maple Hall", time_zone: "America/Chicago" },
  profile: {
    mission: "We bring neighbours together to learn, celebrate and serve.",
    about: "Maple Hall Community was started by a few families.\n\nToday it hosts classes, meals and celebrations.",
    public_email: "hello@maplehall.example.org",
    public_phone: "+12815550199",
    office_hours: "Weekdays, ten to four",
    address: "77 Orchard Lane, Katy, TX 77494",
    latitude: 29.7858,
    longitude: -95.8244,
    social: { facebook: "https://www.facebook.com/maplehall", instagram: "https://www.instagram.com/maplehall" },
  },
  leaders: [
    { name: "Asha Verma", title: "President" },
    { name: "Dev Rao", title: "Treasurer" },
  ],
  events: {
    on: true,
    items: [
      { title: "Harvest Supper", starts_at: "2026-11-14T18:00:00+00:00", ends_at: "2026-11-14T20:00:00+00:00", venue: "Main hall", description: "A shared meal for everyone." },
      { title: "Winter Concert", starts_at: "2026-12-05T19:00:00+00:00", ends_at: null, venue: null, description: null },
    ],
  },
  giving: { on: true, campaigns: [{ name: "Roof Fund", kind: "construction", description: "Repair the roof.", items: [{ name: "Sponsor a beam", description: null }] }] },
  today: { date: "2026-10-11", open: "06:00", close: "20:00" },
  albums: [{ title: "Harvest Supper photos", photos: 24 }],
  store: { on: true, items: ["Tea towels", "Notebooks"] },
  school: { on: true, levels: ["Level One", "Level Two"], term: { name: "Autumn term", starts_on: "2026-09-13", ends_on: "2027-05-02", status: "active" } },
  ...over,
});
export const weaver = (over: Record<string, unknown> = {}): WeaverData => parseWeaverData(weaverJson(over))!;
export const emptyWeaver = (): WeaverData =>
  weaver({
    profile: {},
    leaders: [],
    events: { on: true, items: [] },
    giving: { on: true, campaigns: [] },
    today: null,
    albums: [],
    store: { on: false, items: [] },
    school: { on: false, levels: [], term: null },
  });

// ── Reading the draft ────────────────────────────────────────────────────────────────────────────────────────────
/** Every piece of text in a value, with where it is. */
export function strings(v: unknown, path = "$"): [string, string][] {
  if (typeof v === "string") return [[path, v]];
  if (Array.isArray(v)) return v.flatMap((x, i) => strings(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => strings(x, `${path}.${k}`));
  return [];
}
export const blocksOf = (d: SiteDraft): DraftBlock[] => d.pages.flatMap((p) => p.blocks);
/** The words a person would read in a block: not the technical fields (addresses of pictures and links, page slugs, names of networks). */
export const SKIP_KEYS = /\.(src|url|page|network|starts_at|ends_at|time_zone)(\]|$)/;
export const readable = (b: DraftBlock): string[] => strings(b.content).filter(([path]) => !SKIP_KEYS.test(path)).map(([, s]) => s);
export const words = (s: string): string[] => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
export const shingles = (text: string, n = 4): Set<string> => {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
};
export const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
