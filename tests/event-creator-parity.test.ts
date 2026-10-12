// PARITY (owner, 2026-10-11): "Ensure ALL features of the current event form are captured one way or another." This reads the
// old builder FROM ITS SOURCE — the BuilderEvent type, every form name the save reads, the builder's cards, the event page's
// tabs and every Events Server Action — and fails when one of them has no place in the guided creator's FIELD_MAP or
// FEATURE_MAP. Adding a field to the old form without mapping it fails here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FEATURE_MAP, FIELD_MAP, fieldsOn, hrefOf, isCard, placeOf } from "@/lib/event-creator/fields";
import { FIXTURE_KINDS, fixtureCtx } from "@/lib/event-creator/fixtures";
import { askedCards } from "@/lib/event-creator/questions";
import { CARD_IDS, type Place } from "@/lib/event-creator/types";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const BUILDER = src("src/app/(app)/events/builder/event-builder.tsx");
const BUILDER_PAGE = src("src/app/(app)/events/builder/page.tsx");
const ACTIONS = src("src/app/(app)/events/actions.ts");
const VALUES = src("src/lib/events/event-values.ts");
const EVENT_PAGE = src("src/app/(app)/events/[id]/page.tsx");

/** The keys of `export type BuilderEvent = { … };` */
function builderEventKeys(): string[] {
  const m = /export type BuilderEvent = \{([\s\S]*?)\n\};/.exec(BUILDER);
  if (!m) throw new Error("BuilderEvent type not found in event-builder.tsx");
  return [...m[1].matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((x) => x[1]);
}

/** Every form name read with a field reader: str(fd, "x"), bool(fd, "x") … in eventValues/commitmentOptions and the save itself. */
function formNames(): string[] {
  const save = ACTIONS.slice(ACTIONS.indexOf("async function saveEventWith"), ACTIONS.indexOf("export async function createEventFromTemplate"));
  if (save.length < 50) throw new Error("saveEventWith not found in actions.ts");
  const names = new Set<string>();
  for (const text of [VALUES, save]) for (const x of text.matchAll(/\b(?:str|reqStr|bool|int|dateTime|cents|all|oneOf|isoDate)\(fd, "([a-z_]+)"/g)) names.add(x[1]);
  return [...names];
}

/** <Card … title="…"> in the builder and its page. */
function builderCards(): string[] {
  return [...`${BUILDER}\n${BUILDER_PAGE}`.matchAll(/<Card[^>]*?\btitle="([^"]+)"/g)].map((x) => x[1]);
}

function eventPageTabs(): string[] {
  const m = /const TABS = \[([\s\S]*?)\] as const;/.exec(EVENT_PAGE);
  if (!m) throw new Error("TABS not found in events/[id]/page.tsx");
  return [...m[1].matchAll(/key: "([a-z_]+)"/g)].map((x) => x[1]);
}

function exportedActions(): string[] {
  return [...ACTIONS.matchAll(/^export async function ([A-Za-z]+)\(/gm)].map((x) => x[1]);
}

const validPlace = (p: Place) => (CARD_IDS as readonly string[]).includes(p) || /^link:\/\S+$/.test(p) || /^later:.{10,}$/.test(p);

describe("every field of the old builder has a place in the creator", () => {
  it("reads a believable list from the source", () => {
    expect(builderEventKeys()).toEqual(expect.arrayContaining(["name", "starts_at", "lunch_seats_per_slot", "owner", "confidential", "commitment"]));
    expect(builderEventKeys().length).toBeGreaterThanOrEqual(28);
    expect(formNames()).toEqual(expect.arrayContaining(["name", "intent", "commit_per_person", "member_price", "owner_person_id", "attendee_flags", "reminder_enabled"]));
    expect(formNames().length).toBeGreaterThanOrEqual(27);
  });

  it.each(builderEventKeys())("BuilderEvent.%s is in FIELD_MAP", (key) => {
    expect(FIELD_MAP[key], `map "${key}" in src/lib/event-creator/fields.ts`).toBeDefined();
    expect(validPlace(FIELD_MAP[key])).toBe(true);
  });

  it.each(formNames())('the form name "%s" that saveEvent reads is in FIELD_MAP', (name) => {
    expect(FIELD_MAP[name], `map "${name}" in src/lib/event-creator/fields.ts`).toBeDefined();
    expect(validPlace(FIELD_MAP[name])).toBe(true);
  });
});

describe("every feature of the old builder and the event page has a place", () => {
  it("reads the builder's cards, the tabs and the actions", () => {
    expect(builderCards()).toEqual(expect.arrayContaining(["Details and audience", "Lunch slots", "Preview with these settings", "More settings", "Start from a template", "Flyer maker"]));
    expect(eventPageTabs()).toEqual(expect.arrayContaining(["volunteers", "lunch", "checklist", "survey"]));
    expect(exportedActions()).toEqual(expect.arrayContaining(["saveEvent", "saveEventDraftInPlace", "createShift", "generateLunchSlots", "addChecklistAction", "grantEventRole", "addLesson"]));
  });

  it.each(builderCards())('the builder card "%s"', (title) => {
    expect(FEATURE_MAP[`card:${title}`], `map "card:${title}"`).toBeDefined();
  });

  it.each(eventPageTabs())('the event page tab "%s"', (tab) => {
    expect(FEATURE_MAP[`tab:${tab}`], `map "tab:${tab}"`).toBeDefined();
  });

  it.each(exportedActions())('the Events action "%s"', (name) => {
    expect(FEATURE_MAP[`action:${name}`], `map "action:${name}"`).toBeDefined();
  });

  it("every place is a card, a link or a later with its reason", () => {
    for (const [k, p] of Object.entries({ ...FIELD_MAP, ...FEATURE_MAP })) expect(validPlace(p), k).toBe(true);
  });
});

describe("whatever a community is asked, every field stays reachable", () => {
  it.each(FIXTURE_KINDS)("%s: each field shows on an asked card or under More settings", (kind) => {
    const ctx = fixtureCtx(kind);
    const asked = askedCards(ctx);
    for (const field of Object.keys(FIELD_MAP)) {
      const p = placeOf(field, ctx)!;
      if (isCard(p)) expect(asked, `${kind}: ${field} on ${p}`).toContain(p);
      else expect(hrefOf(p, "e-1") ?? p.startsWith("later:"), field).toBeTruthy();
    }
    // More settings always holds the builder's "More settings" fields.
    expect(fieldsOn("more", ctx)).toEqual(expect.arrayContaining(["rsvp_opens_at", "rsvp_closes_at", "program_year", "confidential", "owner"]));
  });

  it("the club (nothing switched on, all free events) keeps money, meals and the reminder under More settings", () => {
    const ctx = fixtureCtx("club");
    expect(fieldsOn("more", ctx)).toEqual(expect.arrayContaining(["is_paid", "member_price", "commitments_enabled", "lunch_enabled", "lunch_starts_at", "confirmation_hours_before"]));
  });
});
