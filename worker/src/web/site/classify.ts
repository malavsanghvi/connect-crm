// What kind of page is this? A scored guess from the signals a page gives about itself: its address, its title and
// main heading, and what is on it (dates, donate links, a form with an address, many photos, a row of people).
// Every guess comes with a confidence (how far the winner is ahead of the runner-up) and the signals that decided it,
// named in short codes ("path:events"), never page text. Pure and fixture-tested (worker/test/site.classify.test.ts).

import type { Classification, PageKind } from "./types";

type Scored = Exclude<PageKind, "home" | "other">;

// Words (not parts of words) that point to a kind. Hyphens and underscores in addresses count as spaces.
const WORDS: Record<Scored, RegExp> = {
  about: /\b(about|who we are|our story|our history|history|mission|vision|welcome|beliefs?|what we believe|our faith|philosophy|overview)\b/,
  events: /\b(events?|upcoming|festivals?|what'?s on|happenings|activities|celebrations?|gatherings?|fundraisers?|galas?|festivities)\b/,
  calendar: /\b(calendar|schedule|panchang|\w+ times|(?!after\b)\w+ hours|timetable|agenda)\b/,
  donate: /\b(donat\w*|giv(e|ing)|support us|support the|contribut\w*|sponsor\w*|pledge|tithes?|offerings?|fundrais\w*|gift|charit\w*|ways to give|zakat|dana)\b/,
  contact: /\b(contact|visit|directions|location|find us|get in touch|reach us|plan your visit|map|hours and location|connect with us)\b/,
  school: /\b(school|pathshala|classes|class|education|learn\w*|sunday school|youth|children|kids?|religious education|curriculum|academy|study|bible study|students?|teens?|nursery|vbs|camp|workshops?|ministries|programs?)\b/,
  gallery: /\b(gallery|galleries|photos?|albums?|pictures|images|videos?|media|memories|moments)\b/,
  news: /\b(news|blog|announcements?|bulletin|newsletters?|press|updates|articles?|stories|posts?|journal|latest)\b/,
  leadership: /\b(leadership|leaders?|board|trustees?|officers|our team|team|staff|clergy|pastors?|priests?|elders|committee|executive|directors?|our people|people|meet|deacons?|ministers?|council|governance)\b/,
  membership: /\b(member\w*|join|become a member|renew\w*|dues|register|registration|sign ?up|get involved|belong|volunteer\w*)\b/,
};
const KINDS = Object.keys(WORDS) as Scored[];

const spaced = (s: string) => s.toLowerCase().replace(/[-_/.+]+/g, " ").replace(/\s+/g, " ").trim();

export type PageSignals = {
  path: string;
  title: string;
  h1: string;
  headings: string[];
  description: string;
  /** The crawl's first page: the home page, whatever its address. */
  isStart: boolean;
  eventCount: number;
  donateLinkCount: number;
  formCount: number;
  hasCalendarEmbed: boolean;
  imageCount: number;
  textChars: number;
  hasContactDetails: boolean;
  personBlocks: number;
  /** Written like a post: a "posted ... by" line near the top, an article with a <time>, or og:type article. */
  isPost: boolean;
  amountMentions: number;
  jsonLdTypes: string[];
};

export function classifyPage(s: PageSignals): Classification {
  const score = new Map<PageKind, number>();
  const why = new Map<PageKind, string[]>();
  const give = (k: PageKind, n: number, reason: string) => {
    score.set(k, (score.get(k) ?? 0) + n);
    const r = why.get(k) ?? [];
    if (!r.includes(reason)) r.push(reason);
    why.set(k, r);
  };

  const path = s.path.split("?")[0]!;
  const segs = path.split("/").filter(Boolean);
  // The root is the home page; an address that is the root plus a query (/?page_id=212) is some other page.
  const isRoot = !s.path.includes("?") && (segs.length === 0 || /^(home|index(\.\w+)?|default(\.\w+)?|[a-z]{2}(-[a-z]{2})?)$/.test(segs.join("/").toLowerCase()));
  if (isRoot) give("home", 20, "path:root");
  if (s.isStart) give("home", 12, "start");

  // The address: the last part counts most, a parent folder some ("/events/diwali" is about events, not about diwali).
  segs.forEach((seg, i) => {
    const w = spaced(seg.replace(/\.\w{2,5}$/, ""));
    const last = i === segs.length - 1;
    for (const k of KINDS) if (WORDS[k].test(w)) give(k, last ? 6 : 3, `path:${k}`);
  });
  // A dated address (/2026/03/spring-service) is a post.
  if (/\/(19|20)\d\d\/\d{1,2}(\/|$)/.test(path)) give("news", 6, "path:dated");

  const h1 = spaced(s.h1);
  const title = spaced(s.title);
  for (const k of KINDS) {
    if (h1 && WORDS[k].test(h1)) give(k, 5, `h1:${k}`);
    if (title && WORDS[k].test(title)) give(k, 3, `title:${k}`);
    let hits = 0;
    for (const h of s.headings.slice(0, 6)) if (WORDS[k].test(spaced(h)) && hits++ < 2) give(k, 1, `h2:${k}`);
    if (s.description && WORDS[k].test(spaced(s.description))) give(k, 1, `meta:${k}`);
  }

  // What is on the page.
  if (s.eventCount >= 2) give("events", Math.min(5, 1 + s.eventCount), "signal:event_blocks");
  if (s.hasCalendarEmbed) give("calendar", 6, "signal:calendar_embed");
  if (s.donateLinkCount >= 1 && s.formCount >= 1 && s.amountMentions >= 2) give("donate", 5, "signal:amount_form");
  else if (s.amountMentions >= 3) give("donate", 2, "signal:amounts");
  if (s.formCount >= 1 && s.hasContactDetails) give("contact", 3, "signal:form_and_address");
  if (s.imageCount >= 12 && s.textChars / Math.max(1, s.imageCount) < 220) give("gallery", 5, "signal:many_photos");
  if (s.personBlocks >= 4) give("leadership", 5, "signal:people_row");
  if (s.isPost) give("news", 5, "signal:byline");
  const ld = s.jsonLdTypes.map((t) => t.toLowerCase());
  if (ld.includes("contactpage")) give("contact", 6, "ld:ContactPage");
  if (ld.includes("aboutpage")) give("about", 6, "ld:AboutPage");
  if (ld.includes("event") && s.eventCount >= 1) give("events", 3, "ld:Event");
  if (ld.some((t) => t === "blogposting" || t === "newsarticle" || t === "article")) give("news", 4, "ld:Article");
  if (ld.includes("imagegallery")) give("gallery", 6, "ld:ImageGallery");
  if (ld.includes("donateaction")) give("donate", 4, "ld:DonateAction");

  // A home page that also scores on its own words stays the home page.
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1] || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]));
  const [top, topScore] = ranked[0] ?? (["other", 0] as [PageKind, number]);
  const [second, secondScore] = ranked[1] ?? ([null, 0] as [PageKind | null, number]);
  if (topScore < 3) return { kind: "other", confidence: 0.4, runner_up: top !== "other" && topScore > 0 ? top : null, reasons: [] };
  const confidence = Math.round(Math.min(1, ((topScore - secondScore) / topScore) * Math.min(1, topScore / 8)) * 100) / 100;
  return { kind: top, confidence, runner_up: second, reasons: (why.get(top) ?? []).slice(0, 4) };
}

// A tie goes to the more specific kind.
const PRIORITY: PageKind[] = ["home", "donate", "calendar", "events", "contact", "leadership", "membership", "school", "gallery", "news", "about", "other"];

/** The kind a short label ("Give", "About Us", "Calendar") points to: how a menu is read in the reference mode. */
export function kindOfLabel(label: string): PageKind {
  const w = spaced(label);
  if (/^(home|homepage|main)$/.test(w)) return "home";
  let best: PageKind = "other";
  let n = 0;
  for (const k of KINDS) {
    const m = w.match(new RegExp(WORDS[k].source, "g"));
    if (m && m.length > n) {
      n = m.length;
      best = k;
    }
  }
  return best;
}
