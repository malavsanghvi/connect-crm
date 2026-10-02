import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCESS_FEATURES,
  ACCESS_FEATURE_KEYS,
  BASE_LEVELS,
  DEFAULT_MEMBERSHIP_LEVELS,
  LEVEL_KEY_PATTERN,
  MAX_MEMBERSHIP_LEVELS,
  MIN_MEMBERSHIP_RANK,
  accessFeatureDef,
  buildLevelsPayload,
  describeLevel,
  describeRule,
  editableLevels,
  enforcementNote,
  featureChanges,
  isAccessFeatureKey,
  levelRank,
  levelsAtOrAbove,
  levelsChangeCount,
  levelsProblem,
  moduleOffNote,
  moveLevel,
  newEditableLevel,
  parseAccessSettings,
  parseChangesField,
  parseLevelsField,
  removalBlockers,
  slugifyLevelKey,
  type AccessLevel,
  type EditableLevel,
} from "@/lib/access";
import { isModuleKey } from "@/lib/modules";
import { accessRpc, isPermissionError } from "@/lib/access-db";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0586_access_levels.sql"), "utf8").replace(/\r\n/g, "\n");

/** A SQL string literal's text ('' is an apostrophe). */
const sqlText = (v: string) => v.replace(/''/g, "'");

// One catalog row per line, each beginning with ('<key>', (the migration says so).
const catalogBlock = migration.slice(migration.indexOf("insert into app.access_features"), migration.indexOf("on conflict (key) do update"));
const sqlCatalog = catalogBlock
  .split("\n")
  .filter((l) => /^\('[a-z_]+', /.test(l))
  .map((l) => {
    const m = /^\('([a-z_]+)', '((?:[^']|'')*)', '((?:[^']|'')*)', '(public|community)', '(public|community)', (null|'[a-z_]+'), '(database|app)', (\d+)\),?$/.exec(l);
    if (!m) throw new Error(`cannot read the catalog line: ${l}`);
    return {
      key: m[1],
      label: sqlText(m[2]),
      description: sqlText(m[3]),
      defaultLevel: m[4],
      floorLevel: m[5],
      moduleKey: m[6] === "null" ? null : m[6].slice(1, -1),
      enforcedBy: m[7],
      sort: Number(m[8]),
    };
  });

// access_seed_center: the starting ladder, one level per line of its VALUES list.
const seedBlock = migration.slice(migration.indexOf("create or replace function app.access_seed_center"), migration.indexOf("create or replace function app.access_seed_new_center"));
const sqlLevels = [...seedBlock.matchAll(/\('([a-z_]+)',\s+'([^']+)',\s+(\d+),\s+'(public|community|membership)',\s+(null|'\{[a-z,]*\}')\)/g)].map((m) => ({
  key: m[1],
  label: m[2],
  rank: Number(m[3]),
  kind: m[4],
  tiers: m[5] === "null" ? [] : m[5].slice(2, -2).split(","),
}));

describe("the catalog mirrors migration 0586", () => {
  it("has the migration's eight areas, in the same order and shape", () => {
    expect(sqlCatalog).toHaveLength(8);
    expect([...ACCESS_FEATURE_KEYS]).toEqual(sqlCatalog.map((r) => r.key));
    for (const row of sqlCatalog) {
      const f = ACCESS_FEATURES.find((x) => x.key === row.key)!;
      expect({ label: f.label, description: f.description, defaultLevel: f.defaultLevel, floorLevel: f.floorLevel, moduleKey: f.moduleKey, enforcedBy: f.enforcedBy, sort: f.sort }).toEqual({
        label: row.label,
        description: row.description,
        defaultLevel: row.defaultLevel,
        floorLevel: row.floorLevel,
        moduleKey: row.moduleKey,
        enforcedBy: row.enforcedBy,
        sort: row.sort,
      });
    }
  });

  it("keeps the owner's choices: darshan and puja are public, the rest keep today's behaviour, only darshan is enforced by the database", () => {
    expect(ACCESS_FEATURES.filter((f) => f.defaultLevel === "public").map((f) => f.key)).toEqual(["darshan", "puja", "timings", "guide"]);
    expect(ACCESS_FEATURES.filter((f) => f.floorLevel === "community").map((f) => f.key)).toEqual(["listen", "look", "learn", "niva"]);
    expect(ACCESS_FEATURES.filter((f) => f.enforcedBy === "database").map((f) => f.key)).toEqual(["darshan"]);
    for (const f of ACCESS_FEATURES) {
      // never starts below its own floor
      expect(f.floorLevel === "community" ? f.defaultLevel === "community" : true).toBe(true);
      if (f.moduleKey) expect(isModuleKey(f.moduleKey)).toBe(true);
    }
  });

  it("knows its keys", () => {
    expect(isAccessFeatureKey("darshan")).toBe(true);
    expect(isAccessFeatureKey("giving")).toBe(false);
    expect(isAccessFeatureKey(undefined)).toBe(false);
    expect(accessFeatureDef("niva").label).toBe("Ask Niva");
  });

  it("has the starting ladder the migration seeds", () => {
    expect(sqlLevels.map((l) => [l.key, l.label, l.rank, l.kind])).toEqual([
      ...BASE_LEVELS.map((l) => [l.key, l.label, l.rank, l.key]),
      ...DEFAULT_MEMBERSHIP_LEVELS.map((l) => [l.key, l.label, l.rank, "membership"]),
    ]);
    for (const d of DEFAULT_MEMBERSHIP_LEVELS) expect(sqlLevels.find((l) => l.key === d.key)!.tiers).toEqual(d.tiers);
    for (const l of sqlLevels) expect(LEVEL_KEY_PATTERN.test(l.key)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reading access_settings
// ---------------------------------------------------------------------------
const rawSettings = {
  levels: [
    { key: "life", label: "Life member", rank: 30, kind: "membership", tiers: ["life"], membership_type_keys: [], locked: false },
    { key: "public", label: "Public", rank: 0, kind: "public", tiers: [], membership_type_keys: [], locked: true },
    { key: "community", label: "Community member", rank: 10, kind: "community", tiers: [], membership_type_keys: [], locked: true },
    { key: "member", label: "Member", rank: 20, kind: "membership", tiers: ["yearly", "life"], membership_type_keys: ["senior_yearly"], locked: false },
  ],
  features: [
    { key: "darshan", label: "Live darshan", description: "d", default_level: "public", floor_level: "public", level_key: "life", enforced_by: "database", module_key: "content", module_on: true },
    { key: "listen", label: "Stavans", description: "l", default_level: "community", floor_level: "community", level_key: "community", enforced_by: "app", module_key: "content", module_on: false },
  ],
  membership_types: [
    { key: "yearly", name: "Yearly membership", tier: "yearly", active: true },
    { key: "senior_yearly", name: "Senior yearly", tier: "yearly", active: false },
  ],
  membership_on: false,
};

const parsed = (() => {
  const r = parseAccessSettings(rawSettings);
  if (!r.ok) throw new Error(r.error);
  return r.value;
})();

describe("parseAccessSettings", () => {
  it("reads the levels in rank order, the areas and the types", () => {
    expect(parsed.levels.map((l) => l.key)).toEqual(["public", "community", "member", "life"]);
    expect(parsed.levels[2]).toMatchObject({ kind: "membership", tiers: ["yearly", "life"], membershipTypeKeys: ["senior_yearly"], locked: false });
    expect(parsed.levels[0].locked).toBe(true);
    expect(parsed.features[0]).toMatchObject({ key: "darshan", levelKey: "life", enforcedBy: "database", moduleKey: "content", moduleOn: true });
    expect(parsed.features[1].moduleOn).toBe(false);
    expect(parsed.membershipTypes[1]).toMatchObject({ key: "senior_yearly", active: false });
    expect(parsed.membershipOn).toBe(false);
  });

  it("is on unless the database says the Membership module is off, and ignores tiers it does not know", () => {
    const r = parseAccessSettings({ ...rawSettings, membership_on: undefined, levels: [{ ...rawSettings.levels[3], tiers: ["yearly", "platinum"] }] });
    expect(r.ok && r.value.membershipOn).toBe(true);
    expect(r.ok && r.value.levels[0].tiers).toEqual(["yearly"]);
  });

  it("refuses anything it cannot read, in plain English", () => {
    for (const bad of [null, "x", [], {}, { levels: [], features: "no" }, { levels: [1], features: [] }, { levels: [{ key: "x" }], features: [] }, { levels: [], features: [{ key: "x" }] }]) {
      const r = parseAccessSettings(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/shape this page does not know/);
    }
    const nan = parseAccessSettings({ ...rawSettings, levels: [{ ...rawSettings.levels[0], rank: "30" }] });
    expect(nan.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Who can use each area
// ---------------------------------------------------------------------------
describe("choosing a level for an area", () => {
  it("offers the levels at or above the area's floor, lowest first", () => {
    expect(levelsAtOrAbove(parsed.levels, "public").map((l) => l.key)).toEqual(["public", "community", "member", "life"]);
    expect(levelsAtOrAbove(parsed.levels, "community").map((l) => l.key)).toEqual(["community", "member", "life"]);
  });

  it("reads the rank of the base levels when the list does not carry them", () => {
    expect(levelRank([], "public")).toBe(0);
    expect(levelRank([], "community")).toBe(10);
    expect(levelRank([{ key: "member", rank: 25 }], "member")).toBe(25);
    expect(levelsAtOrAbove([{ key: "member", rank: 25 }, { key: "x", rank: 5 }], "community").map((l) => l.key)).toEqual(["member"]);
  });

  it("lists only the areas whose choice changed", () => {
    const saved = { darshan: "public", puja: "public", listen: "community" };
    expect(featureChanges(saved, { darshan: "life", puja: "public", listen: "community" })).toEqual([{ feature: "darshan", level: "life" }]);
    expect(featureChanges(saved, saved)).toEqual([]);
    expect(featureChanges(saved, { mystery: "life" })).toEqual([]);
  });

  it("says where each area applies, and why an area is closed when its module is off", () => {
    expect(enforcementNote({ enforcedBy: "database" })).toBe("Also enforced by the database");
    expect(enforcementNote({ enforcedBy: "app" })).toBe("Applies in the app");
    expect(moduleOffNote({ moduleOn: true, moduleKey: "content" }, "Content & library")).toBeNull();
    expect(moduleOffNote({ moduleOn: false, moduleKey: "content" }, "Content & library")).toBe(
      "Content & library is switched off (Settings › Modules), so nobody can use this area until it is switched back on.",
    );
  });

  it("names the areas that use a level, so it can be kept until they move", () => {
    const features = [
      { label: "Live darshan", levelKey: "life" },
      { label: "Virtual puja", levelKey: "public" },
      { label: "Ask Niva", levelKey: "life" },
    ];
    expect(removalBlockers("life", features)).toEqual(["Live darshan", "Ask Niva"]);
    expect(removalBlockers("member", features)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------
const types = [
  { key: "yearly", name: "Yearly membership" },
  { key: "senior_yearly", name: "Senior yearly" },
];
const level = (label: string, over: Partial<EditableLevel> = {}): EditableLevel => ({ key: "", label, tiers: ["life"], membershipTypeKeys: [], ...over });
const base = { public: "Public", community: "Community member" };

describe("editing the ladder", () => {
  it("edits only the membership levels, in rank order", () => {
    expect(editableLevels(parsed.levels).map((l) => l.key)).toEqual(["member", "life"]);
    expect(editableLevels(parsed.levels)[0]).toEqual({ key: "member", label: "Member", tiers: ["yearly", "life"], membershipTypeKeys: ["senior_yearly"] });
  });

  it("moves a level one place and leaves the list alone at the ends", () => {
    expect(moveLevel(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveLevel(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveLevel(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveLevel(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveLevel(["a"], 5, 1)).toEqual(["a"]);
  });

  it("makes a key from a name that the database accepts and never reuses one", () => {
    expect(slugifyLevelKey("Life member", [])).toBe("life_member");
    expect(slugifyLevelKey("Life member", ["life_member"])).toBe("life_member_b");
    expect(slugifyLevelKey("Life member", ["life_member", "life_member_b"])).toBe("life_member_c");
    expect(slugifyLevelKey("Public", [])).toBe("public_b");
    expect(slugifyLevelKey("community", [])).toBe("community_b");
    const taken = ["x_y", ...Array.from({ length: 30 }, (_, i) => `x_y_${i < 26 ? String.fromCharCode(98 + i) : "a" + String.fromCharCode(97 + i - 26)}`)];
    expect(slugifyLevelKey("x y", taken)).toMatch(LEVEL_KEY_PATTERN);
    expect(taken).not.toContain(slugifyLevelKey("x y", taken));
    expect(slugifyLevelKey("", [])).toBe("level");
    expect(slugifyLevelKey("!!!", [])).toBe("level");
    expect(slugifyLevelKey("ગુજરાતી", [])).toBe("level");
    expect(slugifyLevelKey("12 Patrons & Friends", [])).toBe("patrons_friends");
    expect(slugifyLevelKey("A", [])).toBe("level");
    const long = slugifyLevelKey("Friends of the temple building fund committee members", ["friends_of_the_temple_building"]);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(LEVEL_KEY_PATTERN.test(long)).toBe(true);
    for (const label of ["Life member", "Gold!", "x y", "ZZ top", "a_b_c_d_e_f_g_h_i_j_k_l_m_n_o_p_q_r_s_t_u_v_w_x_y_z"]) {
      expect(LEVEL_KEY_PATTERN.test(slugifyLevelKey(label, ["gold"]))).toBe(true);
    }
  });

  it("finds the first problem with the ladder as typed, in plain English", () => {
    expect(levelsProblem([level("Patron")], base)).toBeNull();
    expect(levelsProblem([], base)).toBeNull();
    expect(levelsProblem([], { public: " ", community: "Friends" })).toBe("Give the Public level a name of 1 to 40 characters.");
    expect(levelsProblem([], { public: "Public", community: "x".repeat(41) })).toBe("Give the community level a name of 1 to 40 characters.");
    expect(levelsProblem([], { public: "Guests", community: " guests " })).toBe('Two levels cannot share the name "Guests". Give each level its own name.');
    expect(levelsProblem([level("")], base)).toBe("Give membership level 1 a name of 1 to 40 characters.");
    expect(levelsProblem([level("Patron"), level("x".repeat(41))], base)).toBe("Give membership level 2 a name of 1 to 40 characters.");
    expect(levelsProblem([level("Patron"), level("patron ")], base)).toBe('Two levels cannot share the name "patron". Give each level its own name.');
    expect(levelsProblem([level("public")], base)).toBe('Two levels cannot share the name "public". Give each level its own name.');
    expect(levelsProblem([level("Patron", { tiers: [], membershipTypeKeys: [] })], base)).toBe(
      'Choose at least one membership tier or type for "Patron", so the level says who it is for.',
    );
    expect(levelsProblem([level("Patron", { tiers: [], membershipTypeKeys: ["senior_yearly"] })], base)).toBeNull();
    const many = Array.from({ length: MAX_MEMBERSHIP_LEVELS + 1 }, (_, i) => level(`Level ${i}`));
    expect(levelsProblem(many, base)).toBe(`A community can have at most ${MAX_MEMBERSHIP_LEVELS} membership levels above its community level.`);
    expect(levelsProblem(many.slice(0, MAX_MEMBERSHIP_LEVELS), base)).toBeNull();
  });

  it("numbers the levels 20, 30, 40 … in the order shown and gives each new one a key", () => {
    const payload = buildLevelsPayload([
      { key: "life", label: " Life member ", tiers: ["life"], membershipTypeKeys: [] },
      { key: "member", label: "Member", tiers: ["life", "yearly"], membershipTypeKeys: ["senior_yearly", "senior_yearly", "a_type"] },
      { ...newEditableLevel(), label: "Patron", tiers: ["life"] },
      { ...newEditableLevel(), label: "Life Member!", tiers: ["life"] },
    ]);
    expect(payload).toEqual([
      { key: "life", label: "Life member", rank: 20, tiers: ["life"], membership_type_keys: [] },
      { key: "member", label: "Member", rank: 30, tiers: ["yearly", "life"], membership_type_keys: ["a_type", "senior_yearly"] },
      { key: "patron", label: "Patron", rank: 40, tiers: ["life"], membership_type_keys: [] },
      { key: "life_member", label: "Life Member!", rank: 50, tiers: ["life"], membership_type_keys: [] },
    ]);
    expect(payload[0].rank).toBe(MIN_MEMBERSHIP_RANK);
    expect(new Set(payload.map((p) => p.key)).size).toBe(payload.length);
    for (const p of payload) {
      expect(LEVEL_KEY_PATTERN.test(p.key)).toBe(true);
      expect(p.rank).toBeGreaterThanOrEqual(MIN_MEMBERSHIP_RANK);
    }
  });

  it("counts what changed against the saved ladder", () => {
    const saved = parsed.levels;
    const same = editableLevels(saved);
    expect(levelsChangeCount(saved, same, base)).toBe(0);
    expect(levelsChangeCount(saved, same, { public: "Visitor", community: "Community member" })).toBe(1);
    expect(levelsChangeCount(saved, same, { public: "Visitor", community: "Friend" })).toBe(2);
    expect(levelsChangeCount(saved, [{ ...same[0], label: "Supporter" }, same[1]], base)).toBe(1);
    expect(levelsChangeCount(saved, [{ ...same[0], tiers: ["life"] }, same[1]], base)).toBe(1);
    expect(levelsChangeCount(saved, [{ ...same[0], tiers: ["life", "yearly"] }, same[1]], base)).toBe(0);
    expect(levelsChangeCount(saved, [{ ...same[0], membershipTypeKeys: [] }, same[1]], base)).toBe(1);
    expect(levelsChangeCount(saved, [same[1], same[0]], base)).toBe(1);
    expect(levelsChangeCount(saved, [same[0]], base)).toBe(1);
    expect(levelsChangeCount(saved, [...same, level("Patron", { isNew: true })], base)).toBe(1);
    expect(levelsChangeCount(saved, [same[1], { ...same[0], label: "Renamed" }, level("Patron", { isNew: true })], { ...base, public: "Guest" })).toBe(4);
  });

  it("says in words who a level is for", () => {
    expect(describeRule({ tiers: ["life"], membershipTypeKeys: [] }, types)).toBe("An active Life membership");
    expect(describeRule({ tiers: ["life", "yearly"], membershipTypeKeys: [] }, types)).toBe("An active Yearly or Life membership");
    expect(describeRule({ tiers: ["community", "yearly", "life"], membershipTypeKeys: [] }, types)).toBe("An active Community, Yearly or Life membership");
    expect(describeRule({ tiers: [], membershipTypeKeys: ["senior_yearly"] }, types)).toBe("An active membership of the type Senior yearly");
    expect(describeRule({ tiers: ["yearly"], membershipTypeKeys: ["senior_yearly", "gone"] }, types)).toBe(
      "An active Yearly membership, or an active membership of the types Senior yearly or gone",
    );
    expect(describeRule({ tiers: [], membershipTypeKeys: [] }, types)).toBe("No rule yet: choose who this level is for");
    const [pub, com, member] = parsed.levels as [AccessLevel, AccessLevel, AccessLevel];
    expect(describeLevel(pub, types, "JSH")).toBe("Anyone, signed in or not.");
    expect(describeLevel(com, types, "JSH")).toBe("Anyone who is signed in and part of JSH.");
    expect(describeLevel(member, types, "JSH")).toBe("An active Yearly or Life membership, or an active membership of the type Senior yearly. Higher levels are included.");
  });
});

// ---------------------------------------------------------------------------
// What the two forms post
// ---------------------------------------------------------------------------
describe("the forms' hidden fields", () => {
  it("reads the area changes and refuses anything else", () => {
    const ok = parseChangesField(JSON.stringify([{ feature: "darshan", level: "life" }, { feature: "puja", level: "public" }]));
    expect(ok).toEqual({ ok: true, value: [{ feature: "darshan", level: "life" }, { feature: "puja", level: "public" }] });
    expect(parseChangesField("[]")).toEqual({ ok: true, value: [] });
    for (const bad of [null, undefined, 3, "", "{", "{}", '[{"feature":"giving","level":"life"}]', '[{"feature":"darshan","level":"Bad Key"}]', '[{"feature":"darshan"}]',
      '[{"feature":"darshan","level":"life"},{"feature":"darshan","level":"public"}]', JSON.stringify(Array.from({ length: 9 }, () => ({ feature: "darshan", level: "life" }))), "[1]"]) {
      const r = parseChangesField(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("the page is out of date. Reload and try again.");
    }
  });

  it("reads the ladder, drops the key of a new level and refuses bad rows", () => {
    const ok = parseLevelsField(
      JSON.stringify([
        { key: "member", label: "Member", tiers: ["yearly", "life"], membershipTypeKeys: [] },
        { key: "", label: "Patron", tiers: ["life"], membershipTypeKeys: ["senior_yearly"], isNew: true },
        { key: "ignored", label: "Other", tiers: [], membershipTypeKeys: ["x"], isNew: true },
      ]),
    );
    expect(ok).toEqual({
      ok: true,
      value: [
        { key: "member", label: "Member", tiers: ["yearly", "life"], membershipTypeKeys: [] },
        { key: "", label: "Patron", tiers: ["life"], membershipTypeKeys: ["senior_yearly"], isNew: true },
        { key: "", label: "Other", tiers: [], membershipTypeKeys: ["x"], isNew: true },
      ],
    });
    for (const bad of [null, "", "{", "{}", "[1]", '[{"key":"Bad Key","label":"x","tiers":[],"membershipTypeKeys":[]}]', '[{"key":"a_b","label":"x","tiers":["gold"],"membershipTypeKeys":[]}]',
      '[{"key":"a_b","label":3,"tiers":[],"membershipTypeKeys":[]}]', '[{"key":"a_b","label":"x","tiers":"life","membershipTypeKeys":[]}]', '[{"key":"a_b","label":"x","tiers":[],"membershipTypeKeys":[""]}]',
      JSON.stringify(Array.from({ length: 16 }, (_, i) => ({ key: `k_${String.fromCharCode(97 + i)}`, label: "x", tiers: ["life"], membershipTypeKeys: [] })))]) {
      expect(parseLevelsField(bad).ok).toBe(false);
    }
  });
});

describe("isPermissionError", () => {
  it("recognises the database's refusal for a missing permission, and nothing else", () => {
    expect(isPermissionError({ code: "42501", message: "Seeing who can use each area needs the settings.manage permission." })).toBe(true);
    expect(isPermissionError({ code: "PGRST202" })).toBe(false);
    expect(isPermissionError(new Error("boom"))).toBe(false);
    expect(isPermissionError(null)).toBe(false);
    expect(isPermissionError("42501")).toBe(false);
  });
});

describe("accessRpc", () => {
  it("is the client itself, able to call the three RPCs by name", async () => {
    const calls: unknown[] = [];
    const db = { rpc: (fn: string, args?: unknown) => (calls.push([fn, args]), Promise.resolve({ data: null, error: null })) };
    await accessRpc(db).rpc("access_settings", { p_center: "c" });
    expect(calls).toEqual([["access_settings", { p_center: "c" }]]);
  });
});
