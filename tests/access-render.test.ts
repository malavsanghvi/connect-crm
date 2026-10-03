import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The page's forms call server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/access/actions", () => ({
  saveFeatureAccessAction: vi.fn(),
  saveAccessLevelsAction: vi.fn(),
}));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { AreasCard, LevelsCard } from "@/app/(app)/settings/access/access-forms";
import { ACCESS_FEATURES, moduleOffNote, parseAccessSettings, type AccessSettings } from "@/lib/access";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// What app.access_settings sends for a community on the starting ladder, with darshan closed to Life members.
const raw = {
  levels: [
    { key: "public", label: "Public", rank: 0, kind: "public", tiers: [], membership_type_keys: [], locked: true },
    { key: "community", label: "Community member", rank: 10, kind: "community", tiers: [], membership_type_keys: [], locked: true },
    { key: "member", label: "Member", rank: 20, kind: "membership", tiers: ["yearly", "life"], membership_type_keys: [], locked: false },
    { key: "life", label: "Life member", rank: 30, kind: "membership", tiers: ["life"], membership_type_keys: ["old_life"], locked: false },
  ],
  features: ACCESS_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    default_level: f.defaultLevel,
    floor_level: f.floorLevel,
    level_key: f.key === "darshan" ? "life" : f.defaultLevel,
    enforced_by: f.enforcedBy,
    module_key: f.moduleKey,
    module_on: f.key !== "niva",
  })),
  membership_types: [
    { key: "yearly", name: "Yearly membership", tier: "yearly", active: true },
    { key: "old_life", name: "Old life membership", tier: "life", active: false },
    { key: "senior_yearly", name: "Senior yearly", tier: "yearly", active: true },
  ],
};
const parsed = parseAccessSettings(raw);
if (!parsed.ok) throw new Error(parsed.error);
const settings: AccessSettings = parsed.value;

describe("Settings › Access levels · Who can use each area", () => {
  const moduleNotes = Object.fromEntries(
    settings.features.flatMap((f) => {
      const note = moduleOffNote(f, "Niva assistant");
      return note ? [[f.key, note]] : [];
    }),
  );
  const html = render(createElement(AreasCard, { centerName: "JSH", levels: settings.levels, features: settings.features, types: settings.membershipTypes, moduleNotes }));

  it("shows a row for every area, with its description and where it applies", () => {
    expect(html).toContain("Who can use each area");
    for (const f of ACCESS_FEATURES) {
      expect(html).toContain(f.label.replace(/'/g, "&#x27;"));
      expect(html).toContain(f.description.replace(/'/g, "&#x27;"));
    }
    expect(html.match(/Applies in the app/g)!.length).toBeGreaterThanOrEqual(7);
    expect(html).toContain("Also enforced by the database");
    expect(html).toContain("The areas that are not listed here (giving, RSVPs, the store, family, Pathshala and the member directory) always need a signed-in community member.");
  });

  it("does not claim the database makes a stream private: it only withholds the link", () => {
    // What the database withholds is the stream's row, and with it the link; the stream plays from the link's own site.
    expect(html).toContain("the database only hands the data to people at or above the level");
    expect(html).toContain("It cannot make a link private");
    expect(html).toContain("anyone who already has the link can still watch it");
    expect(html).toContain("A stream shared by every community is not affected by this choice.");
    expect(html).not.toContain("refuses the data to anyone below the level");
    expect(html).not.toContain("protects the stream itself");
    // The newcomer guide is not the member directory.
    expect(html).toContain("The member directory of families is not part of this area");
  });

  it("offers each area only the levels at or above its floor, and marks the platform default", () => {
    // Four areas have no floor (the Public level is offered); the four with a community floor do not offer it.
    expect(html.match(/<option value="public"/g)!).toHaveLength(4);
    expect(html.match(/<option value="community"/g)!).toHaveLength(8);
    expect(html).toContain("Public (platform default)");
    expect(html).toContain("Community member (platform default)");
    expect(html).toContain('aria-label="Who can use Live darshan"');
  });

  it("selects what is saved, and says in words who that is", () => {
    expect(html).toContain('<option value="life" selected="">Life member</option>');
    expect(html).toContain("An active Life membership, or an active membership of the type Old life membership. Higher levels are included.");
    expect(html).toContain("Anyone, signed in or not.");
    expect(html).toContain("Anyone who is signed in and part of JSH.");
  });

  it("says why an area is closed when its module is off, and has nothing to save yet", () => {
    expect(html).toContain("Niva assistant is switched off (Settings › Modules), so nobody can use this area until it is switched back on.");
    expect(html).toContain("No changes");
    expect(html).toContain("disabled");
    expect(html).not.toContain('name="reason"');
    expect(html).toContain('<input type="hidden" name="changes" value="[]"/>');
  });
});

describe("Settings › Access levels · Levels for the community", () => {
  const props = { centerName: "JSH", levels: settings.levels, features: settings.features, types: settings.membershipTypes };
  const html = render(createElement(LevelsCard, props));

  it("lists the ladder: the two fixed levels with editable names, then the community's own levels", () => {
    expect(html).toContain("Levels for JSH");
    expect(html).toContain('value="Public"');
    expect(html).toContain('value="Community member"');
    expect(html).toContain("This level cannot be removed or moved.");
    expect(html).toContain('value="Member"');
    expect(html).toContain('value="Life member"');
    expect(html).toContain("+ Add a membership level");
    expect(html).toContain("Yearly tier");
    expect(html).toContain("Life tier");
  });

  it("offers the active membership types, and keeps an inactive one a level already uses visible", () => {
    expect(html).toContain("Yearly membership");
    expect(html).toContain("Senior yearly");
    expect(html).toContain("Old life membership");
    expect(html).toContain("(Life tier, not offered any more)");
    expect(html).toContain("(Yearly tier)");
  });

  it("will not remove a level an area still uses, and says which area", () => {
    // Darshan is set to Life member: its Remove button is disabled, the other level's is not.
    expect(html).toContain("Live darshan is set to this level. Choose another level for it above, save, then this level can be removed.");
    expect(html).toMatch(/<button[^>]*aria-label="Remove Life member"[^>]*disabled=""[^>]*title="Used by Live darshan"/);
    expect(html).toMatch(/<button[^>]*aria-label="Remove Member"(?![^>]*disabled)[^>]*>/);
  });

  it("has nothing to save yet, and no reason box until something changes", () => {
    expect(html).toContain("No changes");
    expect(html).not.toContain('name="reason"');
    expect(html).toContain('name="base_public" value="Public"');
    expect(html).toContain('name="base_community" value="Community member"');
  });

  it("has no warning about the Membership module: switching it off does not change anyone's level", () => {
    expect(html).not.toContain("Membership module");
  });
});
