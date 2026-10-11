// Reads a stored draft (the answer of app.site_draft_get, migration 0642) back into typed data, field by field. The preview
// and the Setup screen show only what passes these checks: a block whose content is not what its type promises is dropped,
// a web address that is not http or https is left out, a colour that is not #rrggbb is replaced by Weaver's own.

import { arr, fontName, hex, num, rec, str, webAddress } from "../site-found";
import { DEFAULT_PALETTE, readableOn } from "./theme";
import {
  BLOCK_SOURCES,
  BLOCK_TYPES,
  DENSITIES,
  HERO_STYLES,
  PAGE_STATUSES,
  SITE_PAGE_KINDS,
  type BlockType,
  type ContentOf,
  type DraftSummary,
  type Img,
  type PageLink,
  type SiteTheme,
  type SocialItem,
  type StoredBlock,
  type StoredDraft,
  type StoredPage,
} from "./types";

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const nul = (s: string): string | null => (s === "" ? null : s);
const strList = (v: unknown, max: number, limit: number): string[] => arr(v).map((x) => str(x, max)).filter(Boolean).slice(0, limit);

const img = (v: unknown): Img | null => {
  const r = rec(v);
  const src = webAddress(r?.src);
  return src ? { src, alt: str(r?.alt, 200) } : null;
};
const link = (v: unknown): PageLink | null => {
  const r = rec(v);
  const label = str(r?.label, 80);
  const page = typeof r?.page === "string" && SLUG.test(r.page) ? r.page : "";
  return label !== "" && page !== "" ? { label, page } : null;
};
const social = (v: unknown): SocialItem[] =>
  arr(v)
    .slice(0, 10)
    .map((s) => ({ network: str(rec(s)?.network, 30).toLowerCase(), url: webAddress(rec(s)?.url) ?? "" }))
    .filter((s) => s.network !== "" && s.url !== "");

/** One block's content, or null when it is not what the type promises. */
export function parseContent<T extends BlockType>(type: T, raw: unknown): ContentOf[T] | null {
  const c = rec(raw);
  if (!c) return null;
  const heading = str(c.heading, 160);
  let out: unknown = null;
  switch (type) {
    case "hero":
      if (str(c.heading, 160) === "") return null;
      out = { eyebrow: nul(str(c.eyebrow, 80)), heading, subheading: nul(str(c.subheading, 400)), image: img(c.image), cta: link(c.cta) };
      break;
    case "text":
      out = { heading, paragraphs: strList(c.paragraphs, 1500, 12) };
      break;
    case "events_list":
      out = {
        heading,
        time_zone: nul(str(c.time_zone, 60)),
        events: arr(c.events)
          .slice(0, 30)
          .map((e) => ({ title: str(rec(e)?.title, 160), starts_at: str(rec(e)?.starts_at, 40), ends_at: nul(str(rec(e)?.ends_at, 40)), venue: nul(str(rec(e)?.venue, 160)), description: nul(str(rec(e)?.description, 400)) }))
          .filter((e) => e.title !== "" && e.starts_at !== ""),
        empty: nul(str(c.empty, 200)),
      };
      break;
    case "giving_cta": {
      const cta = rec(c.cta);
      out = {
        heading,
        body: nul(str(c.body, 600)),
        items: arr(c.items)
          .slice(0, 20)
          .map((i) => ({ name: str(rec(i)?.name, 160), description: nul(str(rec(i)?.description, 500)) }))
          .filter((i) => i.name !== ""),
        cta: cta && str(cta.label, 80) !== "" ? { label: str(cta.label, 80) } : null,
      };
      break;
    }
    case "gallery":
      out = {
        heading,
        albums: arr(c.albums)
          .slice(0, 20)
          .map((a) => ({ title: str(rec(a)?.title, 160), photos: Math.max(0, Math.round(num(rec(a)?.photos))) }))
          .filter((a) => a.title !== ""),
        images: arr(c.images)
          .slice(0, 24)
          .map(img)
          .filter((i): i is Img => i !== null),
        licence_unchecked: c.licence_unchecked === true,
      };
      break;
    case "leaders":
      out = {
        heading,
        people: arr(c.people)
          .slice(0, 60)
          .map((p) => ({ name: str(rec(p)?.name, 120), title: str(rec(p)?.title, 80) }))
          .filter((p) => p.name !== "" && p.title !== ""),
      };
      break;
    case "contact":
      out = {
        heading,
        emails: strList(c.emails, 120, 5),
        phones: strList(c.phones, 40, 5),
        addresses: strList(c.addresses, 300, 3),
        hours: nul(str(c.hours, 500)),
        today: nul(str(c.today, 160)),
        social: social(c.social),
        note: nul(str(c.note, 400)),
      };
      break;
    case "map": {
      const lat = c.latitude === null || c.latitude === undefined ? null : num(c.latitude);
      const lng = c.longitude === null || c.longitude === undefined ? null : num(c.longitude);
      const point = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
      out = { heading, address: nul(str(c.address, 300)), latitude: point ? lat : null, longitude: point ? lng : null };
      break;
    }
    case "faq":
      out = {
        heading,
        items: arr(c.items)
          .slice(0, 30)
          .map((i) => ({ question: str(rec(i)?.question, 200), answer: str(rec(i)?.answer, 1000) }))
          .filter((i) => i.question !== ""),
      };
      break;
    case "footer":
      out = {
        name: str(c.name, 160),
        lines: strList(c.lines, 300, 6),
        links: arr(c.links)
          .slice(0, 12)
          .map(link)
          .filter((l): l is PageLink => l !== null),
        social: social(c.social),
      };
      break;
  }
  return out as ContentOf[T];
}

export function parseTheme(raw: unknown): SiteTheme {
  const t = rec(raw) ?? {};
  const p = rec(t.palette) ?? {};
  const fonts = rec(t.fonts) ?? {};
  const from = rec(t.from) ?? {};
  const color = (k: string, fallback: string): string => hex(p[k]) ?? fallback;
  const primary = color("primary", DEFAULT_PALETTE.primary);
  const src = (v: unknown, allowed: readonly string[], fallback: string): string => (typeof v === "string" && allowed.includes(v) ? v : fallback);
  return {
    palette: {
      primary,
      secondary: color("secondary", DEFAULT_PALETTE.secondary),
      accent: color("accent", DEFAULT_PALETTE.accent),
      background: color("background", DEFAULT_PALETTE.background),
      text: color("text", DEFAULT_PALETTE.text),
      on_primary: hex(p.on_primary) ?? readableOn(primary),
    },
    fonts: { heading: fontName(fonts.heading), body: fontName(fonts.body) },
    logo: img(t.logo),
    hero_style: oneOf(HERO_STYLES, t.hero_style) ?? "text",
    density: oneOf(DENSITIES, t.density) ?? "medium",
    from: {
      palette: src(from.palette, ["own_site", "reference_hint", "default"], "default") as SiteTheme["from"]["palette"],
      fonts: src(from.fonts, ["own_site", "reference_hint", "default"], "default") as SiteTheme["from"]["fonts"],
      layout: src(from.layout, ["own_site", "reference_hint", "default"], "default") as SiteTheme["from"]["layout"],
      logo: src(from.logo, ["own_site", "none"], "none") as SiteTheme["from"]["logo"],
    },
  };
}

function parseBlock(raw: unknown): StoredBlock | null {
  const b = rec(raw);
  const type = oneOf(BLOCK_TYPES, b?.type);
  const source = oneOf(BLOCK_SOURCES, b?.source);
  const id = str(b?.id, 60);
  if (!b || !type || !source || id === "") return null;
  const content = parseContent(type, b.content);
  if (!content) return null;
  const sourcePage = webAddress(b.source_page);
  if (source === "own_site" && !sourcePage) return null;
  return { id, type, content, source, source_page: source === "own_site" ? sourcePage : null, needs_text: b.needs_text === true || source === "written" } as StoredBlock;
}

/** app.site_draft_get's answer in full, or null when there is no draft or it is not the expected shape. */
export function parseStoredDraft(data: unknown): StoredDraft | null {
  const root = rec(data);
  const site = rec(root?.site);
  if (!root || !site || !Array.isArray(root.pages)) return null;
  const pages: StoredPage[] = [];
  for (const raw of root.pages) {
    const p = rec(raw);
    const kind = oneOf(SITE_PAGE_KINDS, p?.kind);
    const status = oneOf(PAGE_STATUSES, p?.status);
    const slug = typeof p?.slug === "string" && SLUG.test(p.slug) ? p.slug : "";
    const id = str(p?.id, 60);
    if (!p || !kind || !status || slug === "" || id === "") continue;
    const blocks = arr(p.blocks).map(parseBlock).filter((b): b is StoredBlock => b !== null);
    pages.push({
      id,
      slug,
      title: str(p.title, 120),
      kind,
      status,
      approved_at: nul(str(p.approved_at, 40)),
      source_path: nul(str(p.source_path, 300)),
      blocks,
      block_count: Array.isArray(p.blocks) ? blocks.length : Math.max(0, Math.round(num(p.block_count))),
      stand_ins: Array.isArray(p.blocks) ? blocks.filter((b) => b.needs_text).length : Math.max(0, Math.round(num(p.stand_ins))),
    });
  }
  return { name: str(site.name, 200), draft_version: Math.max(1, Math.round(num(site.draft_version))), built_at: nul(str(site.built_at, 40)), theme: parseTheme(site.theme), pages };
}

/** The Setup screen's one line per page. */
export function summarizeDraft(draft: StoredDraft): DraftSummary {
  return {
    draftVersion: draft.draft_version,
    builtAt: draft.built_at,
    pages: draft.pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, kind: p.kind, status: p.status, blocks: p.block_count, standIns: p.stand_ins })),
  };
}
