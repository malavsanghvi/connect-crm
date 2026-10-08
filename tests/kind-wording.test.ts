import { describe, expect, it } from "vitest";

import { ACCESS_FEATURES, accessFeaturesForKind, type AccessFeatureRow } from "@/lib/access";
import { LAYER_KINDS, layerKindsFor, layerSource, layerVisibleFor } from "@/lib/calendar";
import { buildDashboard, dashboardTitles, kpiOfferedFor, periods, publicKpiLabelFor } from "@/lib/community-dashboard";
import { mediaCopyFor } from "@/lib/content";
import { ENTITLEMENT_GROUPS, entitlementGroupsFor } from "@/lib/entitlements";
import { flyerOccasionsFor, FLYER_OCCASIONS } from "@/lib/events/flyer-art";
import { campaignKindsFor } from "@/lib/giving";
import { HOME_SHORTCUTS, homeShortcutOpens, homeShortcutsMissingFor } from "@/lib/home-shortcuts";
import { ENTITIES, entityOfferedTo } from "@/lib/import/registry";
import { LEGACY_KIND, kindSchool, parseKindProfile, type KindProfile } from "@/lib/kind";
import { LEADER_BODIES, ENTITY_TYPES, entityTypesFor, leaderBodiesFor } from "@/lib/setup";
import { NOTIFICATION_TRIGGERS, notificationTriggersFor } from "@/lib/settings-rules";
import { NEUTRAL_WORDS, TRADITION_WORDS, nivaGuardrail, nivaReferralSentence, nivaSourcesHint, word, wordsFor } from "@/lib/wording";

// A kind with everything but a tradition pack and no Jain-only modules: what a chamber of commerce is (0594 seed).
const kind = (over: { key: string; label: string; faith: boolean; tradition: boolean; terms?: Record<string, string | null>; modules?: Record<string, { availability: string; label: string | null }> }): KindProfile =>
  parseKindProfile({ category: { key: over.key, label: over.label, faith_based: over.faith, uses_tradition: over.tradition, terms: over.terms ?? {} }, modules: over.modules ?? {} })!;

const chamber = kind({
  key: "chamber_of_commerce",
  label: "Chamber of commerce",
  faith: false,
  tradition: false,
  terms: { greeting: "Welcome", store: "Store", school: null, learning: null, place: "office", assistant_context: "a chamber of commerce" },
  modules: {
    bolis: { availability: "not_available", label: null },
    pathshala: { availability: "not_available", label: null },
    gyan_path: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    store: { availability: "default_off", label: "Store" },
  },
});
// A church-like kind: a faith community with a religious school and a learning path, but no Jain tradition pack.
const church = kind({
  key: "faith_other",
  label: "Faith-based non-profit (other faiths)",
  faith: true,
  tradition: false,
  terms: { greeting: "Welcome", store: "Store", school: "Religious school", learning: "Learning path", place: "place of worship", assistant_context: "a faith community" },
  modules: {
    bolis: { availability: "not_available", label: null },
    jain_way: { availability: "not_available", label: null },
    pathshala: { availability: "default_off", label: "Religious school" },
    gyan_path: { availability: "default_off", label: "Learning path" },
  },
});
const jainFromDb = kind({ key: "jain_center", label: "Jain Center", faith: true, tradition: true, terms: LEGACY_KIND.terms });

/** Every word of Jain or temple origin the audit found on screens every kind can reach. */
const JAIN = /jain|tithi|panchang|derasar|darshan|navkar|chauvihar|samayik|pratikraman|satvik|paryushan|mahavir|puja|pujan|aarti|pachchakhan|stavan|labh|boli|pravachan|pathshala|gyan|saathi|anumodana|bhandar|garba|diwali|bhakti|sutra|parva|seva|jai jinendra/i;

describe("wording: a Jain Center says what it always said, any other kind says something neutral", () => {
  it("a kind with a tradition pack reads the tradition words, with or without the database's answer", () => {
    expect(wordsFor(LEGACY_KIND)).toEqual(TRADITION_WORDS);
    expect(wordsFor(jainFromDb)).toEqual(TRADITION_WORDS);
    expect(word(LEGACY_KIND, "today_tab")).toBe("Today & darshan");
  });
  it("every other kind reads the neutral words, none of them Jain", () => {
    expect(wordsFor(chamber)).toEqual(NEUTRAL_WORDS);
    expect(wordsFor(church)).toEqual(NEUTRAL_WORDS);
    for (const [k, w] of Object.entries(NEUTRAL_WORDS)) expect(w, k).not.toMatch(JAIN);
  });
  it("a kind's own term beats both, with no code change", () => {
    const own = kind({ key: "temple_x", label: "Temple X", faith: true, tradition: false, terms: { live_stream: "Live darshan", cash_box: "hundi" } });
    expect(word(own, "live_stream")).toBe("Live darshan");
    expect(word(own, "cash_box")).toBe("hundi");
    expect(word(own, "today_tab")).toBe("Live stream");
  });
});

describe("Calendar", () => {
  it("a Jain Center keeps every kind of layer and its words", () => {
    expect(layerKindsFor(LEGACY_KIND)).toEqual(LAYER_KINDS);
    expect(layerKindsFor(jainFromDb)).toEqual(LAYER_KINDS);
    expect(layerVisibleFor(LEGACY_KIND, "tithi")).toBe(true);
    const festival = { center_id: null, kind: "festival", source_url: null, default_on: true, owner_label: null };
    expect(layerSource(festival, null)).toBe("Parva and festival dates");
    expect(layerSource(festival, null, jainFromDb)).toBe("Parva and festival dates");
  });
  it("another kind has no tithi or Pathshala layer, and names the festival layer plainly", () => {
    const kinds = layerKindsFor(chamber).map((k) => k.kind);
    expect(kinds).not.toContain("tithi");
    expect(kinds).not.toContain("pathshala");
    expect(layerKindsFor(chamber).map((k) => k.label).join(" ")).not.toMatch(JAIN);
    expect(layerKindsFor(church).map((k) => k.kind)).toContain("pathshala");
    expect(layerVisibleFor(chamber, "events")).toBe(true);
  });
});

describe("Settings › Access levels", () => {
  const rows: AccessFeatureRow[] = ACCESS_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    defaultLevel: f.defaultLevel,
    floorLevel: f.floorLevel,
    levelKey: f.defaultLevel,
    enforcedBy: f.enforcedBy,
    moduleKey: f.moduleKey,
    moduleOn: true,
  }));
  it("a Jain Center gets every area exactly as the database sent it", () => {
    expect(accessFeaturesForKind(rows, LEGACY_KIND)).toEqual(rows);
    expect(accessFeaturesForKind(rows, jainFromDb)).toEqual(rows);
  });
  it("a chamber has no virtual puja, daily timings or Gyan Path area, and its live stream is not 'darshan'", () => {
    const out = accessFeaturesForKind(rows, chamber);
    expect(out.map((f) => f.key)).toEqual(["darshan", "guide", "listen", "look", "niva"]);
    const text = out.map((f) => `${f.label} ${f.description}`).join("\n");
    expect(text).not.toMatch(/darshan|derasar|puja|navkarsi|chauvihar|aarti|stavan|gyan/i);
    expect(out.find((f) => f.key === "darshan")?.label).toBe("Live stream");
  });
  it("another faith keeps the learning area under its own name", () => {
    const learn = accessFeaturesForKind(rows, church).find((f) => f.key === "learn");
    expect(learn?.label).toBe("Learning path lessons and progress");
  });
});

describe("Settings › Member app · Home shortcuts", () => {
  it("a Jain Center has all six", () => {
    expect(homeShortcutsMissingFor(LEGACY_KIND)).toEqual([]);
    for (const s of HOME_SHORTCUTS) expect(homeShortcutOpens(s.key, LEGACY_KIND)).toBe(s.opens);
  });
  it("a chamber has no Learn or Jain recipe, and another faith has Learn but no Jain recipe", () => {
    expect(homeShortcutsMissingFor(chamber)).toEqual(["learn", "recipe"]);
    expect(homeShortcutsMissingFor(church)).toEqual(["recipe"]);
    expect(homeShortcutOpens("playlist", chamber)).not.toMatch(/stavan/i);
    expect(homeShortcutOpens("learn", church)).toContain("Learning path lesson");
  });
});

describe("Settings › Roles", () => {
  it("a Jain Center sees the catalogue as is", () => {
    expect(entitlementGroupsFor(LEGACY_KIND)).toEqual(ENTITLEMENT_GROUPS);
  });
  it("a chamber has no Bolis or Pathshala group; another faith names its school", () => {
    const names = entitlementGroupsFor(chamber).map((g) => g.name);
    expect(names).not.toContain("Bolis");
    expect(names).not.toContain("Pathshala");
    expect(entitlementGroupsFor(church).map((g) => g.name)).toContain("Religious school");
    expect(entitlementGroupsFor(church).find((g) => g.name === "Religious school")?.items[0].label).toBe("View Religious school");
  });
});

describe("Setup", () => {
  it("a Jain Center's entity types and leader groups are unchanged", () => {
    expect(entityTypesFor(LEGACY_KIND)).toEqual(ENTITY_TYPES);
    expect(leaderBodiesFor(LEGACY_KIND)).toEqual(LEADER_BODIES);
  });
  it("another kind says 'house of worship' without a derasar and has no Pathshala committee", () => {
    expect(entityTypesFor(chamber).find((e) => e.value === "house_of_worship")?.label).not.toMatch(/derasar/i);
    expect(leaderBodiesFor(chamber).map((b) => b.value)).not.toContain("pathshala");
    expect(leaderBodiesFor(church).find((b) => b.value === "pathshala")?.label).toBe("Religious school");
  });
});

describe("Notifications", () => {
  it("a Jain Center lists every trigger", () => {
    const { shown, hidden } = notificationTriggersFor(LEGACY_KIND);
    expect(shown).toEqual(NOTIFICATION_TRIGGERS);
    expect(hidden).toEqual([]);
  });
  it("a chamber is not offered labh, Saathi, boli, pachchakhan or homework notices", () => {
    const { shown, hidden } = notificationTriggersFor(chamber);
    expect(shown.map((t) => t.label).join(" ")).not.toMatch(/labh|saathi|boli|pachchakhan|homework/i);
    expect(hidden.map((t) => t.key)).toEqual(expect.arrayContaining(["special_day_labh", "saathi_support", "boli_outbid", "pachchakhan_reminder", "homework_reminder"]));
    expect(shown.map((t) => t.key)).toEqual(expect.arrayContaining(["rsvp_confirmation", "lunch_reminder", "pledge_reminder", "event_feedback"]));
  });
});

describe("Data import", () => {
  it("a Jain Center is offered every dataset", () => {
    expect(ENTITIES.every((e) => entityOfferedTo(LEGACY_KIND, e))).toBe(true);
  });
  it("a chamber is offered no Pathshala, Bolis, practice or Labh dataset", () => {
    const offered = ENTITIES.filter((e) => entityOfferedTo(chamber, e));
    expect(offered.some((e) => e.module === "pathshala" || e.module === "bolis" || e.module === "jain_way" || e.module === "gyan_path")).toBe(false);
    expect(offered.some((e) => e.key === "labh_options")).toBe(false);
    expect(offered.length).toBeGreaterThan(10);
  });
});

describe("Giving", () => {
  it("campaign kinds follow the kind's modules", () => {
    expect(campaignKindsFor(LEGACY_KIND)).toEqual(["general", "boli", "sponsorship", "construction", "pathshala", "event", "membership", "store", "other"]);
    // The chamber has no bolis and no school; its store starts off but is one it can switch on.
    expect(campaignKindsFor(chamber)).toEqual(["general", "sponsorship", "construction", "event", "membership", "store", "other"]);
    expect(campaignKindsFor(church)).toContain("pathshala");
    expect(campaignKindsFor(church)).not.toContain("boli");
  });
});

describe("Flyers", () => {
  it("a Jain Center is offered every occasion; another kind the general and convention packs (and the poster's own)", () => {
    expect(flyerOccasionsFor(LEGACY_KIND)).toEqual(FLYER_OCCASIONS);
    expect(flyerOccasionsFor(chamber)).toEqual(["convention", "general"]);
    expect(flyerOccasionsFor(chamber, "diwali")).toEqual(["diwali", "convention", "general"]);
  });
});

describe("Content", () => {
  it("the media library reads as before for a kind with a tradition pack, and says songs and recipes plainly otherwise", () => {
    const pack = mediaCopyFor(true);
    expect(pack.stavan.title).toBe("Stavans");
    expect(pack.recipe).toContain("Jain recipes");
    const neutral = mediaCopyFor(false);
    expect(Object.values({ ...neutral.stavan, sub: neutral.sub, video: neutral.video, recipe: neutral.recipe }).join(" ")).not.toMatch(/jain|stavan|pravachan|darshan/i);
  });
});

describe("Niva's notes in Content › Niva", () => {
  it("a Jain Center reads as before", () => {
    const k = { ...LEGACY_KIND };
    expect(nivaGuardrail(k)).toEqual(["Doctrinal questions", "Answer from approved content, then refer to Pathshala teachers"]);
    expect(nivaReferralSentence(k)).toBe("Doctrinal questions are always referred on to Pathshala teachers as well.");
    expect(nivaSourcesHint(k)).toBe("Add the calendar, guide, membership rules and Gyan Path content Niva may answer from.");
  });
  it("a chamber refers to the office and has no Gyan Path content; another faith refers to its school", () => {
    expect(nivaGuardrail(chamber)[1]).toBe("Answer from approved content, then refer to the office");
    expect(nivaReferralSentence(chamber)).toBe("Questions that need a decision are always referred on to the office as well.");
    expect(nivaSourcesHint(chamber)).toBe("Add the calendar, guide and membership rules Niva may answer from.");
    expect(nivaGuardrail(church)[1]).toBe("Answer from approved content, then refer to Religious school teachers");
    expect(nivaSourcesHint(church)).toContain("Learning path content");
    expect(kindSchool(chamber)).toBeNull();
  });
});

describe("The community dashboard", () => {
  const period = periods("2026-09-24")[0];
  const raw = {
    as_of: "2026-09-22T05:00:00Z",
    metrics: { member_families: 120, volunteer_hours: 300, attendance: 900, samayik: 400, pratikraman: 200, gyan_steps: 50, navkar_malas: 30, anumodana: 12, pathshala_students: 80, volunteer_teachers: 12, class_attendance_rate: 90, store_orders: 20 },
    deltas: {},
  };
  it("a Jain Center's dashboard is what it was, with or without the kind", () => {
    const before = buildDashboard(raw, period);
    const withKind = buildDashboard(raw, period, LEGACY_KIND);
    expect(withKind).toEqual(before);
    expect(before.titles).toEqual({
      practice: "Practicing together",
      practiceSub: "From My Jain Way and Gyan Path · totals only",
      learning: "Pathshala and learning",
      seva: "Seva and community care",
      attendanceSub: "Check-ins at all events and Pathshala",
    });
    expect(before.practice).toHaveLength(5); // gyan_levels is not in this sample
    expect(before.learning.map((r) => r.label)).toEqual(["Pathshala students", "Volunteer teachers", "Class attendance rate"]);
    expect(before.seva.map((r) => r.label)).toEqual(["Satvik Store orders"]);
  });
  it("a chamber's dashboard has no practice, Pathshala or Satvik words", () => {
    const v = buildDashboard(raw, period, chamber);
    expect(v.practice).toEqual([]);
    expect(v.learning).toEqual([]);
    expect(v.seva.map((r) => r.label)).toEqual(["Store orders"]);
    const text = [...v.summary.map((t) => t.label), ...v.seva.map((r) => r.label), ...Object.values(v.titles)].join(" ");
    expect(text).not.toMatch(JAIN);
    expect(v.summary.map((t) => t.label)).toContain("Volunteer hours");
  });
  it("another faith keeps its school and learning path, not My Jain Way", () => {
    const v = buildDashboard(raw, period, church);
    expect(v.practice.map((t) => t.key)).toEqual(["gyan_steps", "gyan_levels"].filter((k) => k in raw.metrics));
    expect(v.learning[0].label).toBe("Religious school students");
    expect(v.titles.learning).toBe("Religious school and learning");
  });
  it("which KPIs a kind may publish", () => {
    expect(kpiOfferedFor(LEGACY_KIND, "samayik")).toBe(true);
    expect(kpiOfferedFor(chamber, "samayik")).toBe(false);
    expect(kpiOfferedFor(chamber, "pathshala_students")).toBe(false);
    expect(kpiOfferedFor(chamber, "member_families")).toBe(true);
    expect(publicKpiLabelFor(chamber, "attendance")).toBe("Event visits");
    expect(publicKpiLabelFor(LEGACY_KIND, "attendance")).toBe("Event and class visits");
    expect(dashboardTitles(undefined).learning).toBe("Pathshala and learning");
  });
});
