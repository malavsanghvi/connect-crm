// The flyer occasions as DATA (B96, 2026-10-11): which occasions a community is offered, what each is called, when in
// the year it falls, which drawn art pack draws it, how the AI art prompt describes it, and the words in an event's
// title that point to it. Behaviour comes from this table by the organization's kind and tradition, never from a code
// branch on a faith: a Jain community keeps every occasion it had, a church sees Christmas and Easter, a mosque Eid, a
// chamber a mixer and a ribbon cutting, a club a picnic and an annual meeting, and every community can choose
// "Other occasion" and describe it in its own words. A faith's occasions are tied to that tradition and never offered to
// another by default.
//
// Pure, no imports: the portal, the renderer and the background service (worker/, through flyer-art.ts) all read it.
// A database catalog is a later step; until then a new occasion is one entry here (plus, for AI frames and scenes,
// the database's list of occasions: see FLYER_AI_LAYER_OCCASIONS in flyer-art.ts).

// ── Traditions ───────────────────────────────────────────────────────────────

/** The faith traditions occasions can be tied to (the experience families of 0600). */
export const FLYER_TRADITIONS = ["jain", "hindu", "christian", "muslim", "sikh", "buddhist", "jewish"] as const;
export type FlyerTradition = (typeof FLYER_TRADITIONS)[number];

export function isFlyerTradition(v: unknown): v is FlyerTradition {
  return typeof v === "string" && (FLYER_TRADITIONS as readonly string[]).includes(v);
}

/**
 * The tradition of an organization kind, when the kind is one faith's (organization_categories.family_key in 0600, for
 * the kinds that exist today). A kind that is not listed has no tradition: it is offered the occasions for every
 * community (and worship when it is faith-based). A caller that knows the family key passes it instead.
 */
export const FLYER_KIND_TRADITION: Readonly<Record<string, FlyerTradition>> = {
  jain_center: "jain",
  swaminarayan_temple: "hindu",
  church: "christian",
  mosque: "muslim",
};

/**
 * centers.tradition (app.tradition, 0001) values that name a tradition. 'other' names none. These values are the
 * branches of one faith, so a community that set one is of that faith whatever its kind.
 */
export const FLYER_CENTER_TRADITION: Readonly<Record<string, FlyerTradition>> = {
  shvetambar_murtipujak: "jain",
  sthanakvasi: "jain",
  terapanthi: "jain",
  digambar: "jain",
};

/** The few words the AI prompt uses for the community a picture is made for (never its name). */
export const FLYER_TRADITION_CONTEXT: Readonly<Record<FlyerTradition, string>> = {
  jain: "a Jain community",
  hindu: "a Hindu temple community",
  christian: "a Christian church community",
  muslim: "a Muslim community",
  sikh: "a Sikh community",
  buddhist: "a Buddhist community",
  jewish: "a Jewish community",
};

/** The same for kinds that are not a faith's. Others: "a faith community" or "a community organization". */
export const FLYER_KIND_CONTEXT: Readonly<Record<string, string>> = {
  chamber_of_commerce: "a local chamber of commerce and its member businesses",
  nonprofit_secular: "a community non-profit or club",
};

/** The occasion a poster starts from when its title points to none, per kind (else "general"). */
export const FLYER_KIND_DEFAULT: Readonly<Record<string, string>> = {
  church: "worship",
  mosque: "worship",
  faith_other: "worship",
  chamber_of_commerce: "mixer",
};

// ── Occasions ────────────────────────────────────────────────────────────────

export type OccasionGroup = "festival" | "faith" | "community" | "business" | "any";
export const OCCASION_GROUP_LABEL: Readonly<Record<OccasionGroup, string>> = {
  festival: "Festivals",
  faith: "Worship and faith",
  community: "Community",
  business: "Business",
  any: "Any occasion",
};

/** A window of the year, as MM-DD (it may run over New Year), and a few words for the reason shown to the organizer. */
export type OccasionSeason = { from: string; to: string; note: string };

/** What the AI prompt says for an occasion: the frame's ornaments, the bottom scene, a background motif, and what to avoid. */
export type OccasionPrompt = {
  frame: string;
  scene: string;
  /** A motif for AI background art behind the Classic, Festival and Minimal templates. */
  background: string;
  /** What the picture must not show besides the fixed rules (no lettering, no people, no deities). */
  avoid: string;
};

export type OccasionSpec = {
  key: string;
  label: string;
  /** The label in a tradition's own words (the worship service is a puja, a Jummah, a Shabbat service). */
  labelByTradition?: Partial<Record<FlyerTradition, string>>;
  /** The label from the kind's own term when it has one ("{term} / kids" with the kind's school, "Pathshala"). */
  termLabel?: { term: string; label: string };
  /**
   * Who is offered it; absent: every community. A community qualifies when it matches ANY listed condition: one of the
   * kinds, one of the traditions, a faith-based kind (`faith: true`) or not (`faith: false`), or a kind with the term.
   */
  appliesTo?: { kinds?: readonly string[]; traditions?: readonly FlyerTradition[]; faith?: boolean; term?: string };
  season?: OccasionSeason;
  /** The drawn art pack (flyer-art-packs.ts); a pack not drawn yet falls back to the general one. */
  pack: string;
  group: OccasionGroup;
  /** 3: one festival; 2: one kind's or tradition's own kind of event; 1: an event any community holds; 0: the fallbacks. */
  priority: 0 | 1 | 2 | 3;
  /** Words in a title or description that point to it, in the languages its communities use (matched whole, any case). */
  keywords: readonly string[];
  /** Whether the art follows the brand kit's colours ("brand") or keeps the occasion's own traditional colours ("fixed"). */
  colours: "brand" | "fixed";
  prompt: OccasionPrompt;
  /** A tradition's own prompt (the General border is a mandala for a Jain or Hindu community, plain filigree for the rest). */
  promptByTradition?: Partial<Record<FlyerTradition, Partial<OccasionPrompt>>>;
  /** A member of this tradition should look at the drawn and AI art before it is released to that tradition's communities. */
  review?: FlyerTradition;
};

const LOTUS_BACKGROUND = "stylised lotus petals and soft concentric water ripples";
const MANDALA_BACKGROUND = "concentric mandala rings of petals and fine geometric lines";
const NEUTRAL_BACKGROUND = "soft geometric rosettes, fine flowing lines and gentle light";

/**
 * The catalog. Order matters: it is the order a community sees within each rank, and it breaks ties between equally
 * good suggestions. The first eight keys and their meaning are unchanged from Flyers v2 (0585 knows them).
 */
export const OCCASION_CATALOG = [
  {
    key: "garba",
    label: "Garba / Navratri",
    appliesTo: { traditions: ["jain", "hindu"] },
    season: { from: "09-10", to: "10-31", note: "usually falls in September or October" },
    pack: "garba",
    group: "festival",
    priority: 3,
    keywords: ["garba", "navratri", "navaratri", "navratri utsav", "dandiya", "raas", "ras garba", "ગરબા", "નવરાત્રી", "નવરાત્રિ", "દાંડિયા", "गरबा", "नवरात्रि", "नवरात्री", "डांडिया"],
    colours: "fixed",
    prompt: {
      frame: "Navratri festival ornaments: gold mandalas in the corners, mirror-work and bandhani dots in magenta, saffron and emerald, small dandiya sticks and marigold accents, on a warm cream background.",
      scene: "A festive Navratri night: colourful hanging lanterns, triangle bunting and string lights over a decorated stage arch, swirling dandiya sticks and marigold garlands, magenta, saffron and gold on a deep plum ground, warm cream sky above.",
      background: "a symmetrical rangoli rosette of petals, dots and fine curved lines",
      avoid: "any figures",
    },
    review: "hindu",
  },
  {
    key: "paryushan",
    label: "Paryushan",
    appliesTo: { traditions: ["jain"] },
    season: { from: "08-05", to: "09-30", note: "usually falls in August or September" },
    pack: "paryushan",
    group: "festival",
    priority: 3,
    keywords: ["paryushan", "paryushana", "pajushan", "das lakshan", "daslakshan", "dashlakshan", "samvatsari", "pratikraman", "પર્યુષણ", "પજુસણ", "સંવત્સરી", "પ્રતિક્રમણ", "पर्युषण", "संवत्सरी", "दशलक्षण", "प्रतिक्रमण"],
    colours: "fixed",
    prompt: {
      frame: "Serene and minimal: thin gold lines, small lotus buds in the corners and gentle leaf vines in soft sage green, on an ivory background.",
      scene: "A calm lotus pond at dawn: pink and white lotus flowers and round green leaves on still water with soft ripples, distant low hills, pale gold light, ivory sky above.",
      background: LOTUS_BACKGROUND,
      avoid: "anything loud or festive; feasting",
    },
  },
  {
    key: "diwali",
    label: "Diwali",
    appliesTo: { traditions: ["jain", "hindu"] },
    season: { from: "10-10", to: "11-20", note: "usually falls in October or November" },
    pack: "diwali",
    group: "festival",
    priority: 3,
    keywords: ["diwali", "deepavali", "dipawali", "divali", "deepawali", "annakut", "annakoot", "nutan varsh", "bestu varas", "દિવાળી", "અન્નકૂટ", "નૂતન વર્ષ", "दिवाली", "दीपावली", "अन्नकूट"],
    colours: "fixed",
    prompt: {
      frame: "Festival of lights ornaments: a marigold and mango-leaf toran garland across the top, gold rangoli rosettes in the corners, tiny glowing oil lamps along the sides, deep plum and saffron accents, on a warm cream background.",
      scene: "Rows of small glowing clay oil lamps on a colourful rangoli floor, soft sparkles and gentle fireworks bursts in a deep plum twilight, saffron and gold glow, warm cream sky above.",
      background: "rows of small glowing oil lamps as soft points of golden light over a gentle dotted pattern",
      avoid: "firecrackers close up",
    },
    review: "hindu",
  },
  {
    key: "mahavir",
    label: "Mahavir Janma Kalyanak",
    appliesTo: { traditions: ["jain"] },
    season: { from: "03-20", to: "04-30", note: "usually falls in March or April" },
    pack: "mahavir",
    group: "festival",
    priority: 3,
    keywords: ["mahavir", "mahaveer", "mahavira", "janma kalyanak", "janm kalyanak", "mahavir jayanti", "jayanti", "મહાવીર", "જન્મ કલ્યાણક", "महावीर", "जन्म कल्याणक"],
    colours: "fixed",
    prompt: {
      frame: "Auspicious geometric ornaments: saffron and gold lotus rosettes in the corners, a mango-leaf toran across the top, fine gold filigree along the sides, on a warm ivory background.",
      scene: "Carved white marble temple spires with small saffron flags at sunrise, a row of lotus flowers in front, soft saffron and gold light, ivory sky above. Architecture only.",
      background: LOTUS_BACKGROUND,
      avoid: "any figure or likeness",
    },
  },
  {
    key: "convention",
    label: "Convention / kick-off",
    appliesTo: { traditions: ["jain", "hindu"] },
    pack: "convention",
    group: "community",
    priority: 2,
    keywords: ["convention", "kick off", "kickoff", "jaina", "summit", "conference", "sammelan", "અધિવેશન", "सम्मेलन"],
    colours: "fixed",
    prompt: {
      frame: "Elegant gold double border with gold mandalas in the corners and soft green eucalyptus sprigs, refined and celebratory, on a cream background.",
      scene: "A modern city skyline at dusk in purple, rose and gold, glowing windows, festive string lights across the top of the strip, a dark ground line, cream sky above.",
      background: MANDALA_BACKGROUND,
      avoid: "busy scenes",
    },
  },
  {
    key: "pathshala",
    label: "Classes / kids",
    labelByTradition: { jain: "Pathshala / kids" },
    termLabel: { term: "school", label: "{term} / kids" },
    appliesTo: { traditions: ["jain"], term: "school" },
    pack: "pathshala",
    group: "community",
    priority: 2,
    keywords: ["pathshala", "paathshala", "kids", "children", "youth", "school", "class", "classes", "camp", "sunday school", "બાળ", "પાઠશાળા", "पाठशाला"],
    colours: "fixed",
    prompt: {
      frame: "Playful and bright for young learners: rounded corners with stars, dots and small open books in sunny yellow, coral and sky blue, on a very light blue background.",
      scene: "Rolling green hills with a stack of colourful books, pencils, paper kites in the sky and a smiling sun shape, cheerful sky blue, coral and sunny yellow, light sky above.",
      background: "open books, paper kites and small stars in cheerful colours",
      avoid: "any figures",
    },
  },
  {
    key: "bhakti",
    label: "Bhakti / music",
    appliesTo: { traditions: ["jain", "hindu"] },
    pack: "bhakti",
    group: "faith",
    priority: 2,
    keywords: ["bhakti", "bhajan", "bhajans", "bhavna", "bhavana", "stavan", "sangeet", "kirtan", "music", "concert", "ભક્તિ", "ભજન", "ભાવના", "સ્તવન", "भक्ति", "भजन", "कीर्तन"],
    colours: "fixed",
    prompt: {
      frame: "Devotional music ornaments: gold paisley corners, jasmine flower vines and small brass bells along the sides, indigo and rose accents, on a soft blush background.",
      scene: "A row of classical Indian musical instruments — tabla drums, a harmonium and small brass cymbals — beside glowing oil lamps and marigold garlands, flowing ribbons of light like sound waves, indigo and gold, soft blush sky above.",
      background: "flowing ribbons of light like sound waves with small brass bells",
      avoid: "musicians or any figures",
    },
  },
  {
    key: "christmas_eve",
    label: "Christmas Eve / Christmas",
    appliesTo: { traditions: ["christian"] },
    season: { from: "11-28", to: "12-31", note: "falls on 24 and 25 December" },
    pack: "christmas_eve",
    group: "festival",
    priority: 3,
    keywords: ["christmas", "christmas eve", "xmas", "x mas", "carol", "carols", "carol service", "advent", "nativity", "candlelight service", "navidad", "nochebuena", "noel", "natal", "weihnacht", "weihnachten", "natale", "kerstmis", "pasko"],
    colours: "brand",
    prompt: {
      frame: "Winter festive ornaments: holly leaves with red berries and small pine sprigs in the corners, tiny golden stars and a fine string of warm lights along the edges.",
      scene: "A quiet snowy village street on a holy night: a small church with warmly glowing windows, evergreen trees with soft lights, gentle snowfall and one bright star in a deep blue sky.",
      background: "soft bokeh of warm lights with evergreen sprigs and tiny stars",
      avoid: "cartoon gift-giver characters and any figures of the nativity",
    },
    review: "christian",
  },
  {
    key: "easter",
    label: "Easter",
    appliesTo: { traditions: ["christian"] },
    season: { from: "03-15", to: "04-30", note: "falls in March or April" },
    pack: "easter",
    group: "festival",
    priority: 3,
    keywords: ["easter", "resurrection", "holy week", "good friday", "palm sunday", "maundy thursday", "pascua", "semana santa", "paques", "ostern", "pasqua", "pascoa"],
    colours: "brand",
    prompt: {
      frame: "Spring ornaments: white lilies and soft green leaves in the corners, small spring blossoms and fine vines along the sides.",
      scene: "A peaceful spring garden at sunrise: white lilies, tulips and daffodils in front of soft green hills, a path leading toward a garden with an open empty tomb in the rock, warm rays of morning light.",
      background: "white lilies, spring blossoms and soft rays of morning light",
      avoid: "cartoon rabbits and any figures",
    },
    review: "christian",
  },
  {
    key: "eid",
    label: "Eid",
    appliesTo: { traditions: ["muslim"] },
    pack: "eid",
    group: "festival",
    priority: 3,
    keywords: ["eid", "eid al fitr", "eid ul fitr", "eid al adha", "eid ul adha", "eid mubarak", "iftar", "ramadan", "ramazan", "ramzan", "bayram", "hari raya", "lebaran", "عيد", "رمضان", "إفطار", "افطار", "عید"],
    colours: "brand",
    prompt: {
      frame: "Islamic geometric ornaments: interlaced eight-pointed star patterns and arabesque vines in the corners, a row of small hanging lanterns along the top.",
      scene: "A skyline of domes and slender minarets at dusk, a thin crescent moon and one bright star, glowing hanging lanterns in the foreground, soft geometric patterns in the sky.",
      background: "interlaced geometric star patterns, arabesque vines and soft lantern light",
      avoid: "any living beings: only geometric, floral and architectural forms",
    },
    review: "muslim",
  },
  {
    key: "hanukkah",
    label: "Hanukkah",
    appliesTo: { traditions: ["jewish"] },
    season: { from: "11-25", to: "01-05", note: "falls in November or December" },
    pack: "hanukkah",
    group: "festival",
    priority: 3,
    keywords: ["hanukkah", "chanukah", "hanukah", "chanukkah", "hannukah", "menorah lighting", "חנוכה"],
    colours: "brand",
    prompt: {
      frame: "Gentle blue and silver geometric borders, small six-pointed stars and olive branches in the corners.",
      scene: "A Hanukkah menorah with nine glowing candles on a windowsill, the middle helper candle set higher than the eight others, a starry winter night outside, small spinning tops on the sill, soft blue and silver light.",
      background: "soft candle glow, small six-pointed stars and olive branches",
      avoid: "a seven-branched lamp (a Hanukkah menorah has nine places)",
    },
    review: "jewish",
  },
  {
    key: "worship",
    label: "Worship / gathering",
    labelByTradition: {
      jain: "Puja / pooja",
      hindu: "Puja / satsang",
      christian: "Worship service",
      muslim: "Prayer gathering / Jummah",
      sikh: "Diwan / kirtan",
      buddhist: "Meditation / service",
      jewish: "Shabbat / service",
    },
    appliesTo: { faith: true },
    pack: "worship",
    group: "faith",
    priority: 1,
    keywords: ["worship", "service", "sunday service", "mass", "liturgy", "vespers", "vigil", "prayer", "prayers", "praise", "puja", "pooja", "poojan", "snatra", "aarti", "satsang", "jummah", "jumuah", "jumma", "khutbah", "taraweeh", "shabbat", "shabbos", "havdalah", "diwan", "meditation", "પૂજા", "પૂજન", "આરતી", "સત્સંગ", "पूजा", "आरती", "सत्संग"],
    colours: "brand",
    prompt: {
      frame: "A calm border of fine lines and soft leaf vines, small points of warm light in the corners.",
      scene: "Soft rays of morning light over a calm horizon, a single small flame glowing in the foreground, gentle flowing lines like a quiet breath.",
      background: "soft rays of light, one small warm flame and gentle flowing lines",
      avoid: "any figures; anything showy",
    },
    promptByTradition: {
      christian: {
        frame: "A calm border of fine lines with small olive branches and points of candle light in the corners.",
        scene: "Tall arched stained-glass windows in jewel colours glowing with morning light over rows of lit candles, a quiet peaceful hall.",
      },
      muslim: {
        frame: "Fine interlaced geometric borders with small eight-pointed stars in the corners.",
        scene: "A mosque with a gentle dome and slender minarets at dawn, soft light over a courtyard with a quiet fountain and geometric tiles.",
      },
      jewish: {
        frame: "Fine blue and silver borders with small olive branches and six-pointed stars in the corners.",
        scene: "Two lit candlesticks and a braided loaf on a white cloth by a window at dusk, warm quiet light.",
      },
      hindu: {
        frame: "Marigold garlands and small brass bells along the edges, gold paisley corners.",
        scene: "Brass oil lamps glowing in a row with marigold and jasmine garlands, temple bells and soft incense smoke curling upward, warm saffron light.",
      },
      jain: {
        frame: "Thin gold lines, small lotus buds in the corners and gentle leaf vines.",
        scene: "Carved white marble temple spires at sunrise behind a row of small glowing lamps and lotus flowers. Architecture only.",
      },
      sikh: {
        frame: "Fine gold borders with small lotus and floral motifs in the corners.",
        scene: "A white-domed temple reflected in a calm pool at dawn, soft gold light on the water.",
      },
      buddhist: {
        frame: "Fine borders with lotus flowers and small lanterns in the corners.",
        scene: "A calm lotus pond at dawn with soft paper lanterns floating, distant misty hills.",
      },
    },
  },
  {
    key: "gala",
    label: "Gala / fundraiser dinner",
    pack: "gala",
    group: "community",
    priority: 1,
    keywords: ["gala", "banquet", "fundraiser", "fundraising dinner", "fundraiser dinner", "benefit dinner", "awards dinner", "awards night", "charity ball", "black tie", "dinner dance"],
    colours: "brand",
    prompt: {
      frame: "Art deco ornaments: fine gold lines, fan and sunburst motifs in the corners, an elegant double rule.",
      scene: "An elegant banquet hall: crystal chandeliers, round tables with white linen and candle centrepieces, soft gold bokeh and deep velvet drapes.",
      background: "art deco fans, fine gold lines and soft gold bokeh",
      avoid: "bottles and glasses of drink",
    },
  },
  {
    key: "workshop",
    label: "Workshop / class",
    pack: "workshop",
    group: "community",
    priority: 1,
    keywords: ["workshop", "seminar", "training", "class", "classes", "course", "webinar", "masterclass", "lunch and learn", "clinic", "lecture", "conference", "summit", "symposium", "bootcamp", "taller", "atelier"],
    colours: "brand",
    prompt: {
      frame: "Clean modern corners with thin lines and small simple icons of light bulbs, pencils and gears.",
      scene: "A tidy desk along the bottom: open notebooks, pencils, a laptop, a coffee cup and a potted plant, with soft light-bulb and gear shapes floating above.",
      background: "light bulbs, gears and pencils as soft simple outlines",
      avoid: "screens showing anything legible",
    },
  },
  {
    key: "volunteer_day",
    label: "Volunteer day",
    pack: "volunteer_day",
    group: "community",
    priority: 1,
    keywords: ["volunteer", "volunteers", "volunteering", "volunteer day", "day of service", "service day", "community service", "cleanup", "clean up", "food drive", "seva", "seva day", "sewa", "voluntariado"],
    colours: "brand",
    prompt: {
      frame: "Leafy vines, small hearts and sprouting seedlings in the corners.",
      scene: "A sunny community park: young trees, planters of seedlings, gardening tools and a watering can, boxes of donated food and clothes, small hearts and leaves in the air.",
      background: "leafy vines, small hearts and sprouting seedlings",
      avoid: "any figures",
    },
  },
  {
    key: "picnic",
    label: "Picnic / outing",
    pack: "picnic",
    group: "community",
    priority: 1,
    keywords: ["picnic", "bbq", "barbecue", "barbeque", "cookout", "potluck", "outing", "field day", "fun day", "park day", "family day", "pikinik"],
    colours: "brand",
    prompt: {
      frame: "Cheerful gingham-check corners with little bunting flags and daisies.",
      scene: "A green park on a sunny day: a gingham blanket with a wicker basket, fruit and lemonade under shady trees, bunting strung between the trees and a few balloons.",
      background: "gingham checks, bunting flags and daisies",
      avoid: "meat on a grill",
    },
  },
  {
    key: "annual_meeting",
    label: "Annual meeting",
    pack: "annual_meeting",
    group: "community",
    priority: 2,
    keywords: ["annual meeting", "annual general meeting", "agm", "general meeting", "general body meeting", "members meeting", "membership meeting", "town hall", "board election", "elections", "annual report"],
    colours: "brand",
    prompt: {
      frame: "A formal thin double rule border with small laurel sprigs in the corners.",
      scene: "A bright modern meeting hall with tall windows, rows of empty chairs facing a simple lectern, a soft rising-line motif across the sky.",
      background: "laurel sprigs, fine rules and a soft rising line",
      avoid: "charts with legible figures",
    },
  },
  {
    key: "thanksgiving",
    label: "Thanksgiving / harvest",
    season: { from: "10-01", to: "11-30", note: "falls in October or November" },
    pack: "thanksgiving",
    group: "community",
    priority: 2,
    keywords: ["thanksgiving", "harvest", "harvest festival", "harvest supper", "friendsgiving", "gratitude dinner", "action de grace", "erntedank"],
    colours: "brand",
    prompt: {
      frame: "Autumn harvest ornaments: oak and maple leaves in amber, russet and gold, small acorns and wheat sprigs in the corners.",
      scene: "A harvest still life along the ground: pumpkins, gourds, wheat sheaves, apples and a wicker basket among fallen autumn leaves, warm amber evening light.",
      background: "falling autumn leaves, wheat sprigs and warm amber light",
      avoid: "roast meat",
    },
  },
  {
    key: "new_year",
    label: "New Year",
    season: { from: "12-26", to: "01-15", note: "falls on 1 January" },
    pack: "new_year",
    group: "community",
    priority: 2,
    keywords: ["new year", "new years", "new year s", "new year eve", "nye", "ano nuevo", "nouvel an", "reveillon", "silvester", "hogmanay"],
    colours: "brand",
    prompt: {
      frame: "Celebration ornaments: streamers, small golden sparkles and confetti dots along the edges, starbursts in the corners.",
      scene: "Gentle fireworks bursts and golden sparkles over a calm night skyline, a midnight blue sky glittering with stars.",
      background: "golden sparkles, starbursts and soft confetti on a deep night blue",
      avoid: "clocks or dials, glasses of drink",
    },
  },
  {
    key: "mixer",
    label: "Mixer / networking",
    appliesTo: { kinds: ["chamber_of_commerce"], faith: false },
    pack: "mixer",
    group: "business",
    priority: 2,
    keywords: ["mixer", "networking", "business after hours", "after hours", "meet and greet", "happy hour", "social hour", "coffee connect", "breakfast connect", "speed networking"],
    colours: "brand",
    prompt: {
      frame: "Modern geometric corners of thin lines and dots with subtle confetti.",
      scene: "An evening rooftop terrace with string lights, small round high tables and potted plants, a city skyline at dusk behind, warm bokeh lights.",
      background: "warm bokeh lights, thin geometric lines and subtle confetti",
      avoid: "bottles and glasses of drink",
    },
  },
  {
    key: "ribbon_cutting",
    label: "Ribbon cutting / grand opening",
    appliesTo: { kinds: ["chamber_of_commerce"] },
    pack: "ribbon_cutting",
    group: "business",
    priority: 3,
    keywords: ["ribbon cutting", "ribbon", "grand opening", "soft opening", "opening ceremony", "groundbreaking", "ground breaking", "new location", "now open"],
    colours: "brand",
    prompt: {
      frame: "Bold satin ribbon swoops across the corners with confetti dots.",
      scene: "A wide satin ribbon tied in a big bow stretched across a shop entrance with a pair of large golden scissors, confetti and small balloons in the air.",
      background: "satin ribbon swoops, confetti and soft light",
      avoid: "shop signs",
    },
  },
  {
    key: "general",
    label: "General",
    pack: "general",
    group: "any",
    priority: 0,
    keywords: [],
    colours: "brand",
    prompt: {
      frame: "A refined double border in gold with small geometric rosettes in the corners and fine filigree, on a warm cream background.",
      scene: "A gentle landscape of soft rolling hills under a large soft sun, calm and welcoming, cream sky above.",
      background: NEUTRAL_BACKGROUND,
      avoid: "anything tied to one faith",
    },
    promptByTradition: {
      jain: {
        frame: "A refined double border in gold with small mandala rosettes in the corners and fine filigree, on a warm cream background.",
        scene: "A gentle landscape of soft rolling hills and a large faint mandala rising like a sun, warm gold and deep blue, cream sky above.",
        background: MANDALA_BACKGROUND,
        avoid: "",
      },
      hindu: {
        frame: "A refined double border in gold with small mandala rosettes in the corners and fine filigree, on a warm cream background.",
        scene: "A gentle landscape of soft rolling hills and a large faint mandala rising like a sun, warm gold and deep blue, cream sky above.",
        background: MANDALA_BACKGROUND,
        avoid: "",
      },
    },
  },
  {
    key: "other",
    label: "Other occasion",
    pack: "general",
    group: "any",
    priority: 0,
    keywords: [],
    colours: "brand",
    prompt: {
      frame: "A refined border of fine lines and small ornaments in the corners that suit the occasion described.",
      scene: "A gentle illustrated scene that suits the occasion described, calm and welcoming.",
      background: NEUTRAL_BACKGROUND,
      avoid: "anything tied to one faith unless the occasion described is that faith's",
    },
  },
] as const satisfies readonly OccasionSpec[];

export type FlyerOccasion = (typeof OCCASION_CATALOG)[number]["key"];
export const FLYER_OCCASIONS: readonly FlyerOccasion[] = OCCASION_CATALOG.map((o) => o.key);

/** The eight occasions of Flyers v2 (0585), unchanged: the database stores AI art for these. */
export const LEGACY_OCCASIONS = ["garba", "paryushan", "diwali", "mahavir", "convention", "pathshala", "bhakti", "general"] as const satisfies readonly FlyerOccasion[];

const BY_KEY: ReadonlyMap<string, OccasionSpec> = new Map(OCCASION_CATALOG.map((o) => [o.key, o as OccasionSpec]));

export function isFlyerOccasion(v: unknown): v is FlyerOccasion {
  return typeof v === "string" && BY_KEY.has(v);
}

/** The catalog entry of an occasion. */
export function occasionSpec(key: FlyerOccasion): OccasionSpec {
  return BY_KEY.get(key)!;
}

/** The occasion's label in its plain form (the catalog's), for places that know no community. */
export const FLYER_OCCASION_LABEL: Readonly<Record<FlyerOccasion, string>> = Object.fromEntries(OCCASION_CATALOG.map((o) => [o.key, o.label])) as Record<FlyerOccasion, string>;

/** The occasions a member of a tradition should review before release (they are tied to that tradition in the data). */
export function occasionsToReview(): { occasion: FlyerOccasion; tradition: FlyerTradition }[] {
  return OCCASION_CATALOG.flatMap((o) => ("review" in o && o.review ? [{ occasion: o.key, tradition: o.review }] : []));
}

// ── Who is offered what ──────────────────────────────────────────────────────

/** What the occasion rules read of an organization kind (KindProfile has all of it). */
export type OccasionKind = { key: string; label?: string; faithBased?: boolean; terms?: Readonly<Record<string, string | null>> };

/**
 * The tradition the occasions follow: `explicit` when it names one (an experience family key, or a centers.tradition
 * value), else the kind's own (FLYER_KIND_TRADITION), else none.
 */
export function flyerTraditionFor(kind: OccasionKind, explicit?: string | null): FlyerTradition | null {
  const e = (explicit ?? "").trim().toLowerCase();
  if (isFlyerTradition(e)) return e;
  if (e && FLYER_CENTER_TRADITION[e]) return FLYER_CENTER_TRADITION[e]!;
  return FLYER_KIND_TRADITION[kind.key] ?? null;
}

function termOf(kind: OccasionKind, term: string): string | null {
  const v = kind.terms?.[term];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Whether a community of this kind and tradition is offered the occasion. */
export function occasionAppliesTo(spec: OccasionSpec, kind: OccasionKind, tradition: FlyerTradition | null): boolean {
  const a = spec.appliesTo;
  if (!a) return true;
  if (a.kinds?.includes(kind.key)) return true;
  if (tradition && a.traditions?.includes(tradition)) return true;
  if (a.faith !== undefined && Boolean(kind.faithBased) === a.faith) return true;
  if (a.term && termOf(kind, a.term)) return true;
  return false;
}

/** 0: the community's own tradition or kind; 1: the kind of community (faith-based or not); 2: every community; 3: General; 4: Other. */
function rankFor(spec: OccasionSpec, kind: OccasionKind, tradition: FlyerTradition | null): number {
  if (spec.key === "other") return 4;
  if (spec.key === "general") return 3;
  const a = spec.appliesTo;
  if (!a) return 2;
  if ((tradition && a.traditions?.includes(tradition)) || a.kinds?.includes(kind.key) || (a.term && termOf(kind, a.term))) return 0;
  // Worship and the other faith-based occasions come before the ones for everyone; "not faith-based" ones sit with those.
  return a.faith === true ? 1 : 2;
}

/** The occasion's label for this community: its kind's own term, then its tradition's words, then the catalog's. */
export function occasionLabel(key: FlyerOccasion, kind?: OccasionKind | null, tradition?: FlyerTradition | null): string {
  const spec = occasionSpec(key);
  if (kind && spec.termLabel) {
    const t = termOf(kind, spec.termLabel.term);
    if (t) return spec.termLabel.label.replace("{term}", t);
  }
  if (tradition && spec.labelByTradition?.[tradition]) return spec.labelByTradition[tradition]!;
  return spec.label;
}

/**
 * The occasions a community is offered, in the order it sees them: its own tradition's and kind's first, then the
 * faith-based (or civic) ones, then those for every community, then General, then "Other occasion" (always there).
 * `current`: an occasion a saved poster already has stays in the list even when the community would not see it.
 */
export function occasionsFor(kind: OccasionKind, tradition?: string | null, current?: FlyerOccasion | null): FlyerOccasion[] {
  const t = flyerTraditionFor(kind, tradition);
  return OCCASION_CATALOG.map((o, i) => ({ spec: o as OccasionSpec, i }))
    .filter(({ spec }) => occasionAppliesTo(spec, kind, t) || spec.key === current)
    .sort((a, b) => rankFor(a.spec, kind, t) - rankFor(b.spec, kind, t) || a.i - b.i)
    .map(({ spec }) => spec.key as FlyerOccasion);
}

/** The occasion a poster starts from when nothing points to another (FLYER_KIND_DEFAULT; General otherwise). */
export function defaultOccasionFor(kind: OccasionKind, tradition?: string | null): FlyerOccasion {
  const d = FLYER_KIND_DEFAULT[kind.key];
  if (d && isFlyerOccasion(d) && occasionsFor(kind, tradition).includes(d)) return d;
  return "general";
}

// ── Grouped for the picker ───────────────────────────────────────────────────

export type OccasionChoice = { key: FlyerOccasion; label: string; group: OccasionGroup };

/** The occasions as the picker lists them: label for this community and the group heading each sits under. */
export function occasionChoices(kind: OccasionKind, tradition?: string | null, current?: FlyerOccasion | null): OccasionChoice[] {
  const t = flyerTraditionFor(kind, tradition);
  return occasionsFor(kind, tradition, current).map((key) => ({ key, label: occasionLabel(key, kind, t), group: occasionSpec(key).group }));
}

// ── Suggesting an occasion from the event ────────────────────────────────────

export type OccasionSuggestion = {
  occasion: FlyerOccasion;
  /** One plain sentence: why this occasion. */
  reason: string;
  /** What it rests on: the title's words, the description's, the date (the season or the community's calendar), or the kind's default. */
  basis: "title" | "description" | "calendar" | "season" | "default";
  score: number;
};

/** Lower case, Latin accents removed (Noël → noel), punctuation as spaces; other scripts kept as they are. */
export function normalizeForMatch(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim()} `;
}

const ASCII = /^[a-z0-9 ]+$/;

/** The longest keyword of `spec` found in the normalized text, or null. Latin words match whole (with a plural -s/-es); other scripts match inside a word. */
function matchKeyword(spec: OccasionSpec, normalized: string): string | null {
  let best: string | null = null;
  for (const raw of spec.keywords) {
    const kw = normalizeForMatch(raw).trim();
    if (!kw) continue;
    const hit = ASCII.test(kw) ? [` ${kw} `, ` ${kw}s `, ` ${kw}es `].some((w) => normalized.includes(w)) : normalized.includes(kw);
    if (hit && (!best || kw.length > best.length)) best = kw;
  }
  return best;
}

/** The month and day of an instant in a time zone (UTC when the zone is unknown), as "MM-DD". */
function monthDay(iso: string, tz?: string | null): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return m && day ? `${m}-${day}` : null;
  } catch {
    return iso.slice(5, 10);
  }
}

export function inSeason(md: string, s: OccasionSeason): boolean {
  return s.from <= s.to ? md >= s.from && md <= s.to : md >= s.from || md <= s.to;
}

export type SuggestInput = {
  title: string;
  description?: string | null;
  startsAt?: string | null;
  tz?: string | null;
  /** null: every occasion is considered (a caller that knows no community). */
  kind: OccasionKind | null;
  tradition?: string | null;
  /** Dates on the community's own calendar near the event's (a festival layer's entries): their titles point to occasions too. */
  calendar?: readonly { title: string }[];
};

/**
 * The occasions that suit an event, best first, each with its reason: words in the title (in any of the languages the
 * catalog knows), then in the description, then the community's calendar on that date, then the season. Only occasions
 * the community is offered. The kind's default closes the list when nothing else named it.
 */
export function suggestOccasion(input: SuggestInput): OccasionSuggestion[] {
  const t = input.kind ? flyerTraditionFor(input.kind, input.tradition) : null;
  const offered = (input.kind ? occasionsFor(input.kind, input.tradition) : [...FLYER_OCCASIONS]).filter((o) => o !== "other" && o !== "general");
  const title = normalizeForMatch(input.title ?? "");
  const desc = normalizeForMatch(input.description ?? "");
  const cal = (input.calendar ?? []).map((c) => ({ raw: c.title, n: normalizeForMatch(c.title) }));
  const md = input.startsAt ? monthDay(input.startsAt, input.tz) : null;
  const out: OccasionSuggestion[] = [];
  offered.forEach((key, order) => {
    const spec = occasionSpec(key);
    const label = occasionLabel(key, input.kind, t);
    const tie = (offered.length - order) / 1000;
    const inTitle = matchKeyword(spec, title);
    if (inTitle) {
      out.push({ occasion: key, basis: "title", reason: `The event's name mentions "${inTitle}".`, score: 100 + spec.priority * 5 + inTitle.length * 0.1 + tie });
      return;
    }
    const inDesc = matchKeyword(spec, desc);
    if (inDesc) {
      out.push({ occasion: key, basis: "description", reason: `The event's description mentions "${inDesc}".`, score: 60 + spec.priority * 5 + inDesc.length * 0.1 + tie });
      return;
    }
    const onCalendar = cal.find((c) => matchKeyword(spec, c.n));
    if (onCalendar) {
      out.push({ occasion: key, basis: "calendar", reason: `Your calendar has "${onCalendar.raw.trim().slice(0, 60)}" on this date.`, score: 40 + spec.priority + tie });
      return;
    }
    if (md && spec.season && inSeason(md, spec.season)) {
      out.push({ occasion: key, basis: "season", reason: `${label} ${spec.season.note}, like this event.`, score: 20 + spec.priority + tie });
    }
  });
  out.sort((a, b) => b.score - a.score);
  const fallback = input.kind ? defaultOccasionFor(input.kind, input.tradition) : "general";
  if (!out.some((s) => s.occasion === fallback)) {
    out.push({ occasion: fallback, basis: "default", reason: fallback === "general" ? "Fits any event, in your brand colours." : "The usual choice for organizations like yours.", score: 0 });
  }
  return out;
}

/**
 * The occasion to start a new poster from: the best suggestion that rests on the event's own words; otherwise the kind's
 * default. The date alone only suggests (it is shown with its reason): it never changes what is chosen.
 */
export function preselectOccasion(suggestions: readonly OccasionSuggestion[], fallback: FlyerOccasion = "general"): FlyerOccasion {
  const firm = suggestions.find((s) => s.basis === "title" || s.basis === "description");
  if (firm) return firm.occasion;
  return suggestions.find((s) => s.basis === "default")?.occasion ?? fallback;
}

// ── The season words for a prompt ────────────────────────────────────────────

export type SeasonWord = "winter" | "spring" | "summer" | "autumn";

/** Countries (ISO 3166-1 alpha-2) in the southern hemisphere's temperate zone: the seasons are the other way round. */
const SOUTHERN = new Set(["AU", "NZ", "ZA", "AR", "CL", "UY", "LS", "SZ"]);
/** Countries mostly in the tropics: no four seasons, so the prompt says nothing about one. */
const TROPICAL = new Set(["IN", "LK", "BD", "SG", "MY", "ID", "TH", "PH", "VN", "KH", "MM", "KE", "UG", "TZ", "NG", "GH", "CI", "SN", "ET", "BR", "CO", "VE", "PE", "EC", "PA", "CR", "JM", "TT", "BS", "PR", "DO", "CU", "FJ", "AE", "QA", "BH", "OM"]);

/** The season of a date in a country (northern by default), or null in the tropics or when the date is unknown. */
export function seasonOf(startsAt: string | null | undefined, country?: string | null, tz?: string | null): SeasonWord | null {
  if (!startsAt) return null;
  const c = (country ?? "").trim().toUpperCase();
  if (TROPICAL.has(c)) return null;
  const md = monthDay(startsAt, tz);
  if (!md) return null;
  const m = Number(md.slice(0, 2));
  const north: SeasonWord = m === 12 || m <= 2 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "autumn";
  if (!SOUTHERN.has(c)) return north;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as const)[north];
}
