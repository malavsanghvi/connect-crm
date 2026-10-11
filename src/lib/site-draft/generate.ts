// The first draft of an organization's website, built from what Weaver found on its current website and from Weaver's own
// records (B92 phase W3). Pure: data in, data out, no database and no network.
//
// THE RULES (each one is tested in tests/site-draft.test.ts):
//   1. The old website's words are kept as the organization's own, with the old page named (source own_site). Only pages the
//      reader was sure about (confidence 0.5 or more) and could read (not built by scripts) lend their words.
//   2. Where Weaver has the facts itself (events, giving, leaders, contact details, classes, store, albums) it uses them
//      (source weaver_data). Nothing is rewritten, rounded or guessed.
//   3. Where nothing is available it writes a short, general stand-in (source written, needs_text) for the person to replace.
//      A stand-in has no date, number or name in it.
//   4. Websites the organization likes give only layout patterns and colours (the order of the home page's sections, a hero
//      style, a colour or a font name). The reader (crawl.ts) has no way to pass their words or pictures on.
//   5. Headings follow the organization's kind (wording.ts): no Jain word for a kind without a tradition.

import type { KindProfile } from "../kind";
import { type CrawlBlockKind, type CrawlPageKind, type OwnCrawl, type OwnPage, type ReferenceHints } from "./crawl";
import { buildTheme } from "./theme";
import { clockTime, cutText, joinWords, keepText, longDate, paragraphsOf, tidyTitle } from "./text";
import type { BlockSource, BlockType, ContentOf, DraftBlock, DraftPage, GalleryContent, GivingContent, Img, SiteDraft, SitePageKind, SocialItem, TextContent } from "./types";
import { formatPhone, type WeaverData } from "./weaver";
import { NO_EVENTS, STAND_IN, siteWords, type SiteWords } from "./wording";

export type DraftInput = {
  /** The organization's own website as read (null when it has none, or none has been read yet). */
  own: OwnCrawl | null;
  /** Websites the organization likes: layout hints only. */
  references: readonly ReferenceHints[];
  weaver: WeaverData;
  kind: KindProfile;
};

const MIN_CONFIDENCE = 0.5;

function mk<T extends BlockType>(type: T, content: ContentOf[T], source: BlockSource, sourcePage: string | null = null): DraftBlock {
  if (source === "own_site" && !sourcePage) throw new Error(`A block kept from the old website must name its page (${type}).`);
  return { type, content, source, source_page: source === "own_site" ? sourcePage : null, needs_text: source === "written" } as DraftBlock;
}

/** The path of an old page for a page of the draft: only a path that starts with a slash is kept (the database checks it too). */
const srcPath = (path: string | undefined): string | null => (path && path.startsWith("/") ? path : null);

// ── The old website ──────────────────────────────────────────────────────────
const ownRoot = (own: OwnCrawl): string => own.startUrl || (own.site ? `https://${own.site}/` : "");

/** What is needed to tidy the old website's words: its menu (taken off the front of a page's text) and the organization's names (taken off a title). */
type Tidy = { menu: readonly string[]; names: readonly string[]; footer: readonly string[] };

function keptSections(page: OwnPage, max: number, tidy: Tidy): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  for (const s of page.sections) {
    const text = keepText(s.heading, s.excerpt, tidy);
    if (text !== "") out.push({ heading: tidyTitle(s.heading, tidy.names), text });
    if (out.length >= max) break;
  }
  return out;
}

/** The page of the old website of this kind that is worth keeping words from, or null. */
function wordsPage(own: OwnCrawl | null, kind: CrawlPageKind, tidy: Tidy): OwnPage | null {
  if (!own) return null;
  const size = (p: OwnPage) => keptSections(p, 3, tidy).reduce((n, s) => n + s.text.length, 0);
  const ok = own.pages.filter((p) => p.kind === kind && p.confidence >= MIN_CONFIDENCE && !p.builtByScripts && keptSections(p, 1, tidy).length > 0);
  return ok.sort((a, b) => b.confidence - a.confidence || size(b) - size(a))[0] ?? null;
}

function photoPage(own: OwnCrawl | null): { page: OwnPage; images: Img[] } | null {
  if (!own) return null;
  const pages = own.pages
    .filter((p) => p.kind === "gallery" && p.confidence >= MIN_CONFIDENCE)
    .map((page) => ({ page, images: page.images.filter((i) => i.role === "photo" || i.role === "hero").map((i) => ({ src: i.src, alt: i.alt })) }))
    .filter((x) => x.images.length > 0);
  return pages.sort((a, b) => b.images.length - a.images.length)[0] ?? null;
}

function textBlocks(page: OwnPage, max: number, fallbackHeading: string, tidy: Tidy): DraftBlock[] {
  return keptSections(page, max, tidy).map((s) => mk("text", { heading: s.heading || tidyTitle(page.title, tidy.names) || fallbackHeading, paragraphs: [s.text] } satisfies TextContent, "own_site", page.url));
}

// ── Contact details: Weaver's records win, else the old website's, else a stand-in ──
type Contact = { source: BlockSource; emails: string[]; phones: string[]; addresses: string[]; hours: string | null; social: SocialItem[] };

function contactOf(weaver: WeaverData, own: OwnCrawl | null): Contact {
  const emails = weaver.email ? [weaver.email] : [];
  const phones = weaver.phone ? [formatPhone(weaver.phone)] : [];
  const addresses = weaver.address ? [weaver.address] : [];
  if (emails.length || phones.length || addresses.length || weaver.officeHours || weaver.social.length) {
    return { source: "weaver_data", emails, phones, addresses, hours: weaver.officeHours, social: weaver.social };
  }
  if (own && (own.contact.emails.length || own.contact.phones.length || own.contact.addresses.length || own.social.length)) {
    return { source: "own_site", emails: own.contact.emails.slice(0, 3), phones: own.contact.phones.slice(0, 3), addresses: own.contact.addresses.slice(0, 2), hours: null, social: own.social };
  }
  return { source: "written", emails: [], phones: [], addresses: [], hours: null, social: [] };
}

function todayLine(weaver: WeaverData, words: SiteWords): string | null {
  const t = weaver.today;
  if (!words.tradition || !t || !t.open || !t.close) return null;
  return `Open ${clockTime(t.open)} to ${clockTime(t.close)} on ${longDate(t.date)}`;
}

// ── The home page's order of sections ────────────────────────────────────────
type HomeKey = "about" | "events" | "giving" | "gallery";
const DEFAULT_HOME: readonly HomeKey[] = ["about", "events", "giving", "gallery"];
const HOME_KEY: Partial<Record<CrawlBlockKind, HomeKey>> = { about: "about", events: "events", donate: "giving", gallery: "gallery" };

function homeOrder(pattern: readonly CrawlBlockKind[]): HomeKey[] {
  const order: HomeKey[] = [];
  for (const k of pattern) {
    const key = HOME_KEY[k];
    if (key && !order.includes(key)) order.push(key);
  }
  for (const d of DEFAULT_HOME) if (!order.includes(d)) order.push(d);
  return order;
}

// ── The draft ────────────────────────────────────────────────────────────────
export function generateDraft(input: DraftInput): SiteDraft {
  const { weaver, kind, references } = input;
  // An old website with no address to name as the source cannot lend words (every kept block must say where it came from).
  const own = input.own && (ownRoot(input.own) !== "" || input.own.pages.length > 0) ? input.own : null;
  const words = siteWords(kind);
  const rootUrl = own ? ownRoot(own) || own.pages[0]!.url : "";
  const contact = contactOf(weaver, own);
  const tidy: Tidy = { menu: own?.menu ?? [], names: [own?.name ?? "", weaver.name, weaver.shortName ?? ""].filter(Boolean), footer: own ? [...own.contact.addresses, ...own.contact.phones, ...own.contact.emails] : [] };

  const homeOld = wordsPage(own, "home", tidy) ?? own?.pages.find((p) => p.kind === "home" && p.confidence >= MIN_CONFIDENCE) ?? null;
  const aboutOld = wordsPage(own, "about", tidy);
  const eventsOld = wordsPage(own, "events", tidy);
  const giveOld = wordsPage(own, "donate", tidy);
  const schoolOld = wordsPage(own, "school", tidy);
  const leadersOld = wordsPage(own, "leadership", tidy);
  const photos = photoPage(own);

  // Whether Weaver offers events and giving to this organization is the database's own answer (a module switched off, or one
  // the kind never has, is not on); an old website that had such a page keeps it.
  const eventsOffered = weaver.events.on || eventsOld !== null || weaver.events.items.length > 0;
  const givingOffered = weaver.giving.on || giveOld !== null || weaver.giving.campaigns.length > 0;
  const hasSchool = schoolOld !== null || weaver.school.on;
  const hasGallery = weaver.albums.length > 0 || photos !== null;

  // The home page's section order: the old website's, else a website the organization likes (a hint), else Weaver's own.
  const refPattern = references.find((r) => r.homePattern.length > 0)?.homePattern ?? [];
  const pattern = own && own.homePattern.length > 0 ? own.homePattern : refPattern;
  const patternSource = own && own.homePattern.length > 0 ? "own_site" : refPattern.length > 0 ? "reference_hint" : "default";

  const pages: DraftPage[] = [];
  let heroHasImage = false;

  // ── Home ───────────────────────────────────────────────────────────────────
  {
    const description = own && own.description.length >= 20 ? own.description : "";
    const heroImage = description !== "" ? (homeOld?.images.find((i) => i.role === "hero") ?? null) : null;
    heroHasImage = heroImage !== null;
    const hero: DraftBlock = (() => {
      const base = { eyebrow: words.greeting, heading: weaver.name, cta: eventsOffered ? { label: words.seeEvents, page: "events" } : null };
      if (description !== "") {
        return mk("hero", { ...base, subheading: description, image: heroImage ? { src: heroImage.src, alt: heroImage.alt } : null }, "own_site", homeOld?.url ?? rootUrl);
      }
      const mission = weaver.mission ? cutText(weaver.mission.replace(/\n+/g, " "), 240) : "";
      if (mission !== "") return mk("hero", { ...base, subheading: mission, image: null }, "weaver_data");
      return mk("hero", { ...base, subheading: STAND_IN.welcome, image: null }, "written");
    })();
    const heroUsesMission = hero.source === "weaver_data";

    const body: Record<HomeKey, DraftBlock | null> = {
      about: (() => {
        const aboutParas = weaver.about ? paragraphsOf(weaver.about, 1) : [];
        const text = heroUsesMission ? (aboutParas[0] ?? "") : weaver.mission ? cutText(weaver.mission.replace(/\n+/g, " "), 360) : (aboutParas[0] ?? "");
        return text === "" ? null : mk("text", { heading: words.aboutHeading, paragraphs: [cutText(text, 500)] }, "weaver_data");
      })(),
      events: eventsOffered && (weaver.events.items.length > 0 || pattern.includes("events"))
        ? mk("events_list", { heading: words.eventsHeading, time_zone: weaver.timeZone, events: weaver.events.items.slice(0, 3), empty: weaver.events.items.length === 0 ? NO_EVENTS : null }, "weaver_data")
        : null,
      giving: givingOffered && weaver.giving.campaigns.length > 0
        ? mk("giving_cta", { heading: words.giveHeading, body: null, items: weaver.giving.campaigns.slice(0, 3).map((c) => ({ name: c.name, description: c.description })), cta: { label: words.giveOnline } } satisfies GivingContent, "weaver_data")
        : null,
      gallery: weaver.albums.length > 0
        ? mk("gallery", { heading: words.galleryTitle, albums: weaver.albums.slice(0, 3), images: [], licence_unchecked: false } satisfies GalleryContent, "weaver_data")
        : photos && pattern.includes("gallery")
          ? mk("gallery", { heading: words.galleryTitle, albums: [], images: photos.images.slice(0, 6), licence_unchecked: true } satisfies GalleryContent, "own_site", photos.page.url)
          : null,
    };
    const ordered = homeOrder(pattern).map((k) => body[k]).filter((b): b is DraftBlock => b !== null);
    pages.push({ slug: "home", title: words.homeTitle, kind: "home", source_path: srcPath(homeOld?.path), blocks: [hero, ...ordered] });
  }

  // ── About ──────────────────────────────────────────────────────────────────
  {
    const blocks: DraftBlock[] = [];
    if (aboutOld) blocks.push(...textBlocks(aboutOld, 3, words.aboutHeading, tidy));
    else if (weaver.about || weaver.mission) {
      const paras = weaver.about ? paragraphsOf(weaver.about, 4) : paragraphsOf(weaver.mission!, 2);
      blocks.push(mk("text", { heading: words.aboutHeading, paragraphs: paras } satisfies TextContent, "weaver_data"));
    } else blocks.push(mk("text", { heading: words.aboutHeading, paragraphs: [STAND_IN.about] } satisfies TextContent, "written"));
    if (weaver.leaders.length > 0) blocks.push(mk("leaders", { heading: words.leadersHeading, people: weaver.leaders }, "weaver_data"));
    else if (leadersOld) blocks.push(...textBlocks(leadersOld, 1, words.leadersHeading, tidy));
    pages.push({ slug: "about", title: words.aboutTitle, kind: "about", source_path: srcPath(aboutOld?.path), blocks });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  if (eventsOffered) {
    const blocks: DraftBlock[] = [];
    // An old events page that was mostly a list of dates is not kept: Weaver's own list replaces it.
    if (eventsOld && eventsOld.eventCount === 0) blocks.push(...textBlocks(eventsOld, 1, words.eventsHeading, tidy));
    blocks.push(
      mk("events_list", { heading: words.eventsHeading, time_zone: weaver.timeZone, events: weaver.events.items.slice(0, 12), empty: weaver.events.items.length === 0 ? NO_EVENTS : null }, "weaver_data"),
    );
    pages.push({ slug: "events", title: words.eventsTitle, kind: "events", source_path: srcPath(eventsOld?.path), blocks });
  }

  // ── Give ───────────────────────────────────────────────────────────────────
  if (givingOffered) {
    const blocks: DraftBlock[] = [];
    if (giveOld) blocks.push(...textBlocks(giveOld, 2, words.giveHeading, tidy));
    if (weaver.giving.campaigns.length > 0) {
      const items = weaver.giving.campaigns.flatMap((c) => [{ name: c.name, description: c.description }, ...c.items]).slice(0, 12);
      blocks.push(mk("giving_cta", { heading: words.giveHeading, body: null, items, cta: { label: words.giveOnline } } satisfies GivingContent, "weaver_data"));
    } else if (!giveOld) {
      blocks.push(mk("giving_cta", { heading: words.giveHeading, body: STAND_IN.give, items: [], cta: null } satisfies GivingContent, "written"));
    }
    if (weaver.store.on && weaver.store.items.length > 0) {
      blocks.push(mk("text", { heading: words.storeHeading, paragraphs: [`Items include ${joinWords(weaver.store.items)}.`] } satisfies TextContent, "weaver_data"));
    }
    pages.push({ slug: "give", title: words.giveTitle, kind: "give", source_path: srcPath(giveOld?.path), blocks });
  }

  // ── Learning (only for an organization that has classes) ───────────────────
  if (hasSchool) {
    const blocks: DraftBlock[] = [];
    if (schoolOld) blocks.push(...textBlocks(schoolOld, 2, words.classesHeading, tidy));
    const s = weaver.school;
    if (s.on && (s.term || s.levels.length > 0)) {
      const paras: string[] = [];
      if (s.term) paras.push(`${s.term.name}: ${longDate(s.term.startsOn)} to ${longDate(s.term.endsOn)}.`);
      if (s.levels.length > 0) paras.push(`Levels: ${s.levels.join(", ")}.`);
      blocks.push(mk("text", { heading: words.classesHeading, paragraphs: paras } satisfies TextContent, "weaver_data"));
    }
    if (blocks.length === 0) blocks.push(mk("text", { heading: words.classesHeading, paragraphs: [STAND_IN.learn] } satisfies TextContent, "written"));
    // The old page's own title is the organization's word for it; else the kind's; else a plain one.
    pages.push({ slug: "learning", title: cutText((schoolOld && tidyTitle(schoolOld.title, tidy.names)) || words.learnTitle, 100), kind: "school", source_path: srcPath(schoolOld?.path), blocks });
  }

  // ── Photos ─────────────────────────────────────────────────────────────────
  if (hasGallery) {
    const blocks: DraftBlock[] = [];
    if (weaver.albums.length > 0) blocks.push(mk("gallery", { heading: words.galleryTitle, albums: weaver.albums, images: [], licence_unchecked: false } satisfies GalleryContent, "weaver_data"));
    if (photos) blocks.push(mk("gallery", { heading: words.galleryTitle, albums: [], images: photos.images.slice(0, 12), licence_unchecked: true } satisfies GalleryContent, "own_site", photos.page.url));
    pages.push({ slug: "photos", title: words.galleryTitle, kind: "gallery", source_path: srcPath(photos?.page.path), blocks });
  }

  // ── Contact ────────────────────────────────────────────────────────────────
  {
    const contactOld = own?.pages.find((p) => p.kind === "contact" && p.confidence >= MIN_CONFIDENCE) ?? null;
    const sourcePage = contactOld?.url ?? rootUrl;
    const blocks: DraftBlock[] = [];
    const today = contact.source === "weaver_data" ? todayLine(weaver, words) : null;
    const base = { heading: words.contactHeading, emails: contact.emails, phones: contact.phones, addresses: contact.addresses, hours: contact.hours, today, social: contact.social };
    if (contact.source === "written") blocks.push(mk("contact", { ...base, note: STAND_IN.contact }, "written"));
    else blocks.push(mk("contact", { ...base, note: null }, contact.source, contact.source === "own_site" ? sourcePage : null));

    const hasPoint = weaver.latitude !== null && weaver.longitude !== null;
    if (hasPoint || weaver.address) {
      blocks.push(mk("map", { heading: words.mapHeading, address: weaver.address, latitude: hasPoint ? weaver.latitude : null, longitude: hasPoint ? weaver.longitude : null }, "weaver_data"));
    } else if (own && own.contact.addresses.length > 0) {
      blocks.push(mk("map", { heading: words.mapHeading, address: own.contact.addresses[0]!, latitude: null, longitude: null }, "own_site", sourcePage));
    }
    pages.push({ slug: "contact", title: words.contactTitle, kind: "contact", source_path: srcPath(contactOld?.path), blocks });
  }

  // ── Menu order, then the footer on every page ──────────────────────────────
  const order: SitePageKind[] = ["home", "about", "events", "give", "school", "gallery", "contact"];
  pages.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const links = pages.map((p) => ({ label: p.title, page: p.slug }));
  const lines = [contact.addresses[0], contact.phones[0], contact.emails[0]].filter((l): l is string => !!l);
  const footerSource: BlockSource = contact.source === "own_site" ? "own_site" : "weaver_data";
  for (const p of pages) {
    p.blocks.push(mk("footer", { name: weaver.name, lines, links, social: contact.social }, footerSource, footerSource === "own_site" ? rootUrl : null));
  }

  const theme = buildTheme({ own, references, patternSource, heroImage: heroHasImage });
  return { name: weaver.name, theme, pages };
}
