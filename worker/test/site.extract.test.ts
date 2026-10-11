import { describe, expect, it } from "vitest";

import { parseHtml, findAll, findFirst, textOf, withoutChrome } from "../src/web/site/dom";
import { extractPage } from "../src/web/site/extract";
import { contactDetails, donateLinks, eventBlocks, extractImages, networkOf, readJsonLd, roleOfImage, socialLinks } from "../src/web/site/facts";
import { layoutOf } from "../src/web/site/layout";
import { extractNav } from "../src/web/site/nav";
import { fixtureHtml, siteBase } from "./site-fixtures";

const page = (site: string, file: string, path = "/") => extractPage(fixtureHtml(site, file), siteBase(site) + path, { isStart: path === "/" });
const body = (html: string) => findFirst(parseHtml(`<html><body>${html}</body></html>`).root, "body")!;

describe("the HTML tree", () => {
  it("copes with unclosed tags, stray end tags, implied end tags and odd nesting", () => {
    const doc = parseHtml("<ul><li>One<li>Two<li>Three</ul></div><p>Para<p>Next<div>Block</span></div><b>x");
    expect(findAll(doc.root, "li").map((e) => textOf(e))).toEqual(["One", "Two", "Three"]);
    expect(findAll(doc.root, "p").map((e) => textOf(e))).toEqual(["Para", "Next"]);
    expect(textOf(findFirst(doc.root, "div")!)).toBe("Block");
  });
  it("keeps script and style text raw (never as page text) and decodes entities in attributes", () => {
    const doc = parseHtml(`<head><style>a>b{color:#fff}</style><script>var x = "<div>no</div>";</script></head><body><a href="/a?x=1&amp;y=2" title='Tom &amp; Jerry'>Go</a></body>`);
    expect(findFirst(doc.root, "style")!.raw).toBe("a>b{color:#fff}");
    expect(findAll(doc.root, "div")).toHaveLength(0);
    const a = findFirst(doc.root, "a")!;
    expect(a.attrs["href"]).toBe("/a?x=1&y=2");
    expect(a.attrs["title"]).toBe("Tom & Jerry");
  });
  it("stops growing at its node limit instead of running away on a hostile page", () => {
    const doc = parseHtml("<p>x</p>".repeat(100_000));
    expect(doc.truncated).toBe(true);
    expect(doc.nodes).toBeLessThanOrEqual(60_000);
  });
  it("separates elements by a space, but not bold or italic inside a word", () => {
    expect(textOf(body("<span>Oct</span><span>14</span>"))).toBe("Oct 14");
    expect(textOf(body("Rive<b>rbend</b>"))).toBe("Riverbend");
  });
  it("leaves out the page furniture on request", () => {
    const b = body(`<header>Menu</header><div class="bar">Top</div><main>Real <footer>Foot</footer></main><div class="footer-block">Address</div>`);
    expect(textOf(withoutChrome(b))).toBe("Real");
  });
});

describe("one page: the basics", () => {
  const home = page("temple", "home.html");
  it("reads the title, description, language and the heading tree", () => {
    expect(home.title).toBe("Home | Riverbend Hindu Temple");
    expect(home.short_title).toBe("Home");
    expect(home.description).toMatch(/place of worship/);
    expect(home.lang).toBe("en");
    expect(home.headings[0]).toMatchObject({ level: 1, text: "Welcome to Riverbend Hindu Temple" });
    const h2s = home.headings[0]!.children.map((h) => h.text);
    expect(h2s).toEqual(["About our temple", "Upcoming events", "Moments from the temple", "Support the temple"]);
    expect(home.headings[0]!.children[1]!.children).toHaveLength(4);
  });
  it("splits the text into sections with the existing reader and keeps an excerpt of each", () => {
    expect(home.section_count).toBeGreaterThan(0);
    expect(home.sections[0]!.excerpt).toMatch(/A home for worship/);
    expect(home.words).toBeGreaterThan(80);
    expect(home.sections.every((s) => s.excerpt.length <= 1200)).toBe(true);
  });
  it("reports a page built by scripts as having little text found", () => {
    const spa = page("temple", "script-built.html", "/app");
    expect(spa.built_by_scripts).toBe(true);
    expect(spa.words).toBeLessThan(5);
    expect(home.built_by_scripts).toBe(false);
  });
  it("does not call a short real page script-built just because it loads analytics", () => {
    const f = extractPage(`<html><head><script src="a.js"></script><script src="b.js"></script></head><body><main><h1>Coming soon</h1><p>Our new site opens in the spring. Write to us at hello@example.org in the meantime.</p></main></body></html>`, "https://x.example/soon");
    expect(f.built_by_scripts).toBe(false);
  });
});

describe("the menu and the footer", () => {
  it("reads a menu with dropdowns: depth, items, the button item, the mobile toggle, search", () => {
    const d = parseHtml(fixtureHtml("temple", "home.html"));
    const b = findFirst(d.root, "body")!;
    const { nav, footer, hasSearch } = extractNav(b, "https://www.riverbendtemple.example/", "riverbendtemple.example");
    expect(nav).toMatchObject({ depth: 2, top_level_count: 8, has_dropdowns: true, mobile_toggle: true, cta: "Donate" });
    expect(nav!.items[1]).toMatchObject({ label: "About Us", href: "https://www.riverbendtemple.example/about-us", internal: true });
    expect(nav!.items[1]!.children.map((c) => c.label)).toEqual(["Our History", "Board of Trustees"]);
    expect(nav!.total_links).toBe(8 + 2 + 2);
    expect(hasSearch).toBe(true);
    expect(footer).toMatchObject({ columns: 3, has_social: true, has_newsletter: true, has_address: true, has_copyright: true });
  });
  it("reads a menu made of plain links (a site builder) as one flat level", () => {
    const f = page("church", "home.html");
    expect(f.nav).toMatchObject({ depth: 1, top_level_count: 10, has_dropdowns: false, cta: "Give" });
    expect(f.nav!.items.map((i) => i.label).slice(0, 3)).toEqual(["Home", "Our Story", "What's On"]);
  });
  it("reads a Bootstrap navbar with a dropdown", () => {
    const f = page("club", "home.html");
    expect(f.nav).toMatchObject({ depth: 2, has_dropdowns: true, mobile_toggle: true });
    expect(f.nav!.items.find((i) => i.label === "Club Life")!.children).toHaveLength(3);
  });
  it("does not take the footer's links for the menu", () => {
    const f = page("chamber", "home.html");
    expect(f.nav!.items.map((i) => i.label)).toContain("Membership");
    expect(f.nav!.items.map((i) => i.label)).not.toContain("Privacy");
    expect(f.footer!.columns).toBe(3);
  });
});

describe("images", () => {
  it("tells a logo, a hero picture, photos and decoration apart", () => {
    const home = page("temple", "home.html");
    const by = (name: string) => home.images.find((i) => i.src.includes(name))!;
    expect(by("logo-temple").role).toBe("logo");
    expect(by("hero-temple").role).toBe("hero");
    expect(by("g3").role).toBe("photo");
    expect(home.image_count).toBe(8);
  });
  it("reads lazy-loaded pictures, srcset, background images and posters, and skips data: addresses", () => {
    const b = body(`<img src="data:image/gif;base64,R0lG" data-src="/lazy.jpg" alt="Lazy" width="640"><img srcset="/s-320.jpg 320w, /s-960.jpg 960w" alt="Set"><div style="background-image:url('/bg.png')"></div><video poster="/poster.jpg"></video><img src="data:image/png;base64,AAAA" alt="Inline">`);
    const { images } = extractImages(b, "https://x.example/page");
    expect(images.map((i) => i.src)).toEqual(["https://x.example/lazy.jpg", "https://x.example/s-960.jpg", "https://x.example/bg.png", "https://x.example/poster.jpg"]);
    expect(images[0]).toMatchObject({ alt: "Lazy", width: 640, height: null });
  });
  it("calls tiny pictures, spacer files, tracking pixels and role=presentation images decoration", () => {
    const b = body(`<img src="/a.png" width="16" height="16" alt="x"><img src="/spacer.gif" alt=""><img src="https://www.facebook.com/tr?id=1" alt=""><img src="/pic.jpg" role="presentation" alt=""><img src="/team.jpg" alt="The team" width="500" height="300">`);
    expect(extractImages(b, "https://x.example/").images.map((i) => i.role)).toEqual(["decorative", "decorative", "decorative", "decorative", "photo"]);
  });
  it("does not take a sponsor's logo for the site's own", () => {
    expect(roleOfImage(null, "https://x.example/img/sponsor-logo.png", "Sponsor logo", 160, 80, { inHeader: false, homeLink: false, heroish: false, explicitEmptyAlt: false, first: false })).toBe("photo");
  });
  it("ranks logo candidates: JSON-LD and the header image before the icons and the share picture", () => {
    const f = page("chamber", "home.html");
    expect(f.logo_candidates[0]!.url).toContain("chamber-logo.png");
    expect(f.logo_candidates.map((l) => l.source)).toContain("icon");
    const church = page("church", "home.html");
    expect(church.logo_candidates.map((l) => l.source)).toEqual(["named-logo", "og-image"]);
  });
});

describe("social links, contact details, events and donate links", () => {
  it("finds the networks and skips share buttons", () => {
    const f = page("temple", "home.html");
    expect(f.social.map((s) => s.network)).toEqual(["facebook", "instagram", "youtube"]);
    expect(networkOf("https://www.facebook.com/sharer/sharer.php?u=x")).toBeNull();
    expect(networkOf("https://twitter.com/intent/tweet?text=x")).toBeNull();
    expect(networkOf("https://x.com/riverbend")).toBe("x");
    expect(networkOf("https://www.instagram.com/")).toBeNull();
    const b = body(`<a href="https://wa.me/12815550142">Chat</a><a href="https://t.me/riverbend">TG</a>`);
    expect(socialLinks(b, "https://x.example/").map((s) => s.network)).toEqual(["whatsapp", "telegram"]);
  });
  it("finds emails, phones and addresses (links, text, JSON-LD)", () => {
    const f = page("temple", "home.html");
    expect(f.contact).toEqual({ emails: ["office@riverbendtemple.example"], phones: ["(281) 555-0142"], addresses: ["2150 Lotus Grove Road, Riverbend, TX 77450"] });
    const ch = page("chamber", "home.html");
    expect(ch.contact.phones[0]).toBe("+1-616-555-0188");
    expect(ch.contact.addresses[0]).toBe("410 Water Street, Lakeshore, MI 49401");
    const c = contactDetails(body(`<p>Write to name@example.com or secretary@harborlight.org. Image logo@2x.png. Call 281.555.0199 or 1-800-555-0100 ext 4.</p>`), [], [], []);
    expect(c.emails).toEqual(["secretary@harborlight.org"]);
    expect(c.phones).toEqual(["281.555.0199", "1-800-555-0100"]);
  });
  it("finds event-like blocks: a title with a date and a time, from lists, cards and <time> tags", () => {
    const f = page("temple", "home.html");
    expect(f.event_count).toBe(4);
    expect(f.events[0]).toMatchObject({ title: "Diwali Lakshmi Puja", date_text: "Sat, Nov 7", time_text: "6:30 PM" });
    expect(f.events[0]!.url).toBe("https://www.riverbendtemple.example/events/diwali-lakshmi-puja");
    expect(page("church", "home.html").events.map((e) => e.title)).toEqual(["Harvest Dinner", "Youth Lock-in", "Advent Concert"]);
    expect(page("chamber", "events.html", "/events/").event_count).toBe(5);
    expect(page("club", "meetings-and-events.html", "/meetings-and-events").events[0]).toMatchObject({ title: "Fall bulb planting", date_text: "Tue, Oct 13" });
  });
  it("does not take dated news posts, 24/7 or a year for events", () => {
    expect(page("temple", "news.html", "/news").event_count).toBe(0);
    expect(page("church", "announcements.html", "/announcements").event_count).toBe(0);
    expect(eventBlocks(body(`<p>Open 24/7. Founded in 1994.</p><ul><li>Call us any time</li></ul>`), "https://x.example/", "x.example").total).toBe(0);
  });
  it("finds links that ask for money, in this site or on a payment page", () => {
    const give = donateLinks(body(`<a href="/give">Donate</a><a href="https://www.zeffy.com/donation-form/x">Online</a><a href="/about">About</a><a href="/sponsor-a-bench">Sponsor</a>`), "https://x.example/", "x.example");
    expect(give.map((d) => [d.url, d.external])).toEqual([["https://x.example/give", false], ["https://www.zeffy.com/donation-form/x", true], ["https://x.example/sponsor-a-bench", false]]);
    expect(page("club", "support.html", "/support").donate_links[0]).toMatchObject({ external: true });
    expect(page("church", "giving.html", "/giving").donate_links.length).toBeGreaterThan(0);
  });
  it("reads JSON-LD organisation facts and survives broken JSON", () => {
    const d = parseHtml(`<head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Church","name":"St. Test","telephone":"555-123-4567","email":"mailto:a@b.org","address":{"streetAddress":"1 Main St","addressLocality":"Town","addressRegion":"TX","postalCode":"77001"},"logo":{"@type":"ImageObject","url":"/l.png"},"sameAs":["https://facebook.com/test"]}]}</script><script type="application/ld+json">{ not json</script></head><body></body>`);
    const ld = readJsonLd(findFirst(d.root, "head"), findFirst(d.root, "body")!);
    expect(ld.types).toContain("Church");
    expect(ld).toMatchObject({ names: ["St. Test"], phones: ["555-123-4567"], emails: ["a@b.org"], addresses: ["1 Main St, Town, TX 77001"], logos: ["/l.png"], sameAs: ["https://facebook.com/test"] });
  });
});

describe("the layout of the home page", () => {
  const order = (site: string) => page(site, "home.html").layout;
  it("lists the blocks in page order: header, hero, about, events, gallery, donate, footer", () => {
    expect(order("temple")).toEqual(["header", "hero", "about", "events", "gallery", "donate", "footer"]);
    expect(order("chamber")).toEqual(["header", "hero", "about", "events", "sponsors", "newsletter", "footer"]);
  });
  it("finds the blocks of a site-builder page that has no <main>", () => {
    const l = order("church");
    expect(l[0]).toBe("header");
    expect(l.slice(1, 3)).toEqual(["hero", "about"]);
    expect(l).toContain("events");
    expect(l).toContain("donate");
    expect(l[l.length - 1]).toBe("footer");
  });
  it("finds a Bootstrap page: jumbotron hero, a photo row, a donate band", () => {
    const l = order("club");
    expect(l.slice(0, 3)).toEqual(["header", "hero", "about"]);
    expect(l).toContain("gallery");
    expect(l).toContain("donate");
  });
  it("describes the hero: picture, slider or video, button, height", () => {
    expect(page("temple", "home.html").hero).toEqual({ style: "image", has_cta: true, tall: true, has_heading: true });
    const slider = layoutOf(body(`<main><div class="swiper-container"><img src="/1.jpg"><img src="/2.jpg"><img src="/3.jpg"></div><section><h2>About us</h2><p>We are a club.</p></section></main>`));
    expect(slider.kinds[0]).toBe("hero");
    expect(slider.hero?.style).toBe("slider");
    const video = layoutOf(body(`<main><section class="hero"><video src="/v.mp4"></video><h1>Welcome</h1></section></main>`));
    expect(video.hero?.style).toBe("video");
  });
  it("calls a plain text page one block of content", () => {
    expect(layoutOf(body(`<main><h1>Privacy</h1><p>Text.</p><p>More text.</p></main>`), false, false).kinds).toEqual(["content"]);
    // The same few words on a home page open it.
    expect(layoutOf(body(`<main><h1>Riverbend Temple</h1><p>Text.</p></main>`), false, true).kinds).toEqual(["hero"]);
  });
});

describe("text is data, never instructions", () => {
  it("keeps an injected order as a sentence in a section and nothing more", () => {
    const f = extractPage(fixtureHtml("temple", "news-injection.html"), siteBase("temple") + "/news");
    const where = JSON.stringify({ ...f, sections: [] });
    expect(f.sections.map((s) => s.excerpt).join(" ")).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/);
    expect(where).not.toMatch(/IGNORE ALL PREVIOUS/);
    expect(f.classification.kind).toBe("news");
    // The address in the sentence is only a contact detail found on the page, listed as data.
    expect(f.links.every((l) => l.startsWith("https://www.riverbendtemple.example"))).toBe(true);
  });
  it("does not follow javascript:, mailto: or tel: links", () => {
    const f = extractPage(`<body><a href="javascript:alert(1)">x</a><a href="mailto:a@b.org">m</a><a href="tel:5551234567">t</a><a href="/ok">ok</a><a href="https://other.example/x">other</a></body>`, "https://x.example/");
    expect(f.links).toEqual(["https://x.example/ok"]);
  });
});
