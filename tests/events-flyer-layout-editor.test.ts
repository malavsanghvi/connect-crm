import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The picture chooser calls a Server Action when it opens; here nothing is opened, only rendered.
vi.mock("@/app/(app)/events/builder/flyer-actions", () => ({ listFlyerPhotosAction: vi.fn() }));

import { LayoutBlockEditors, LayoutChooser, LayoutPosterWords } from "@/app/(app)/events/builder/flyer-layout-editor";
import { defaultPoster } from "@/lib/events/flyer";
import { readFlyerBrand } from "@/lib/events/flyer-brand";
import { withLayoutPreset } from "@/lib/events/flyer-layout";

const brand = readFlyerBrand(null, undefined);
const base = defaultPoster({ name: "Community Supper", description: null, startsAt: null, endsAt: null, tz: "UTC" });
const noop = () => undefined;
const EVENT = "22222222-2222-4222-8222-222222222222";
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("the Layout choice", () => {
  it("offers the original poster and each layout, with a drawing of each, and marks the one in use", () => {
    const out = html(createElement(LayoutChooser, { poster: base, brand, headline: "Community Supper", greeting: "", ornament: "leaf", onPoster: noop, disabled: false }));
    expect(out.match(/role="radio"/g)).toHaveLength(6);
    for (const label of ["Original", "Notice", "Save the date", "Ceremony", "Event day", "Thank you"]) expect(out).toContain(label);
    expect(out.match(/<img /g)).toHaveLength(6);
    expect(out).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*Original/);
    const withIt = html(createElement(LayoutChooser, { poster: withLayoutPreset(base, "notice", { headline: "x" }), brand, headline: "x", greeting: "", ornament: "leaf", onPoster: noop, disabled: false }));
    expect(withIt).toMatch(/aria-checked="true"[^>]*>(?:(?!<\/button>).)*Notice/);
  });

  it("is disabled as a whole while the flyer maker is busy", () => {
    const out = html(createElement(LayoutChooser, { poster: base, brand, headline: "x", greeting: "", ornament: "leaf", onPoster: noop, disabled: true }));
    expect(out.match(/disabled=""/g)).toHaveLength(6);
  });
});

describe("the block editors", () => {
  const poster = withLayoutPreset(base, "notice", { headline: "Community Supper", greeting: "Welcome" });
  const out = html(createElement(LayoutBlockEditors, { eventId: EVENT, poster, headline: "Community Supper", greeting: "Welcome", onPoster: noop, disabled: false }));

  it("show nothing without a layout", () => {
    expect(html(createElement(LayoutBlockEditors, { eventId: EVENT, poster: base, headline: "x", greeting: "", onPoster: noop, disabled: false }))).toBe("");
  });

  it("have a section for each block of the layout, in plain words", () => {
    for (const heading of ["Above the title", "Decoration", "Greetings", "Picture", "Host or sponsor card", "Note box", "Thank-you cards", "Donors and closing message", "Call to action and contacts"]) expect(out).toContain(heading);
    expect(out).toContain("Accent word (optional)");
    expect(out).toContain("Add a contact");
  });

  it("offer the title's words as the accent, and the community's own greeting", () => {
    expect(out).toContain("Pick the accent word from the title");
    expect(out).toContain(">Supper</button>");
    const other = html(createElement(LayoutBlockEditors, { eventId: EVENT, poster: { ...poster, layout: { ...poster.layout!, greeting: { top: "", bottom: "" } } }, headline: "Community Supper", greeting: "Welcome", onPoster: noop, disabled: false }));
    expect(other).toContain("Use “Welcome” at the top and bottom");
    // With no greeting for the community's tradition there is nothing to offer.
    expect(html(createElement(LayoutBlockEditors, { eventId: EVENT, poster, headline: "Community Supper", greeting: "", onPoster: noop, disabled: false }))).not.toContain("Use “");
  });

  it("hide a switched-off block's fields but keep its words", () => {
    const off = withLayoutPreset(base, "notice", { headline: "x" });
    const l = { ...off.layout!, off: ["host" as const, "note" as const, "contacts" as const], host: { label: "Hosted by", names: "The Okafors" } };
    const o = html(createElement(LayoutBlockEditors, { eventId: EVENT, poster: { ...off, layout: l }, headline: "x", greeting: "", onPoster: noop, disabled: false }));
    expect(o).not.toContain("layout-host-names");
    expect(o).not.toContain("layout-note");
    expect(o).not.toContain("Add a contact");
    expect(l.host.names).toBe("The Okafors");
  });

  it("let the organizer pick the corner decoration, by a name that is the same for every community", () => {
    for (const label of ["Leaves", "Blossoms", "Lotus", "None"]) expect(out).toContain(label);
    expect(out).toContain("Corner decoration");
  });

  it("tell the organizer that names are set by Weaver and never sent to an AI", () => {
    expect(out).toContain("never sent to an AI");
  });

  it("let the organizer pick the picture's frame and choose a photo from the albums, and say it is never made by AI", () => {
    expect(out).toContain("Picture frame");
    for (const label of ["Arched window", "Rounded frame", "Circle", "Free (as it is)"]) expect(out).toContain(label);
    expect(out).toContain("Choose a picture from your albums");
    expect(out).toContain("Weaver never makes it");
    const chosen = html(
      createElement(LayoutBlockEditors, { eventId: EVENT, poster: { ...poster, layout: { ...poster.layout!, hero: { photo_id: "33333333-3333-4333-8333-333333333333", shape: "arch" } } }, headline: "x", greeting: "", onPoster: noop, disabled: false }),
    );
    expect(chosen).toContain("Choose another picture");
    expect(chosen).toContain("Remove the picture");
  });

  it("edit up to six thank-you cards, each with a heading, a picture and names", () => {
    expect(out).toContain("Add a card");
    const withCards = html(
      createElement(LayoutBlockEditors, {
        eventId: EVENT,
        poster: { ...poster, layout: { ...poster.layout!, credits: [{ heading: "Welcome team", names: "Dana, Marcus", icon: "people" as const }] } },
        headline: "x",
        greeting: "",
        onPoster: noop,
        disabled: false,
      }),
    );
    expect(withCards).toContain("Card 1");
    expect(withCards).toContain("layout-credit-0-heading");
    expect(withCards).toContain("Picture for card 1");
    const six = Array.from({ length: 6 }, (_, i) => ({ heading: `T${i}`, names: "", icon: "people" as const }));
    expect(html(createElement(LayoutBlockEditors, { eventId: EVENT, poster: { ...poster, layout: { ...poster.layout!, credits: six } }, headline: "x", greeting: "", onPoster: noop, disabled: false }))).toContain("All 6 cards used");
  });

  it("stop at three contacts", () => {
    const three = { ...poster, layout: { ...poster.layout!, contacts: [1, 2, 3].map((n) => ({ name: `P${n}`, detail: "555" })) } };
    expect(html(createElement(LayoutBlockEditors, { eventId: EVENT, poster: three, headline: "x", greeting: "", onPoster: noop, disabled: false }))).toContain("All 3 contacts used");
  });

  it("the creator's own words (sub-title, tagline, footer) are plain fields", () => {
    const words = html(createElement(LayoutPosterWords, { poster, onPoster: noop, disabled: false }));
    for (const label of ["Sub-title (optional)", "Tagline (optional)", "Footer line (optional)"]) expect(words).toContain(label);
  });
});
