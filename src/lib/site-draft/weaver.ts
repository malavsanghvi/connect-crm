// Weaver's own records of an organization that a first draft of its website may use: the answer of app.site_draft_data
// (migration 0643), read field by field. The database sends only what is meant to be public (events open to the public or
// to guests, published giving, leaders the organization chose to show, public albums); this reads it into small types and
// drops whatever is not what was expected.

import { arr, num, rec, str, webAddress } from "../site-found";
import type { AlbumItem, EventItem, GivingItem, PersonItem, SocialItem } from "./types";

export type WeaverData = {
  name: string;
  shortName: string | null;
  timeZone: string | null;
  mission: string | null;
  about: string | null;
  email: string | null;
  phone: string | null;
  officeHours: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  social: SocialItem[];
  leaders: PersonItem[];
  events: { on: boolean; items: EventItem[] };
  giving: { on: boolean; campaigns: { name: string; kind: string; description: string | null; items: GivingItem[] }[] };
  today: { date: string; open: string | null; close: string | null } | null;
  albums: AlbumItem[];
  store: { on: boolean; items: string[] };
  school: { on: boolean; levels: string[]; term: { name: string; startsOn: string; endsOn: string; status: string } | null };
};

/** Long text with its paragraph breaks kept (a blank line between paragraphs), each paragraph on one line. */
const longText = (v: unknown, max: number): string =>
  typeof v === "string"
    ? v
        .split(/\r?\n\s*\r?\n/)
        .map((p) => str(p, max))
        .filter(Boolean)
        .join("\n\n")
        .slice(0, max)
    : "";
const nul = (s: string): string | null => (s === "" ? null : s);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "+12815550142" as "(281) 555-0142"; any other number is shown as it was saved. */
export function formatPhone(raw: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw.trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw.trim();
}

export function parseWeaverData(data: unknown): WeaverData | null {
  const root = rec(data);
  const center = rec(root?.center);
  if (!root || !center) return null;
  const name = str(center.name, 160);
  if (name === "") return null;
  const profile = rec(root.profile) ?? {};
  const events = rec(root.events) ?? {};
  const giving = rec(root.giving) ?? {};
  const today = rec(root.today);
  const store = rec(root.store) ?? {};
  const school = rec(root.school) ?? {};
  const term = rec(school.term);

  const lat = profile.latitude === null || profile.latitude === undefined ? null : num(profile.latitude);
  const lng = profile.longitude === null || profile.longitude === undefined ? null : num(profile.longitude);
  const point = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const social: SocialItem[] = [];
  for (const [k, v] of Object.entries(rec(profile.social) ?? {}).slice(0, 10)) {
    const url = webAddress(v);
    if (url && /^[a-z0-9_ -]{1,30}$/i.test(k)) social.push({ network: k.toLowerCase(), url });
  }

  return {
    name,
    shortName: nul(str(center.short_name, 60)),
    timeZone: nul(str(center.time_zone, 60)),
    mission: nul(longText(profile.mission, 1000)),
    about: nul(longText(profile.about, 5000)),
    email: nul(str(profile.public_email, 120)),
    phone: nul(str(profile.public_phone, 40)),
    officeHours: nul(str(profile.office_hours, 500)),
    address: nul(str(profile.address, 300)),
    latitude: point ? lat : null,
    longitude: point ? lng : null,
    social,
    leaders: arr(root.leaders)
      .slice(0, 40)
      .map((l) => ({ name: str(rec(l)?.name, 120), title: str(rec(l)?.title, 80) }))
      .filter((l) => l.name !== "" && l.title !== ""),
    events: {
      on: events.on === true,
      items: arr(events.items)
        .slice(0, 30)
        .map((e) => {
          const r = rec(e);
          return { title: str(r?.title, 160), starts_at: str(r?.starts_at, 40), ends_at: nul(str(r?.ends_at, 40)), venue: nul(str(r?.venue, 160)), description: nul(str(r?.description, 400)) };
        })
        .filter((e) => e.title !== "" && STAMP.test(e.starts_at)),
    },
    giving: {
      on: giving.on === true,
      campaigns: arr(giving.campaigns)
        .slice(0, 8)
        .map((c) => {
          const r = rec(c);
          return {
            name: str(r?.name, 160),
            kind: str(r?.kind, 30),
            description: nul(str(r?.description, 500)),
            items: arr(r?.items)
              .slice(0, 10)
              .map((i) => ({ name: str(rec(i)?.name, 160), description: nul(str(rec(i)?.description, 300)) }))
              .filter((i) => i.name !== ""),
          };
        })
        .filter((c) => c.name !== ""),
    },
    today:
      today && DATE.test(str(today.date, 12))
        ? { date: str(today.date, 12), open: TIME.test(str(today.open, 10)) ? str(today.open, 10).slice(0, 5) : null, close: TIME.test(str(today.close, 10)) ? str(today.close, 10).slice(0, 5) : null }
        : null,
    albums: arr(root.albums)
      .slice(0, 12)
      .map((a) => ({ title: str(rec(a)?.title, 160), photos: Math.max(0, Math.round(num(rec(a)?.photos))) }))
      .filter((a) => a.title !== ""),
    store: { on: store.on === true, items: arr(store.items).map((s) => str(s, 120)).filter(Boolean).slice(0, 8) },
    school: {
      on: school.on === true,
      levels: arr(school.levels).map((s) => str(s, 80)).filter(Boolean).slice(0, 12),
      term:
        term && str(term.name, 80) !== "" && DATE.test(str(term.starts_on, 12)) && DATE.test(str(term.ends_on, 12))
          ? { name: str(term.name, 80), startsOn: str(term.starts_on, 12), endsOn: str(term.ends_on, 12), status: str(term.status, 20) }
          : null,
    },
  };
}
