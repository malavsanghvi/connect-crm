import { describe, expect, it } from "vitest";

import { auditModule, describeAuditAction, MODULE_TABLES } from "@/lib/audit-labels";
import { validateRulesJson } from "@/lib/center-rules";
import { centerStatusLabel, isValidSlug, parseWizardStep, slugify, traditionLabel } from "@/lib/center-wizard";
import { ENTITLEMENT_GROUPS, entitlementLabel, rightsCount, unknownPermissions } from "@/lib/entitlements";
import { integrationRows } from "@/lib/integrations";
import {
  applyRulesPatch,
  hourLabel,
  lunchRulesText,
  mergeRules,
  parseDollarsToCents,
  parseSection,
  quietHoursText,
  readNotificationSettings,
  readOnboardingFields,
  readRuleSettings,
  readSecuritySettings,
  RULE_DEFAULTS,
  rulesVersion,
} from "@/lib/settings-rules";

const form = (values: Record<string, string>) => (name: string) => (name in values ? values[name] : null);

const SEED_RULES = {
  child_login_age: 13,
  membership: { reference_required: true, reference_expiry_days: 14 },
  lunch: { slot_minutes: 15, family_with_child_under_12_at_start: true, senior_at_start: true, reminder_minutes_before: 5 },
  boli: { step_cents: 2100, soft_close_minutes: 0 },
  fees: { ask_donor_to_cover: true },
  identifiers: { org_member_label: "Member ID", legacy_systems: [{ system: "neon", label: "Neon" }] },
};

describe("rule settings", () => {
  it("reads stored rules and falls back to documented defaults", () => {
    const s = readRuleSettings(SEED_RULES);
    expect(s.boliStepCents).toBe(2100);
    expect(s.lifeReferencesRequired).toBe(RULE_DEFAULTS.lifeReferencesRequired);
    expect(s.points.behindAfterDays).toBe(3);
    expect(readRuleSettings(null).childLoginAge).toBe(13);
  });
  it("merges a patch without touching other keys and bumps the version", () => {
    const { rules, version } = applyRulesPatch(SEED_RULES, { boli: { soft_close_minutes: 5 } });
    expect(version).toBe(1);
    expect(rules.version).toBe(1);
    expect(rules.boli).toEqual({ step_cents: 2100, soft_close_minutes: 5 });
    expect(rules.identifiers).toEqual(SEED_RULES.identifiers);
    expect(applyRulesPatch(rules, {}).version).toBe(2);
    expect(rulesVersion(SEED_RULES)).toBeNull();
    expect(mergeRules({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });
  it("turns each section form into only the keys it edits", () => {
    const m = parseSection("membership", form({ life_references_required: "2", life_prior_yearly_months: "12", child_login_age: "16" }));
    expect(m).toEqual({ ok: true, patch: { child_login_age: 16, membership: { life_references_required: 2, life_prior_yearly_months: 12 } } });
    expect(parseSection("giving", form({ ask_donor_to_cover: "on" }))).toEqual({
      ok: true,
      patch: { fees: { ask_donor_to_cover: true }, boli: { soft_close_minutes: 0 } },
    });
    const bs = parseSection("bolis_store", form({ boli_step: "21", gift_pack: "2.99", cancel_hours_before_pickup: "24" }));
    expect(bs).toEqual({ ok: true, patch: { boli: { step_cents: 2100 }, store: { gift_pack_cents: 299, cancel_hours_before_pickup: 24 } } });
  });
  it("refuses bad input in plain English", () => {
    const r = parseSection("points", form({ day_complete_bonus: "x", streak_rest_days_per_month: "1", anumodana_points: "5", anumodana_daily_cap: "5", support_points: "3", behind_after_days: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("day-complete bonus must be a whole number");
      expect(r.error).toContain("between 1 and 60");
    }
    expect(parseSection("bolis_store", form({ boli_step: "0", gift_pack: "-1", cancel_hours_before_pickup: "24" })).ok).toBe(false);
  });
  it("every section's patch passes the rules validator", () => {
    const patches = [
      parseSection("lunch", form({ slot_minutes: "20", reminder_minutes_before: "5", confirmation_hours_before: "24", senior_at_start: "on" })),
      parseSection("notifications", form({ quiet_start_hour: "21", quiet_end_hour: "7", trigger_rsvp_confirmation: "on" })),
      parseSection("security", form({ admin_session_hours: "8", admin_idle_minutes: "30", printed_signin_codes: "on" })),
      parseSection("onboarding", form(Object.fromEntries(["name_relationship", "date_of_birth", "gender", "profession", "employer", "mobile_emails", "contact_channels", "language", "interests"].map((k) => [`field_${k}`, "optional"])))),
    ];
    for (const p of patches) {
      expect(p.ok).toBe(true);
      if (p.ok) expect(validateRulesJson(JSON.stringify(applyRulesPatch(SEED_RULES, p.patch).rules)).ok).toBe(true);
    }
  });
  it("rejects bad values for the new keys in the JSON editor", () => {
    const bad = validateRulesJson(JSON.stringify({ onboarding: { fields: { gender: "maybe" } }, notifications: { triggers: { x: "yes" } }, points: { behind_after_days: 0 } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors).toHaveLength(3);
  });
  it("parses money to integer cents", () => {
    expect(parseDollarsToCents("$2.99")).toBe(299);
    expect(parseDollarsToCents("21")).toBe(2100);
    expect(parseDollarsToCents("1.5")).toBe(150);
    expect(parseDollarsToCents("1.999")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
  it("writes the lunch note from the lunch keys", () => {
    expect(lunchRulesText(readRuleSettings(SEED_RULES))).toMatch(/^Families with a child under 12 or a senior eat together at lunch start\./);
    const none = readRuleSettings({ lunch: { family_with_child_under_12_at_start: false, senior_at_start: false, reminder_minutes_before: 0 } });
    expect(lunchRulesText(none)).toMatch(/^No family is placed at lunch start automatically\./);
    expect(lunchRulesText(none)).not.toMatch(/reminded/);
  });
});

describe("onboarding, notifications and security settings", () => {
  it("keeps privacy choices always asked, whatever is stored", () => {
    const f = readOnboardingFields({ onboarding: { fields: { gender: "hidden", directory_listing: "hidden" } } });
    expect(f.gender).toBe("hidden");
    expect(f.directory_listing).toBe("required");
    expect(f.date_of_birth).toBe("required");
  });
  it("reads notification rules with every trigger on by default", () => {
    const n = readNotificationSettings({ notifications: { quiet_start_hour: 22, triggers: { pledge_reminder: false } } });
    expect(n.triggers.pledge_reminder).toBe(false);
    expect(n.triggers.rsvp_confirmation).toBe(true);
    expect(quietHoursText(n)).toBe("10 PM – 7 AM");
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
  });
  it("reads security defaults", () => {
    expect(readSecuritySettings({})).toEqual({ printedSigninCodes: true, adminSessionHours: 8, adminIdleMinutes: 30, require2faForStaff: true });
    expect(readSecuritySettings({ security: { require_2fa_for_staff: false } }).require2faForStaff).toBe(false);
  });
});

describe("entitlement catalogue", () => {
  const SEEDED = [
    "people.view", "people.manage", "people.approve", "events.view", "events.manage", "events.confidential", "giving.view", "giving.manage",
    "giving.approve", "giving.record_offline", "bolis.view", "bolis.manage", "bolis.record", "store.view", "store.manage", "store.pickup",
    "kitchen.view", "content.view", "content.manage", "content.draft", "content.approve", "comms.view", "comms.send", "comms.approve",
    "comms.inbox", "pathshala.view", "pathshala.manage", "pathshala.teach", "reports.view", "settings.manage", "roles.manage", "audit.view",
    "integrations.view", "integrations.manage", "volunteers.view", "volunteers.manage", "safety.view", "safety.manage", "governance.view",
    "governance.manage", "governance.vote", "accounting.manage", "accounting.close", "privacy.manage",
  ];
  it("describes every permission the seeded roles use", () => {
    expect(unknownPermissions(SEEDED)).toEqual([]);
    expect(entitlementLabel("giving.record_offline")).toBe("Record offline payments and match deposits");
  });
  it("lists the prototype's groups in order and marks missing entitlements as planned", () => {
    expect(ENTITLEMENT_GROUPS.map((g) => g.name).slice(0, 8)).toEqual(["People", "Events", "Giving", "Bolis", "Store", "Pathshala", "Content", "Communications"]);
    const planned = ENTITLEMENT_GROUPS.flatMap((g) => g.items.filter((i) => i.planned).map((i) => i.key));
    expect(planned.sort()).toEqual(["data.export", "giving.amounts", "people.children", "people.merge"]);
    expect(unknownPermissions(["giving.amounts"])).toEqual(["giving.amounts"]);
  });
  it("counts rights", () => {
    expect(rightsCount(["*"])).toBe("All");
    expect(rightsCount(["a", "b"])).toBe("2");
  });
});

describe("audit labels", () => {
  it("maps tables to the prototype's modules", () => {
    expect(auditModule("payments")).toBe("giving");
    expect(auditModule("centers")).toBe("settings");
    expect(auditModule("boli_entries")).toBe("bolis");
    expect(auditModule("mystery")).toBeNull();
    const all = Object.values(MODULE_TABLES).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("writes plain sentences", () => {
    expect(describeAuditAction("payments.insert", "payments")).toBe("Recorded a payment");
    expect(describeAuditAction("households.update", "households")).toBe("Changed a household");
    expect(describeAuditAction("people.delete", "people")).toBe("Deleted a person");
    expect(describeAuditAction("refund.approve", null)).toBe("Refund approve");
  });
});

describe("integrations", () => {
  it("never shows a service as connected without a connected row", () => {
    const rows = integrationRows([
      { provider: "quickbooks_online", status: "connected", display_name: "Center company", settings: { basis: "cash" }, connected_at: null, token_expires_at: null, last_error: null },
      { provider: "twilio", status: "error", display_name: null, settings: {}, connected_at: null, token_expires_at: null, last_error: "token revoked" },
    ]);
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ label: "QuickBooks Online", detail: "Center company · cash basis", status: { label: "Connected", tone: "ok" } });
    expect(rows.find((r) => r.key === "sms")).toMatchObject({ status: { label: "Error", tone: "bad" }, detail: "Last error: token revoked" });
    expect(rows.find((r) => r.key === "payments")?.status.label).toBe("Not connected");
    expect(rows.find((r) => r.key === "background")?.detail).toBe("Choose a screening provider");
  });
});

describe("new center wizard", () => {
  it("makes safe public URLs", () => {
    expect(slugify("Design partner center A")).toBe("design-partner-center-a");
    expect(slugify("  Jain Center — Dallas! ")).toBe("jain-center-dallas");
    expect(isValidSlug("partner-a")).toBe(true);
    expect(isValidSlug("-bad")).toBe(false);
    expect(isValidSlug("Bad")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
  });
  it("validates step 1 and leaves the brand kit to Setup", () => {
    const ok = parseWizardStep(1, form({ name: "Partner A", slug: "partner-a", primary: "#1B2C5C", time_zone: "America/Chicago", logo_url: "https://x.org/l.png" }));
    expect(ok).toEqual({ ok: true, change: { columns: { name: "Partner A", slug: "partner-a", time_zone: "America/Chicago" }, rules: {} } });
    const bad = parseWizardStep(1, form({ name: "P", slug: "x y", time_zone: "Mars" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.split(". ").length).toBeGreaterThanOrEqual(3);
  });
  it("never stores admin emails", () => {
    expect(parseWizardStep(5, form({ admin_email: "a@b.org" }))).toEqual({ ok: true, change: { columns: {}, rules: {} } });
  });
  it("labels center status and tradition", () => {
    expect(centerStatusLabel("active", {})).toEqual({ label: "Live", live: true });
    expect(centerStatusLabel("onboarding", { onboarding: { wizard_step: 3 } }).label).toBe("Onboarding · step 3 of 6");
    expect(traditionLabel("sthanakvasi")).toBe("Sthanakvasi");
    expect(traditionLabel("other")).toBe("Configurable");
  });
});
