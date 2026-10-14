import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrontDoor, type FrontLinks } from "@/components/onboarding-front/front-door";
import { buildFrontDoor, qboTile, type FrontInput } from "@/lib/onboarding-front/front-door";
import { SAMPLE_COMMUNITY, sampleContext, sampleFiles, sampleInput, sampleModel } from "@/lib/onboarding-front/fixtures";

// Setup › Guided onboarding › Bring your data in (board 1 of docs/handoff/prototypes/onboarding-data/Main.dc.html), drawn
// from invented sample data for a neutral community.

const LINKS: FrontLinks = {
  self: "/setup/onboarding/start",
  setup: "/setup",
  guided: "/setup/onboarding",
  dataImport: "/settings/import/new",
  bank: "/giving/payments/bank",
  qboSetup: "/accounting/qbo/setup",
  peopleTemplate: "/setup/onboarding/template?kind=people&format=xlsx",
  donationsTemplate: "/setup/onboarding/template?kind=donations&format=xlsx",
};

const render = (model = sampleModel(), files = sampleFiles(), links: FrontLinks = LINKS) =>
  renderToStaticMarkup(createElement(FrontDoor, { model, recognise: sampleContext(), links, peopleWord: "members & households", initialFiles: files }));

/** Words of one tradition (or one customer) that must never appear on a screen built for every organization. */
const TRADITION_WORDS = /jain|derasar|pathshala|satvik|jinendra|boli|paryushan|temple|church|JSH/i;

describe("the front door's model", () => {
  it("states the facts in the kind's own words and the route in load order, what is in first", () => {
    const m = sampleModel("full");
    expect(m.facts).toEqual([
      "Community organization",
      "2 imports so far",
      "742 rows of people",
      "318 rows of households",
      "QuickBooks connected",
      "Dues & donations: on",
      "Events & RSVP: on",
      "Store: off",
    ]);
    expect(m.route).toBe(
      "your members & households are in; next, add past donations, then let households check their own details (coming next). Modules you do not use, such as Store, are left out.",
    );
    expect(m.steps.map((s) => `${s.n} ${s.title} ${s.state}`)).toEqual(["1 Choose how now", "2 Bring it in todo", "3 Review todo", "4 Ready todo"]);
    expect(m.greeting).toContain(SAMPLE_COMMUNITY);
  });

  it("starts with the people when nothing is loaded, and leaves giving out when the kind has none", () => {
    expect(sampleModel("empty").route).toBe(
      "bring in your members & households, from a file or the template, then add past donations, then let households check their own details (coming next). Modules you do not use, such as Store, are left out.",
    );
    const club: FrontInput = { ...sampleInput("empty"), giving: null, otherModules: [] };
    expect(buildFrontDoor(club).route).toBe("bring in your members & households, from a file or the template, then let households check their own details (coming next).");
  });

  it("shows Niva counts and shapes only, never a file name or a person", () => {
    const m = sampleModel("full");
    expect(m.sees).toEqual(["2 imports so far, 1,060 rows in all.", "People: 742 rows.", "Households: 318 rows."]);
    expect(sampleModel("empty").sees).toEqual(["Nothing has been loaded yet, so there is nothing for Niva to count."]);
  });

  it("says plainly when the imports could not be counted", () => {
    const m = buildFrontDoor({ ...sampleInput("full"), imports: { ok: false, error: "Could not list your imports — the database could not be reached." } });
    expect(m.importsError).toBe("Could not list your imports — the database could not be reached.");
    expect(m.facts).not.toContain("Nothing loaded yet");
    expect(m.sees[0]).toMatch(/could not count/);
  });

  it("gives the QuickBooks tile its real state, never a made-up 'Connected'", () => {
    expect(qboTile({ state: "not_connected" }).status).toBe("Not connected");
    expect(qboTile({ state: "connected", name: null, expiring: true }).status).toBe("Connected · renew soon");
    expect(qboTile({ state: "problem", detail: "token revoked" }).detail).toBe("Last error: token revoked");
    expect(qboTile({ state: "no_access" })).toMatchObject({ status: "You can't see this connection", canOpen: false });
    expect(qboTile({ state: "off", moduleLabel: "Accounting & QuickBooks", offered: true }).status).toBe("Accounting & QuickBooks is switched off");
    expect(qboTile({ state: "off", moduleLabel: "Accounting & QuickBooks", offered: false }).status).toBe("Not part of your organization");
    expect(qboTile({ state: "error", message: "Could not check the QuickBooks connection — x." })).toMatchObject({ tone: "bad", canOpen: false });
  });
});

describe("the front door, drawn", () => {
  const html = render();

  it("draws board 1's sections in order, with the v2 tokens on its own container", () => {
    expect(html).toContain('data-v2-tokens=""');
    const order = ["Bring your data in", "Step 1 of 4", "Your plan", "Drop spreadsheets, exports or PDFs here", "Neon CRM", "Start from Weaver&#x27;s templates", "Hand a part to someone", "What Niva sees, and what it never does", "Not sure? Ask me", "Ask Niva about your data"];
    const at = order.map((s) => html.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Steps to bring your data in"');
  });

  it("shows the recognised files with what each is, and says nothing leaves the browser", () => {
    expect(html).toContain("Looks like a Neon CRM export: 1,240 rows,");
    expect(html).toContain("Weaver template");
    expect(html).toContain("Your own spreadsheet");
    expect(html).toContain("Photo of paper");
    expect(html).toContain("I looked at 3 files and 1 photo, here in your browser.");
    expect(html).toContain("Nothing is uploaded or saved.");
    expect(html).toContain('href="/setup/onboarding"');
    expect(html).toContain('href="/settings/import/new"');
  });

  it("marks everything not built yet 'Coming next' and switches it off", () => {
    expect((html.match(/Coming next/g) ?? []).length).toBeGreaterThanOrEqual(8);
    for (const label of ["Paste a Google Sheets link", "Edit my answers", "Invite a helper", "Send us the files"]) {
      expect(html).toMatch(new RegExp(`<button type="button" disabled=""[^>]*>${label}</button>`));
    }
  });

  it("links the real templates and QuickBooks setup, with QuickBooks' real state", () => {
    expect(html).toContain(`href="${LINKS.peopleTemplate.replace(/&/g, "&amp;")}"`);
    expect(html).toContain("Get the members &amp; households template");
    expect(html).toContain(`href="${LINKS.donationsTemplate!.replace(/&/g, "&amp;")}"`);
    expect(html).toContain('href="/accounting/qbo/setup"');
    expect(html).toContain("Riverside Neighbours (QuickBooks Online)");
  });

  it("leaves the donations template out without giving, and QuickBooks unlinked when it cannot be opened", () => {
    const out = render(sampleModel("empty"), [], { ...LINKS, donationsTemplate: null, qboSetup: null });
    expect(out).not.toContain("Get the past donations template");
    expect(out).not.toContain('href="/accounting/qbo/setup"');
    expect(out).toContain("Not connected");
    expect(out).not.toContain("I looked at");
  });

  it("switches the Niva box off honestly when Niva is not available (no provider here)", () => {
    expect(html).toContain("Niva is not available here yet, so this box is switched off.");
    expect(html).toMatch(/<input[^>]*aria-label="Ask Niva about your data"[^>]*disabled=""/);
  });

  it("reads for any organization: no tradition's or customer's words (OWNER RULE)", () => {
    expect(html).not.toMatch(TRADITION_WORDS);
  });

  it("keeps D2 on the page: nothing about children goes to an AI service", () => {
    expect(html).toContain("Nothing about anyone under 18 is ever sent to an AI service.");
    expect(html).toContain("never a name, a contact detail or an amount for a person");
  });
});
