import { describe, expect, it } from "vitest";

import {
  ageLabel,
  buildAudience,
  buildTranslations,
  campaignStatusLabel,
  composeAction,
  describeAudience,
  EMPTY_SELECTION,
  formatPhone,
  hasUnknownAudienceKeys,
  openRate,
  parseAudience,
  refCode,
  requiresSecondApprover,
  translationLanguages,
} from "@/lib/comms";
import {
  addMinutesToClock,
  compareVersions,
  formatClock,
  mergePointsRules,
  mergeTimingRules,
  nextVersion,
  photoLocation,
  practiceCategoryLabel,
  practiceDefaultTime,
  readPointsRules,
  readTimingRules,
  slugify,
  todayTimingLine,
} from "@/lib/content";
import { validateRulesJson } from "@/lib/center-rules";
import { canAccess, visibleNav } from "@/lib/permissions";

describe("audience segments", () => {
  it("requires at least one segment", () => {
    expect(buildAudience(EMPTY_SELECTION)).toEqual({ ok: false, error: "Choose at least one audience segment." });
  });
  it("combines segments into one audience object", () => {
    const r = buildAudience({ ...EMPTY_SELECTION, lifeMembers: true, zoneIds: ["z1", "z1"], pathshalaClassIds: ["c1"] });
    expect(r).toEqual({
      ok: true,
      audience: { membership_tiers: ["life"], zone_ids: ["z1"], pathshala_class_ids: ["c1"], include: "parents" },
    });
  });
  it("defaults event RSVP statuses", () => {
    const r = buildAudience({ ...EMPTY_SELECTION, eventId: "e1" });
    expect(r.ok && r.audience).toEqual({ event_id: "e1", rsvp_statuses: ["rsvpd", "confirmed", "attended"] });
  });
  it("round-trips through parseAudience", () => {
    const sel = { ...EMPTY_SELECTION, allMembers: true, zoneIds: ["z"], eventId: "e", rsvpStatuses: ["attended"] };
    const r = buildAudience(sel);
    expect(r.ok && parseAudience(r.audience)).toEqual({ ...sel });
  });
  it("reads connect-admin's older single-preset audiences", () => {
    expect(parseAudience({ pathshala_class_ids: ["a"], include: "parents" }).pathshalaClassIds).toEqual(["a"]);
    expect(parseAudience(null)).toEqual(EMPTY_SELECTION);
    expect(hasUnknownAudienceKeys({ life_members: true })).toBe(true);
    expect(hasUnknownAudienceKeys({ zone_ids: [] })).toBe(false);
  });
  it("describes combined audiences", () => {
    const zones = new Map([["z", "West"]]);
    const events = new Map([["e", "Diwali"]]);
    expect(describeAudience({ all_members: true })).toBe("All members");
    expect(describeAudience({ zone_ids: ["z"], pathshala_class_ids: ["a", "b"] }, { zones, classCount: 2 })).toBe("Pathshala parents + West zone");
    expect(describeAudience({ event_id: "e", rsvp_statuses: ["attended"] }, { events })).toBe("Attendees of Diwali");
    expect(describeAudience({ life_members: true })).toBe("Custom segment");
    expect(describeAudience("x")).toBe("No audience");
  });
  it("keeps the current approval rule: all members needs a second approver", () => {
    expect(requiresSecondApprover({ all_members: true })).toBe(true);
    expect(requiresSecondApprover({ zone_ids: ["z"] })).toBe(false);
    expect(composeAction({ zone_ids: ["z"] }, true)).toBe("schedule");
    expect(composeAction({ zone_ids: ["z"] }, false)).toBe("submit");
    expect(composeAction({ all_members: true }, true)).toBe("submit");
  });
});

describe("campaign list helpers", () => {
  it("labels statuses in the prototype's words", () => {
    expect(campaignStatusLabel("draft")).toBe("Awaiting approval");
    expect(campaignStatusLabel("sent")).toBe("Sent");
  });
  it("computes open rate only when both counts exist", () => {
    expect(openRate(200, 124)).toBe("62% opened");
    expect(openRate(null, 5)).toBeNull();
    expect(openRate(100, null)).toBeNull();
  });
  it("writes only filled translations", () => {
    expect(buildTranslations({ gu: { title: " શીર્ષક ", body_md: "" }, hi: { title: "", body_md: "" } })).toEqual({ gu: { title: "શીર્ષક", body_md: "" } });
    expect(translationLanguages({ gu: { title: "x" } })).toEqual(["gu"]);
  });
  it("formats reference codes, phones and ages", () => {
    expect(refCode("NL", "00000000-0000-0000-0000-0000003f2a1b")).toBe("NL-F2A1B");
    expect(formatPhone("+18325552291")).toBe("(832) 555-2291");
    expect(formatPhone("+442071234567")).toBe("+442071234567");
    const now = new Date("2026-09-22T12:00:00Z");
    expect(ageLabel("2026-09-22T10:00:00Z", now)).toBe("2 h");
    expect(ageLabel("2026-09-20T11:00:00Z", now)).toBe("2 d");
    expect(ageLabel("2026-09-22T11:59:30Z", now)).toBe("1 min");
  });
});

describe("content helpers", () => {
  it("formats clock times and relative practice times", () => {
    expect(formatClock("06:45:00")).toBe("6:45 AM");
    expect(formatClock("12:30")).toBe("12:30 PM");
    expect(formatClock("00:05")).toBe("12:05 AM");
    expect(practiceDefaultTime({ key: "navkarsi", default_time: null })).toBe("Sunrise + 48 min");
    expect(practiceDefaultTime({ key: "x", default_time: null })).toBe("Anytime");
    expect(practiceCategoryLabel("mantra_jaap")).toBe("Mantra and jaap");
  });
  it("reads and validates points rules without touching other keys", () => {
    expect(readPointsRules({ points: { day_complete_bonus: 30 } }).day_complete_bonus).toBe(30);
    expect(readPointsRules(null).behind_after_days).toBe(3);
    const ok = mergePointsRules(
      { boli: { step_cents: 2100 } },
      { day_complete_bonus: "20", anumodana_points: "5", anumodana_daily_cap: "5", support_points: "3", behind_after_days: "3", streak_rest_days_per_month: "1" },
    );
    expect(ok.ok && ok.rules).toEqual({
      boli: { step_cents: 2100 },
      points: { day_complete_bonus: 20, anumodana_points: 5, anumodana_daily_cap: 5, support_points: 3, behind_after_days: 3, streak_rest_days_per_month: 1 },
    });
    expect(ok.ok && validateRulesJson(JSON.stringify(ok.rules)).ok).toBe(true);
    const bad = mergePointsRules({}, { day_complete_bonus: "x" });
    expect(bad.ok).toBe(false);
  });
  it("stores timing text under rules.timings", () => {
    const r = mergeTimingRules({ points: {} }, { derasar_hours: " 7:30 AM – 6:00 PM daily ", aarti: "", snatra_puja: "Sundays 9:30 AM" });
    expect(r.ok && r.rules).toEqual({ points: {}, timings: { derasar_hours: "7:30 AM – 6:00 PM daily", snatra_puja: "Sundays 9:30 AM" } });
    expect(readTimingRules(r.ok ? r.rules : null).aarti).toBe("");
  });
  it("computes the member Home line", () => {
    expect(addMinutesToClock("07:14:00", 48)).toBe("08:02");
    expect(todayTimingLine({ sunrise: "07:14", sunset: "19:21", navkarsi: null, chauvihar: null })).toBe(
      "Sunrise 7:14 AM · Navkarsi 8:02 AM · Chauvihar by 7:21 PM",
    );
    expect(todayTimingLine(null)).toBeNull();
  });
  it("locates photos in storage", () => {
    expect(photoLocation("https://cdn.example/x.jpg")).toEqual({ kind: "url", url: "https://cdn.example/x.jpg" });
    expect(photoLocation("photos/a/b.jpg")).toEqual({ kind: "storage", bucket: "photos", key: "a/b.jpg" });
    expect(photoLocation("/a/b.jpg")).toEqual({ kind: "storage", bucket: "photos", key: "a/b.jpg" });
    expect(photoLocation(" ")).toBeNull();
  });
  it("suggests the next document version", () => {
    expect(nextVersion("v3")).toBe("v4");
    expect(nextVersion("2026.1")).toBe("2026.2");
    expect(nextVersion(null)).toBe("v1");
    expect(compareVersions("v10", "v9")).toBeGreaterThan(0);
    expect(slugify("Iriyavahiyam sutra!")).toBe("iriyavahiyam-sutra");
  });
});

describe("content and comms navigation", () => {
  it("shows Content to content editors and Communications to the comms team", () => {
    const editor = visibleNav({ permissions: ["content.draft"], isPlatformAdmin: false });
    expect(editor.find((m) => m.key === "content")?.href).toBe("/content/queue");
    expect(editor.some((m) => m.key === "comms")).toBe(false);
    const inboxOnly = visibleNav({ permissions: ["comms.inbox"], isPlatformAdmin: false }).find((m) => m.key === "comms")!;
    expect(inboxOnly.tabs.map((t) => t.label)).toEqual(["Inbox"]);
    expect(canAccess({ permissions: ["comms.send"], isPlatformAdmin: false }, "commsApprove")).toBe(false);
  });
});

import { goalLearnerStats, quizFromFields } from "@/lib/content";

describe("Gyan Path learner stats", () => {
  it("counts learners and full completions per goal", () => {
    const stats = goalLearnerStats(new Map([["g", ["s1", "s2"]], ["h", ["s3"]]]), [
      { person_id: "a", step_id: "s1" },
      { person_id: "a", step_id: "s2" },
      { person_id: "b", step_id: "s1" },
      { person_id: "x", step_id: "zz" },
    ]);
    expect(stats.get("g")).toEqual({ learners: 2, completionPct: 50 });
    expect(stats.get("h")).toEqual({ learners: 0, completionPct: null });
  });
});

import { isoToLocalDateTime, localDateTimeToIso } from "@/lib/dates";

describe("datetime-local in the center's zone", () => {
  it("reads wall-clock time in the zone and back", () => {
    expect(localDateTimeToIso("2026-09-22T07:00", "America/Chicago")).toBe("2026-09-22T12:00:00.000Z");
    expect(localDateTimeToIso("2026-12-22T07:00", "America/Chicago")).toBe("2026-12-22T13:00:00.000Z");
    expect(localDateTimeToIso("bad", "America/Chicago")).toBeNull();
    expect(isoToLocalDateTime("2026-09-22T12:00:00.000Z", "America/Chicago")).toBe("2026-09-22T07:00");
  });
});

describe("quizFromFields", () => {
  it("builds the member app's quiz shape with a 0-based answer", () => {
    expect(quizFromFields("How many lines?", "5\n9\n\n12\n", "2")).toEqual({ ok: true, quiz: { questions: [{ question: "How many lines?", options: ["5", "9", "12"], answer: 1 }] } });
  });
  it("is empty when nothing was filled in", () => {
    expect(quizFromFields("", "", "")).toEqual({ ok: true, quiz: null });
  });
  it("explains what is missing", () => {
    expect(quizFromFields("Q?", "only one", "1")).toEqual({ ok: false, error: "give at least two answers, one per line" });
    expect(quizFromFields("", "a\nb", "1")).toEqual({ ok: false, error: "write the quiz question" });
    expect(quizFromFields("Q?", "a\nb", "3")).toEqual({ ok: false, error: "say which answer is right (1 to 2)" });
  });
});
