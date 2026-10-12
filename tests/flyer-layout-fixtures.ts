// Fixtures the flyer layout tests share: a layout poster at three amounts of content, and its plan.
import { defaultPoster, type FlyerDesign, type FlyerSize, type PosterContent } from "@/lib/events/flyer";
import { artPack } from "@/lib/events/flyer-art-packs";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { LAYOUT_PRESET_KEYS, withLayoutPreset, type LayoutPreset } from "@/lib/events/flyer-layout";
import { planLayout } from "@/lib/events/flyer-layout-render";
import { flyerDims } from "@/lib/events/flyer-render";

export const brand = readFlyerBrand(null, undefined);
export const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const logo = { dataUri: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60" width="200" height="60"><rect width="200" height="60" rx="8" fill="#7A2E1F"/></svg>'), w: 200, h: 60 };
export const PRESETS: readonly LayoutPreset[] = LAYOUT_PRESET_KEYS;
/** A picture standing in for an album photo (a drawn landscape). */
export const heroPic = {
  dataUri: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 750" width="1000" height="750"><rect width="1000" height="750" fill="#F6C27A"/><circle cx="500" cy="440" r="140" fill="#F4B942"/><path d="M0 560Q300 480 600 560T1000 540V750H0Z" fill="#1F3A5F"/></svg>'),
  w: 1000,
  h: 750,
};
export const PHOTO = "33333333-3333-4333-8333-333333333333";

export type Content = "bare" | "typical" | "longest";

export const long = (s: string, n: number) => `${s} ${"and more words ".repeat(40)}`.slice(0, n).trimEnd();

/** A layout poster at one of three amounts of content: only a headline, an ordinary flyer, or every field at its limit. */
export function build(preset: LayoutPreset, content: Content, over: { size?: FlyerSize; qr?: boolean; scene?: boolean; occasion?: PosterContent["occasion"]; headline?: string } = {}): FlyerDesign {
  const headline = over.headline ?? (content === "longest" ? long("Annual Neighbourhood Supper and Community Celebration of the Whole Street", 90) : content === "bare" ? "Supper" : "Community Supper");
  const base = defaultPoster({ name: headline, description: null, startsAt: null, endsAt: null, tz: "UTC" });
  let poster: PosterContent = { ...base, occasion: over.occasion ?? "general", partner: { on: content !== "bare", label: "", sub: "", logo_path: null } };
  poster = withLayoutPreset(poster, preset, { headline, greeting: content === "bare" ? "" : "Welcome" });
  if (content === "typical") {
    poster = {
      ...poster,
      subhead: "October 2026",
      slogan: "Come hungry, bring a friend",
      ribbon: { on: true, date: "Sunday, October 18, 2026", time: "12:30–3:00 PM" },
      layout: {
        ...poster.layout!,
        eyebrow: "Monthly",
        host: { label: "Hosted by", names: "The Okafor & Alvarez Families" },
        note: { icon: "food", text: "Please bring a dish to share and stay to help clear the tables afterwards." },
        cta: "Would your family like to host a future supper?",
        contacts: [
          { name: "Dana Whitfield", detail: "555-0142" },
          { name: "Marcus Ellery", detail: "marcus@example.org" },
        ],
      },
    };
  }
  if (content === "typical" && preset === "thank_you") {
    poster = {
      ...poster,
      layout: {
        ...poster.layout!,
        hero: { photo_id: PHOTO, shape: "rounded" },
        credits: [
          { heading: "Welcome Team", names: "Dana Whitfield, Marcus Ellery, Priya Raman", icon: "people" },
          { heading: "Music Team", names: "Jonas Berg, Mira Cole and the choir", icon: "music" },
          { heading: "Hospitality", names: "Sam Ito, Hana Park", icon: "food" },
        ],
        donors: { heading: "Our generous donors", names: "Ava Lindqvist, the Okafor Family, Harbor Bakery" },
        closing: "Thank you to every family for your time and your kindness this year.",
      },
    };
  }
  if (content === "typical" && preset === "ceremony") poster = { ...poster, layout: { ...poster.layout!, hero: { photo_id: PHOTO, shape: "arch" } } };
  if (content === "longest") {
    poster = {
      ...poster,
      subhead: long("Our thirtieth year", 48),
      slogan: long("Come hungry and bring someone new", 60),
      stat: { on: true, icon: "people", label: long("MORE THAN", 24), value: "1,250", caption: long("PEOPLE HAVE ALREADY SAID YES", 80) },
      ribbon: { on: true, date: long("Thursday, September 10 – Thursday, September 17, 2026", 44), time: long("6:00 PM–9:30 PM each evening", 36) },
      agenda: [1, 2, 3, 4, 5].map((n) => ({ icon: "clock" as const, time: long(`${n}:00 PM`, 22), text: long("Doors open and everyone is welcome to come in", 80) })),
      paragraph: long("Connect with your neighbours. Meet the people who live on your street.", 320),
      footer: long("The organising team", 60),
      layout: {
        ...poster.layout!,
        accent: "Celebration",
        eyebrow: long("Our annual", 28),
        greeting: { top: long("Welcome, friends", 32), bottom: long("See you at the table", 32) },
        host: { label: long("Sponsored by", 24), names: long("The Okafor, Alvarez, Whitfield and Ellery Families", 90) },
        note: { icon: "leaf", text: long("Please bring a dish to share and stay to help clear the tables", 160) },
        cta: long("Would your family like to host a future supper?", 90),
        contacts_label: long("Please contact", 32),
        contacts: [1, 2, 3].map((n) => ({ name: long(`Dana Whitfield ${n}`, 32), detail: long("dana.whitfield@neighbourhoodsupper.example", 40) })),
        hero: { photo_id: PHOTO, shape: (["arch", "rounded", "circle", "free"] as const)[poster.layout!.preset.length % 4]! },
        credits: [1, 2, 3, 4, 5, 6].map((n) => ({ heading: long(`Welcome and hospitality team ${n}`, 36), names: long("Dana Whitfield, Marcus Ellery, Priya Raman, Tom Eastley and Lena Okafor", 220), icon: "people" as const })),
        donors: { heading: long("Our generous donors", 36), names: long("Ava Lindqvist, the Okafor Family, Brightwater Credit Union, Harbor Bakery", 300) },
        closing: long("Most importantly: thank you to every family for your time", 220),
      },
    };
  }
  return {
    v: 1,
    template: "poster",
    size: over.size ?? "tall",
    headline,
    tagline: "",
    date_line: "",
    venue_line: content === "bare" ? "" : content === "longest" ? long("Fellowship Hall of the Greater Riverside Community Centre, 120 Maple Street", 120) : "Fellowship Hall, 120 Maple Street",
    show_qr: over.qr ?? false,
    background: { source: "plain" },
    poster: over.scene === false ? { ...poster, scene: { source: "none" } } : poster,
  };
}

export const dimsOf = (size: FlyerSize) => flyerDims(size, "full");
export const planOf = (d: FlyerDesign, size: FlyerSize = d.size) => {
  const poster = d.poster!;
  const input = { design: d, poster, logo, assets: { frame: null, scene: null, partnerLogo: null, hero: poster.layout?.hero.photo_id ? heroPic : null }, centerName: "Maple Street Neighbours" };
  return planLayout(input, dimsOf(size), artPack(poster.occasion, brand), {});
};
