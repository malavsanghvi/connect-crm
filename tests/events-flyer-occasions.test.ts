import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { findBlockedArtTerm, withLayerGuardrail } from "@/lib/events/flyer";
import { FLYER_AI_LAYER_OCCASIONS, canAskAiLayer, flyerOccasionsFor, occasionFor } from "@/lib/events/flyer-art";
import { artFactsFor, buildBackgroundPrompt, buildLayerPrompt, encodeArtFacts, readArtFacts, styleFromTemplates } from "@/lib/events/flyer-art-prompt";
import {
  FLYER_OCCASIONS,
  LEGACY_OCCASIONS,
  OCCASION_CATALOG,
  defaultOccasionFor,
  flyerTraditionFor,
  occasionChoices,
  occasionLabel,
  occasionsFor,
  occasionsToReview,
  preselectOccasion,
  seasonOf,
  suggestOccasion,
  type FlyerOccasion,
  type OccasionKind,
} from "@/lib/events/flyer-occasions";
import { drawnPackKey } from "@/lib/events/flyer-art-packs";
import { drawnTakeOccasions } from "@/lib/events/publish-schedule";
import { LEGACY_KIND } from "@/lib/kind";

// Five kinds of organization (and two more), as app.category_profile describes them (key, faith-based, terms).
const JAIN: OccasionKind = { key: "jain_center", label: "Jain Center", faithBased: true, terms: LEGACY_KIND.terms };
const CHURCH: OccasionKind = { key: "church", label: "Church", faithBased: true, terms: { school: null } };
const MOSQUE: OccasionKind = { key: "mosque", label: "Mosque", faithBased: true, terms: {} };
const CHAMBER: OccasionKind = { key: "chamber_of_commerce", label: "Chamber of commerce", faithBased: false, terms: { school: null } };
const CLUB: OccasionKind = { key: "nonprofit_secular", label: "Non-profit (not faith-based)", faithBased: false, terms: { school: null } };
const NONE: OccasionKind = { key: "neighbourhood_association", label: "Neighbourhood association", faithBased: false };
const FAITH_OTHER: OccasionKind = { key: "faith_other", label: "Faith-based non-profit (other faiths)", faithBased: true, terms: { school: "Religious school" } };

const EVERYONE = ["gala", "workshop", "volunteer_day", "picnic", "annual_meeting", "thanksgiving", "new_year"];

describe("the occasions each kind is offered (golden)", () => {
  it("a Jain community keeps every Flyers v2 occasion, first and in the same order, plus worship and the ones for everyone", () => {
    expect(occasionsFor(JAIN)).toEqual(["garba", "paryushan", "diwali", "mahavir", "convention", "pathshala", "bhakti", "worship", ...EVERYONE, "general", "other"]);
    // The fixture the screens use, and the same kind by its tradition alone.
    expect(flyerOccasionsFor(LEGACY_KIND)).toEqual(occasionsFor(JAIN));
    expect(occasionsFor({ key: "any_kind", faithBased: true }, "sthanakvasi")).toContain("paryushan");
    for (const o of LEGACY_OCCASIONS) expect(occasionsFor(JAIN)).toContain(o);
  });

  it("a church sees Christmas, Easter and worship, and nothing of another faith", () => {
    expect(occasionsFor(CHURCH)).toEqual(["christmas_eve", "easter", "worship", ...EVERYONE, "general", "other"]);
  });

  it("a mosque sees Eid and worship", () => {
    expect(occasionsFor(MOSQUE)).toEqual(["eid", "worship", ...EVERYONE, "general", "other"]);
  });

  it("a chamber sees a mixer and a ribbon cutting first", () => {
    expect(occasionsFor(CHAMBER)).toEqual(["mixer", "ribbon_cutting", ...EVERYONE, "general", "other"]);
  });

  it("a club and a community with no tradition see the civic occasions, no faith's", () => {
    expect(occasionsFor(CLUB)).toEqual([...EVERYONE, "mixer", "general", "other"]);
    expect(occasionsFor(NONE)).toEqual(occasionsFor(CLUB));
  });

  it("a faith community of no listed tradition gets worship and its school's classes, in its own words", () => {
    expect(occasionsFor(FAITH_OTHER)).toEqual(["pathshala", "worship", ...EVERYONE, "general", "other"]);
    expect(occasionLabel("pathshala", FAITH_OTHER)).toBe("Religious school / kids");
    expect(occasionLabel("pathshala", JAIN, "jain")).toBe("Pathshala / kids");
  });

  it("never offers a faith's occasion to a community of another faith (or none), and always offers Other occasion", () => {
    const faithKeys = OCCASION_CATALOG.filter((o) => "appliesTo" in o && o.appliesTo && "traditions" in o.appliesTo).map((o) => o.key);
    for (const kind of [CHURCH, MOSQUE, CHAMBER, CLUB, NONE, FAITH_OTHER, JAIN]) {
      const t = flyerTraditionFor(kind);
      const offered = occasionsFor(kind);
      expect(offered.at(-1), kind.key).toBe("other");
      for (const key of faithKeys) {
        const spec = OCCASION_CATALOG.find((o) => o.key === key)!;
        const own = t !== null && "appliesTo" in spec && (spec.appliesTo as { traditions?: readonly string[] }).traditions?.includes(t);
        if (!own && key !== "pathshala") expect(offered, `${kind.key} ${key}`).not.toContain(key);
      }
    }
  });

  it("keeps a saved poster's occasion listed even when the community would not see it", () => {
    expect(flyerOccasionsFor(CHAMBER, "diwali")).toContain("diwali");
    expect(flyerOccasionsFor(CHAMBER)).not.toContain("diwali");
  });

  it("has a default per kind", () => {
    expect(defaultOccasionFor(JAIN)).toBe("general");
    expect(defaultOccasionFor(CHURCH)).toBe("worship");
    expect(defaultOccasionFor(MOSQUE)).toBe("worship");
    expect(defaultOccasionFor(CHAMBER)).toBe("mixer");
    expect(defaultOccasionFor(CLUB)).toBe("general");
    expect(defaultOccasionFor(NONE)).toBe("general");
  });

  it("labels worship in each tradition's words and groups the choices", () => {
    expect(occasionLabel("worship", CHURCH, "christian")).toBe("Worship service");
    expect(occasionLabel("worship", MOSQUE, "muslim")).toBe("Prayer gathering / Jummah");
    expect(occasionLabel("worship", FAITH_OTHER, null)).toBe("Worship / gathering");
    const choices = occasionChoices(CHAMBER);
    expect(choices[0]).toEqual({ key: "mixer", label: "Mixer / networking", group: "business" });
    expect(choices.at(-1)).toEqual({ key: "other", label: "Other occasion", group: "any" });
  });
});

const first = (kind: OccasionKind, title: string, extra: { description?: string; startsAt?: string; tradition?: string } = {}) =>
  preselectOccasion(suggestOccasion({ title, kind, ...extra }));

describe("the suggested occasion (golden: three titles per kind)", () => {
  const cases: [OccasionKind, string, FlyerOccasion][] = [
    [JAIN, "Navratri Garba Night 2026", "garba"],
    [JAIN, "Paryushan Mahaparva", "paryushan"],
    [JAIN, "Sangh Annual General Meeting", "annual_meeting"],
    [CHURCH, "Christmas Eve Candlelight Service", "christmas_eve"],
    [CHURCH, "Easter Sunrise Service", "easter"],
    [CHURCH, "Sunday Worship and Potluck", "worship"],
    [MOSQUE, "Eid al-Fitr Prayer", "eid"],
    [MOSQUE, "Ramadan Iftar Dinner", "eid"],
    [MOSQUE, "Friday Jummah", "worship"],
    [CHAMBER, "Business After Hours at Acme Bank", "mixer"],
    [CHAMBER, "Grand Opening: Joe's Coffee", "ribbon_cutting"],
    [CHAMBER, "Annual Awards Gala", "gala"],
    [CLUB, "Summer Picnic in the Park", "picnic"],
    [CLUB, "Annual General Meeting 2027", "annual_meeting"],
    [CLUB, "Beach Cleanup Volunteer Day", "volunteer_day"],
    [NONE, "Christmas Party", "general"],
    [NONE, "Diwali night", "general"],
    [NONE, "Leadership Workshop", "workshop"],
  ];
  for (const [kind, title, want] of cases) {
    it(`${kind.key}: "${title}" → ${want}`, () => expect(first(kind, title)).toBe(want));
  }

  it("picks the occasions docs/EVENT_CREATION.md names", () => {
    expect(first(CHURCH, "Christmas Eve candlelight service")).toBe("christmas_eve");
    expect(first(MOSQUE, "Eid dinner")).toBe("eid");
    expect(first(CHAMBER, "Ribbon cutting at Lopez Bakery")).toBe("ribbon_cutting");
    expect(first(CLUB, "Summer picnic")).toBe("picnic");
    expect(first({ key: "swaminarayan_temple", faithBased: true }, "Diwali dinner")).toBe("diwali");
  });

  it("gives its reason in plain words", () => {
    const [top] = suggestOccasion({ title: "Christmas Eve at St. Mark's", kind: CHURCH });
    expect(top).toMatchObject({ occasion: "christmas_eve", basis: "title" });
    expect(top!.reason).toBe('The event\'s name mentions "christmas eve".');
  });

  it("reads the community's languages", () => {
    expect(first(JAIN, "નવરાત્રી ગરબા મહોત્સવ")).toBe("garba");
    expect(first(JAIN, "दिवाली मिलन")).toBe("diwali");
    expect(first(CHURCH, "Misa de Nochebuena")).toBe("christmas_eve");
    expect(first(CHURCH, "Veillée de Noël")).toBe("christmas_eve");
    expect(first(MOSQUE, "عيد الفطر")).toBe("eid");
    expect(first({ key: "synagogue", faithBased: true }, "חנוכה party", { tradition: "jewish" })).toBe("hanukkah");
  });

  it("reads the description when the title says nothing", () => {
    expect(first(JAIN, "Evening of fun", { description: "Bring your dandiya sticks for garba under the lights." })).toBe("garba");
  });

  it("suggests from the date without choosing for the organizer", () => {
    const s = suggestOccasion({ title: "Fellowship evening", startsAt: "2026-12-20T23:00:00Z", tz: "America/Chicago", kind: CHURCH });
    expect(s[0]).toMatchObject({ occasion: "christmas_eve", basis: "season" });
    expect(s[0]!.reason).toBe("Christmas Eve / Christmas falls on 24 and 25 December, like this event.");
    expect(preselectOccasion(s)).toBe("worship");
    const jain = suggestOccasion({ title: "Community dinner", startsAt: "2026-11-08T18:00:00Z", kind: JAIN });
    expect(jain.map((x) => x.occasion)).toContain("diwali");
    expect(preselectOccasion(jain)).toBe("general");
  });

  it("uses the community's own calendar for festivals that move", () => {
    const s = suggestOccasion({ title: "Community dinner", kind: MOSQUE, calendar: [{ title: "Eid al-Adha" }] });
    expect(s[0]).toMatchObject({ occasion: "eid", basis: "calendar", reason: 'Your calendar has "Eid al-Adha" on this date.' });
    expect(preselectOccasion(s)).toBe("worship");
  });

  it("keeps the Flyers v2 suggestions when no community is known", () => {
    expect(occasionFor("Navratri Garba Night")).toBe("garba");
    expect(occasionFor("JAINA 2027 Houston Host City Kick-Off")).toBe("convention");
    expect(occasionFor("Youth Convention")).toBe("convention");
    expect(occasionFor("Christmas Eve", null, { kind: CHAMBER })).toBe("mixer");
  });
});

const OTHER_FAITHS: Record<string, RegExp> = {
  christian: /christian|church|christmas|easter|stained-glass|nativity/i,
  muslim: /muslim|islamic|mosque|minaret|crescent|\beid\b|arabesque/i,
  jewish: /jewish|menorah|six-pointed|shabbat|hanukkah/i,
  dharmic: /\bjain|hindu|mandala|rangoli|oil lamp|marigold (?!gold)|toran|temple|lotus|navratri|diwali|tabla|sikh|buddhist/i,
};

describe("the AI prompts (data plus a small fixed rubric)", () => {
  const brand = { primary: "#14213D", accent: "#FCA311", background: "#FFFFFF" };
  const promptFor = (kind: OccasionKind, layer: "frame" | "scene") =>
    buildLayerPrompt({ ...artFactsFor({ occasion: defaultOccasionFor(kind), layer, kind, brand, startsAt: "2026-07-04T17:00:00Z", country: "US" }), layer });

  it("differ for a church, a chamber, a club and a Jain temple, and none mentions another faith", () => {
    const church = promptFor(CHURCH, "scene");
    const chamber = promptFor(CHAMBER, "scene");
    const club = promptFor(CLUB, "scene");
    const jain = promptFor(JAIN, "scene");
    expect(new Set([church, chamber, club, jain]).size).toBe(4);
    for (const re of [OTHER_FAITHS.muslim, OTHER_FAITHS.jewish, OTHER_FAITHS.dharmic]) expect(church).not.toMatch(re!);
    for (const re of Object.values(OTHER_FAITHS)) {
      expect(chamber).not.toMatch(re);
      expect(club).not.toMatch(re);
    }
    for (const re of [OTHER_FAITHS.christian, OTHER_FAITHS.muslim, OTHER_FAITHS.jewish]) expect(jain).not.toMatch(re!);
    expect(church).toMatch(/Christian church community/);
    expect(chamber).toMatch(/chamber of commerce/);
    expect(club).toMatch(/community non-profit or club/);
    expect(jain).toMatch(/a Jain community/);
  });

  it("name the brand colours and the season, and always keep the rubric", () => {
    const p = promptFor(CHAMBER, "frame");
    expect(p).toMatch(/deep navy and marigold gold on ivory cream/);
    expect(p).toMatch(/Season: bright summer light/);
    expect(p).toMatch(/Keep the middle calm/);
    expect(p).toMatch(/sacred symbol is shown small, simple and in its conventional form/);
    expect(p).toMatch(/centre left as a large, plain, empty/);
  });

  it("keep a Flyers v2 occasion's traditional colours, with touches of the brand", () => {
    const p = buildLayerPrompt({ ...artFactsFor({ occasion: "diwali", layer: "frame", kind: JAIN, brand }), layer: "frame" });
    expect(p).toMatch(/marigold and mango-leaf toran/);
    expect(p).toMatch(/Keep the traditional colours described, with small touches of deep navy and marigold gold/);
  });

  it("every occasion, for every kind, has no blocked word and fits the request with the guardrail", () => {
    for (const kind of [JAIN, CHURCH, MOSQUE, CHAMBER, CLUB, NONE, FAITH_OTHER]) {
      for (const occasion of FLYER_OCCASIONS) {
        for (const layer of ["frame", "scene"] as const) {
          const p = buildLayerPrompt({ ...artFactsFor({ occasion, layer, kind, brand, startsAt: "2026-01-10T17:00:00Z", country: "GB", style: "minimal", note: "a harvest lantern walk by the river" }), layer });
          expect(findBlockedArtTerm(p), `${kind.key} ${occasion} ${layer}`).toBeNull();
          expect(withLayerGuardrail(p).length).toBeLessThanOrEqual(2000);
          expect(withLayerGuardrail(p)).toContain(p);
        }
      }
    }
  });

  it("never carry the event's name: the title only chooses the occasion", () => {
    const title = "Priya Shah's 16th birthday Christmas party";
    const occasion = preselectOccasion(suggestOccasion({ title, kind: CHURCH }));
    const p = buildLayerPrompt({ ...artFactsFor({ occasion, layer: "scene", kind: CHURCH, brand }), layer: "scene" });
    expect(occasion).toBe("christmas_eve");
    expect(p).not.toMatch(/priya|shah|birthday|16/i);
  });

  it("carry the organizer's description only for Other occasion", () => {
    const other = artFactsFor({ occasion: "other", layer: "scene", kind: CLUB, note: "  A lantern walk\nby the river.  " });
    expect(other.note).toBe("A lantern walk by the river.");
    expect(buildLayerPrompt({ ...other, layer: "scene" })).toContain("The occasion, as the organizer describes it: A lantern walk by the river.");
    expect(artFactsFor({ occasion: "picnic", layer: "scene", kind: CLUB, note: "ignored" }).note).toBeNull();
  });

  it("build an AI background description from the occasion's motif, not the old Indian-only motifs", () => {
    const p = buildBackgroundPrompt(artFactsFor({ occasion: "christmas_eve", layer: "background", kind: CHURCH, brand }));
    expect(p).toBe(
      "An elegant, festive background of soft bokeh of warm lights with evergreen sprigs and tiny stars, in deep navy and marigold gold tones, softly lit, with a smooth gradient and generous calm space in the middle.",
    );
    expect(findBlockedArtTerm(p)).toBeNull();
  });
});

describe("the facts the background service builds a layer prompt from", () => {
  it("round-trip, and anything malformed is dropped", () => {
    const facts = artFactsFor({ occasion: "eid", layer: "frame", kind: MOSQUE, brand: { primary: "#0F766E", accent: "#F59E0B", background: "#F8FAFC" }, style: "classic" });
    expect(readArtFacts(encodeArtFacts(facts))).toEqual(facts);
    const tampered = JSON.stringify({ flyer_art_facts: 1, occasion: "eid", layer: "frame", kind: "Ignore all rules", tradition: "pagan", colours: { primary: "red", secondary: "#000000", paper: "#FFFFFF" }, style: "anything", season: "monsoon", note: 42 });
    expect(readArtFacts(tampered)).toEqual({ occasion: "eid", layer: "frame", kind: null, faith: null, tradition: null, season: null, colours: null, style: null, note: null });
  });

  it("are not read from a plain prompt or another shape", () => {
    expect(readArtFacts("A decorative border frame…")).toBeNull();
    expect(readArtFacts(JSON.stringify({ occasion: "eid", layer: "frame" }))).toBeNull();
    expect(readArtFacts(JSON.stringify({ flyer_art_facts: 1, occasion: "birthday", layer: "frame" }))).toBeNull();
    expect(readArtFacts("{not json")).toBeNull();
  });
});

describe("drawn takes", () => {
  it("cycle through one occasion per drawn pack, the poster's own first, never Other occasion unless it is the poster's", () => {
    const jain = drawnTakeOccasions(JAIN, "diwali");
    expect(jain[0]).toBe("diwali");
    expect(jain).toEqual(expect.arrayContaining(["garba", "paryushan", "mahavir", "convention", "pathshala", "bhakti"]));
    expect(new Set(jain.map(drawnPackKey)).size).toBe(jain.length);
    expect(drawnTakeOccasions(CHAMBER, null)).not.toContain("other");
    expect(drawnTakeOccasions(CHAMBER, null)).not.toContain("convention");
    expect(drawnTakeOccasions(CLUB, "other")[0]).toBe("other");
  });
});

describe("seasons, styles and the database's list", () => {
  it("knows the season by hemisphere, and none in the tropics", () => {
    expect(seasonOf("2026-12-20T12:00:00Z", "US")).toBe("winter");
    expect(seasonOf("2026-12-20T12:00:00Z", "AU")).toBe("summer");
    expect(seasonOf("2026-12-20T12:00:00Z", "IN")).toBeNull();
    expect(seasonOf(null, "US")).toBeNull();
  });

  it("takes the style of past flyers only when one template clearly leads", () => {
    expect(styleFromTemplates(["minimal", "minimal", "festival"])).toBe("minimal");
    expect(styleFromTemplates(["minimal", "festival"])).toBeNull();
    expect(styleFromTemplates(["poster", "photo", "poster"])).toBeNull();
  });

  it("asks for AI frames and scenes only for the occasions the database stores (0585)", () => {
    const sql = readFileSync("supabase/migrations/0585_flyers_v2.sql", "utf8");
    const list = /p_occasion not in \(([^)]+)\)/.exec(sql)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect([...FLYER_AI_LAYER_OCCASIONS].sort()).toEqual([...list].sort());
    expect(sql).toContain(`/flyer-art/(${list.join("|")})/`);
    expect(canAskAiLayer("diwali")).toBe(true);
    expect(canAskAiLayer("christmas_eve")).toBe(false);
  });

  it("lists the occasions a member of the faith should review, each tied to that tradition", () => {
    const review = occasionsToReview();
    expect(review).toEqual([
      { occasion: "garba", tradition: "hindu" },
      { occasion: "diwali", tradition: "hindu" },
      { occasion: "christmas_eve", tradition: "christian" },
      { occasion: "easter", tradition: "christian" },
      { occasion: "eid", tradition: "muslim" },
      { occasion: "hanukkah", tradition: "jewish" },
    ]);
    for (const r of review) {
      const spec = OCCASION_CATALOG.find((o) => o.key === r.occasion)!;
      expect((spec as { appliesTo?: { traditions?: readonly string[] } }).appliesTo?.traditions).toContain(r.tradition);
    }
  });
});
