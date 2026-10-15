import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/events/contact-rsvp-actions", () => ({ setContactRsvp: vi.fn(), verifyContactRsvp: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { ContactRsvpCard } from "@/app/(app)/events/[id]/contact-rsvp-card";
import { EventsTable } from "@/components/people-v2/family/events-table";
import { validateRulesJson } from "@/lib/center-rules";
import type { Tables } from "@/lib/database.types";
import { buildEventLines } from "@/lib/people-v2/family-events";
import {
  CONTACT_SOURCE,
  effectiveContactMode,
  eventIneligibleReason,
  eventModeOptions,
  eventModeStatus,
  isUnverifiedContactRsvp,
  readContactLookup,
  readEventMode,
  rsvpContactRuleProblems,
  unverifiedPlaces,
  unverifiedShareText,
} from "@/lib/rsvp-contact";
import { parseSection, readRuleSettings } from "@/lib/settings-rules";

// RSVP without signing in, in the portal (docs/RSVP_WITHOUT_LOGIN.md section 7, slice 4): the two switches, the plain words, the unverified marker.

const FREE = { is_paid: false, confidential: false, audience: "members_and_guests" };

describe("the community's rule", () => {
  it("reads off, code and open, and anything else as off (as the database does)", () => {
    expect(readContactLookup({ rsvp: { contact_lookup: "open" } })).toBe("open");
    expect(readContactLookup({ rsvp: { contact_lookup: "code" } })).toBe("code");
    for (const bad of [undefined, null, {}, { rsvp: null }, { rsvp: {} }, { rsvp: { contact_lookup: "OPEN" } }, { rsvp: { contact_lookup: 1 } }, { rsvp: "open" }]) {
      expect(readContactLookup(bad as never)).toBe("off");
    }
  });

  it("is in the Rules settings, off by default", () => {
    expect(readRuleSettings({}).rsvp.contactLookup).toBe("off");
    expect(readRuleSettings({ rsvp: { contact_lookup: "code", confirmation_hours_before: 48 } }).rsvp).toMatchObject({ contactLookup: "code", confirmationHoursBefore: 48 });
  });

  const lunchForm = (over: Record<string, string>) => (name: string) =>
    ({ slot_minutes: "15", reminder_minutes_before: "5", confirmation_hours_before: "24", family_with_child_under_12_at_start: "on", senior_at_start: "on", ...over })[name] ?? null;

  it("is saved with the Lunch and RSVP form only when the form sent it", () => {
    const withIt = parseSection("lunch", lunchForm({ rsvp_contact_lookup: "open" }));
    expect(withIt).toMatchObject({ ok: true });
    expect(withIt.ok && withIt.patch.rsvp).toEqual({ confirmation_hours_before: 24, contact_lookup: "open" });
    const without = parseSection("lunch", lunchForm({}));
    expect(without.ok && without.patch.rsvp).toEqual({ confirmation_hours_before: 24 });
  });

  it("refuses a choice that is not one of the three, in plain words", () => {
    const bad = parseSection("lunch", lunchForm({ rsvp_contact_lookup: "everyone" }));
    expect(bad).toEqual({ ok: false, error: "Choose Off, With a code or Without a code for RSVP without signing in." });
  });

  it("is checked in the JSON editor too", () => {
    expect(rsvpContactRuleProblems(undefined)).toEqual([]);
    expect(rsvpContactRuleProblems({ contact_lookup: "code" })).toEqual([]);
    expect(rsvpContactRuleProblems({ contact_lookup: "maybe" })).toEqual([`"rsvp.contact_lookup" must be "off", "code" or "open".`]);
    expect(validateRulesJson(JSON.stringify({ rsvp: { contact_lookup: "maybe" } }))).toMatchObject({ ok: false });
    expect(validateRulesJson(JSON.stringify({ rsvp: { contact_lookup: "open" } }))).toMatchObject({ ok: true });
  });
});

describe("the event's switch", () => {
  it("is never above the community's", () => {
    expect(effectiveContactMode("open", "code")).toBe("code");
    expect(effectiveContactMode("open", "off")).toBe("off");
    expect(effectiveContactMode("code", "open")).toBe("code");
    expect(effectiveContactMode("off", "open")).toBe("off");
    expect(readEventMode("nonsense")).toBe("off");
  });

  it("greys out what the community has not allowed", () => {
    expect(eventModeOptions("off").map((o) => [o.value, o.disabled])).toEqual([["off", false], ["code", true], ["open", true]]);
    expect(eventModeOptions("code").map((o) => [o.value, o.disabled])).toEqual([["off", false], ["code", false], ["open", true]]);
    expect(eventModeOptions("open").every((o) => !o.disabled)).toBe(true);
  });

  it("says why an event cannot use it, with the database's rules", () => {
    expect(eventIneligibleReason(FREE)).toBeNull();
    expect(eventIneligibleReason({ ...FREE, audience: "public" })).toBeNull();
    expect(eventIneligibleReason({ ...FREE, is_paid: true })).toMatch(/paid event/);
    expect(eventIneligibleReason({ ...FREE, confidential: true })).toMatch(/confidential/);
    for (const audience of ["members_only", "life_members_only", "pathshala_families"]) {
      expect(eventIneligibleReason({ ...FREE, audience })).toMatch(/not open to the public/);
    }
  });

  it("states where the event stands in one sentence", () => {
    expect(eventModeStatus("off", "open", FREE)).toBe("Off for this event.");
    expect(eventModeStatus("open", "open", FREE)).toBe("On: without a code.");
    expect(eventModeStatus("code", "code", FREE)).toBe("On: with a code.");
    expect(eventModeStatus("open", "code", FREE)).toBe("With a code (this community allows nothing more open than that).");
    expect(eventModeStatus("open", "off", FREE)).toBe("Not allowed for this community. An administrator can allow it in Settings › Rules.");
    expect(eventModeStatus("code", "open", { ...FREE, is_paid: true })).toMatch(/^Not available for this event\. This is a paid event/);
  });
});

describe("the places held for RSVPs made without signing in", () => {
  it("is the database's number: 25% of the places, at least one, or 40 with no limit", () => {
    expect(unverifiedPlaces(8)).toBe(2);
    expect(unverifiedPlaces(5)).toBe(2);
    expect(unverifiedPlaces(100)).toBe(25);
    expect(unverifiedPlaces(3)).toBe(1);
    expect(unverifiedPlaces(1)).toBe(1);
    expect(unverifiedPlaces(null)).toBe(40);
  });

  it("explains it in words, with the event's own numbers", () => {
    expect(unverifiedShareText(100)).toContain("at most 25 of the event's places (100 places)");
    expect(unverifiedShareText(null)).toContain("at most 40 of the event's places (no limit is set, so the cap is 40 places)");
    expect(unverifiedShareText(100)).toContain("mark them verified here");
  });
});

describe("unverified RSVPs", () => {
  it("are those made without signing in that nobody has proved", () => {
    expect(isUnverifiedContactRsvp({ source: CONTACT_SOURCE, contact_verified_at: null })).toBe(true);
    expect(isUnverifiedContactRsvp({ source: CONTACT_SOURCE })).toBe(true);
    expect(isUnverifiedContactRsvp({ source: CONTACT_SOURCE, contact_verified_at: "2026-10-16T12:00:00Z" })).toBe(false);
    expect(isUnverifiedContactRsvp({ source: "app", contact_verified_at: null })).toBe(false);
    expect(isUnverifiedContactRsvp({ source: null })).toBe(false);
  });

  it("are labelled on the Family page's Events lines", () => {
    const lines = buildEventLines(
      [
        { id: "r1", event_id: "e1", status: "rsvpd", source: CONTACT_SOURCE, created_at: "2026-10-01T00:00:00Z", contact_verified_at: null },
        { id: "r2", event_id: "e2", status: "rsvpd", source: CONTACT_SOURCE, created_at: "2026-10-01T00:00:00Z", contact_verified_at: "2026-10-02T00:00:00Z" },
        { id: "r3", event_id: "e3", status: "rsvpd", source: "app", created_at: "2026-10-01T00:00:00Z" },
      ],
      [
        { id: "e1", name: "Open Day", starts_at: "2026-11-01T00:00:00Z" },
        { id: "e2", name: "Open Day Two", starts_at: "2026-11-02T00:00:00Z" },
        { id: "e3", name: "Open Day Three", starts_at: "2026-11-03T00:00:00Z" },
      ],
      [],
    );
    const by = (id: string) => lines.find((l) => l.rsvpId === id)!;
    expect(by("r1")).toMatchObject({ source: "Without signing in", unverified: true });
    expect(by("r2")).toMatchObject({ source: "Without signing in", unverified: false });
    expect(by("r3")).toMatchObject({ source: "Member app", unverified: false });
    const html = renderToStaticMarkup(createElement(EventsTable, { lines, timeZone: "America/Chicago" }));
    expect(html.match(/Unverified/g)).toHaveLength(1);
    expect(html).toContain("Without signing in");
  });
});

describe("the event's RSVPs card", () => {
  const event = (over: Partial<Tables<"events">> = {}) => ({ id: "ev1", capacity: 100, contact_rsvp: "off", is_paid: false, confidential: false, audience: "public", ...over }) as Tables<"events">;
  const draw = (e: Tables<"events">, community: "off" | "code" | "open", canEdit: boolean) =>
    renderToStaticMarkup(createElement(ContactRsvpCard, { event: e, community, canEdit }));

  it("gives the choice to people who can edit the event, and no more than the community allows", () => {
    const html = draw(event(), "code", true);
    expect(html).toContain("RSVP without signing in");
    expect(html).toContain("With a code");
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/disabled=""[^>]*>Without a code/);
    expect(html).not.toContain("Anyone who knows a member");
  });

  it("warns what 'without a code' shows when the community allows it", () => {
    expect(draw(event({ contact_rsvp: "open" }), "open", true)).toContain("Anyone who knows a member");
  });

  it("explains the unverified share when it is on", () => {
    const html = draw(event({ contact_rsvp: "code" }), "open", true);
    expect(html).toContain("at most 25 of the event");
    expect(html).toContain("never at one the visitor typed");
  });

  it("says plainly when the community has not allowed it, and gives no control", () => {
    const html = draw(event(), "off", true);
    expect(html).toContain("This community has not allowed it");
    expect(html).toContain("Settings › Rules");
    expect(html).not.toContain('role="radiogroup"');
  });

  it("says plainly why a paid event cannot use it", () => {
    const html = draw(event({ is_paid: true, contact_rsvp: "off" }), "open", true);
    expect(html).toContain("This is a paid event");
    expect(html).not.toContain('role="radiogroup"');
  });

  it("gives people who cannot edit the event only the words", () => {
    const html = draw(event({ contact_rsvp: "code" }), "open", false);
    expect(html).toContain("6-digit code");
    expect(html).not.toContain('role="radiogroup"');
  });
});
