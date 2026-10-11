import { describe, expect, it } from "vitest";

import { ACCESS_AREAS, accessArea, permissionWords, roleAllows, rolesThatGive } from "@/lib/settings-help/areas";
import { buildHealthView } from "@/lib/settings-help/health-view";
import { endsWords, isAdultHolder, lastDayAfterMonths, matchRoles, scopeWords } from "@/lib/settings-help/role-words";
import { buildSetupView, whereLabel, type ChecklistRowIn } from "@/lib/settings-help/setup-view";
import { ACCESS } from "@/lib/permissions";

const ROLES = [
  { key: "center_admin", name: "Center admin", tier: "center", permissions: ["settings.manage", "roles.manage", "giving.view"] },
  { key: "treasurer", name: "Treasurer", tier: "center", permissions: ["giving.view", "giving.manage", "giving.record_offline", "accounting.close"] },
  { key: "finance_volunteer", name: "Finance volunteer", tier: "operational", permissions: ["giving.record_offline"] },
  { key: "event_manager", name: "Event manager", tier: "operational", permissions: ["events.view", "events.manage"] },
  { key: "platform_admin", name: "Platform admin", tier: "platform", permissions: ["*"] },
  { key: "primary_adult", name: "Primary adult", tier: "family", permissions: ["giving.view"] },
];

describe("the areas people ask about", () => {
  it("each one names an ACCESS key the screens use", () => {
    for (const a of ACCESS_AREAS) expect(Object.keys(ACCESS), a.key).toContain(a.access);
    expect(new Set(ACCESS_AREAS.map((a) => a.key)).size).toBe(ACCESS_AREAS.length);
  });

  it("finds the roles that give an area, never a platform or family role, and does not expand the wildcard", () => {
    const payments = accessArea("payments")!;
    expect(rolesThatGive(payments, ROLES).map((r) => r.key)).toEqual(["center_admin", "treasurer", "finance_volunteer"]);
    expect(rolesThatGive(accessArea("run_events")!, ROLES).map((r) => r.key)).toEqual(["event_manager"]);
    expect(rolesThatGive(accessArea("roles")!, ROLES).map((r) => r.key)).toEqual(["center_admin"]);
  });

  it("says a permission in the words of the Roles screen", () => {
    expect(permissionWords(["giving.view", "giving.manage", "giving.view"])).toHaveLength(2);
    expect(permissionWords(["giving.view"])[0]).toMatch(/pledges and payments/i);
    expect(roleAllows(["events.view", "events.manage", "no.such.right", "*"]).length).toBe(2);
  });
});

describe("matchRoles", () => {
  it("reads a role the way a person says it", () => {
    expect(matchRoles("treasurer", ROLES).map((r) => r.key)).toEqual(["treasurer"]);
    expect(matchRoles("the Treasurer role", ROLES).map((r) => r.key)).toEqual(["treasurer"]);
    expect(matchRoles("event manager", ROLES).map((r) => r.key)).toEqual(["event_manager"]);
    expect(matchRoles("event_manager", ROLES).map((r) => r.key)).toEqual(["event_manager"]);
  });

  it("returns every best match when the words fit several, and none for nonsense", () => {
    expect(matchRoles("admin", ROLES).map((r) => r.key).sort()).toEqual(["center_admin", "platform_admin"]);
    expect(matchRoles("finance", ROLES).map((r) => r.key)).toEqual(["finance_volunteer"]);
    expect(matchRoles("zebra", ROLES)).toEqual([]);
    expect(matchRoles("the role", ROLES)).toEqual([]);
  });
});

describe("saying a grant", () => {
  it("names the scope and the end", () => {
    expect(scopeWords("center", null)).toBe("The whole community");
    expect(scopeWords("event", "Diwali Dinner")).toBe("Event: Diwali Dinner");
    expect(endsWords(null)).toBe("until someone takes it away");
    expect(endsWords("2027-10-10")).toBe("until October 10, 2027");
  });

  it("ends 'for a year' the day before the same date next year", () => {
    expect(lastDayAfterMonths("2026-10-11", 12)).toBe("2027-10-10");
    expect(lastDayAfterMonths("2026-10-11", 1)).toBe("2026-11-10");
    expect(lastDayAfterMonths("2026-01-31", 1)).toBe("2026-02-27");
    expect(lastDayAfterMonths("2026-12-15", 3)).toBe("2027-03-14");
  });
});

describe("who may be named (adults only)", () => {
  it("goes by the birth date, then by the household relationship, and counts a staff login with neither as an adult", () => {
    const today = "2026-10-11";
    expect(isAdultHolder({ date_of_birth: "1984-03-02", household_roles: [] }, today)).toBe(true);
    expect(isAdultHolder({ date_of_birth: "2009-10-12", household_roles: ["primary"] }, today)).toBe(false);
    expect(isAdultHolder({ date_of_birth: null, household_roles: ["child"] }, today)).toBe(false);
    expect(isAdultHolder({ date_of_birth: null, household_roles: ["spouse", "parent"] }, today)).toBe(true);
    expect(isAdultHolder({ date_of_birth: null, household_roles: ["primary", "other"] }, today)).toBe(false);
    expect(isAdultHolder({ date_of_birth: null, household_roles: [] }, today)).toBe(true);
  });
});

describe("whereLabel", () => {
  it("names a screen the way the menu does, and nothing for a screen that does not exist here", () => {
    expect(whereLabel("/settings/roles")).toEqual({ label: "Settings › Roles & entitlements", href: "/settings/roles" });
    expect(whereLabel("/setup/go-live")).toEqual({ label: "Setup › Go-live", href: "/setup/go-live" });
    expect(whereLabel("/nowhere")).toBeNull();
    expect(whereLabel(null)).toBeNull();
  });
});

describe("buildSetupView", () => {
  const row = (over: Partial<ChecklistRowIn>): ChecklistRowIn => ({
    step_key: "x",
    stage: 1,
    sort: 1,
    title: "A step",
    description: null,
    status: "not_started",
    required: true,
    route: null,
    detail: null,
    owner_name: null,
    owner_role: null,
    due_on: null,
    ...over,
  });

  it("counts what is done and lists what is left, required steps first, with a place to fix each", () => {
    const rows = [
      row({ step_key: "a", stage: 0, sort: 1, title: "Legal identity", status: "done", route: "/setup/organization" }),
      row({ step_key: "b", stage: 2, sort: 1, title: "Optional thing", required: false, route: "/settings/roles" }),
      row({ step_key: "c", stage: 1, sort: 1, title: "Connect payments", status: "waiting_on_provider", route: "/settings/payments", owner_name: "Priya Shah", due_on: "2026-10-01" }),
      row({ step_key: "d", stage: 1, sort: 2, title: "Skipped one", status: "skipped" }),
      row({ step_key: "e", stage: 3, sort: 1, title: "Elsewhere", route: "/not/built/yet" }),
    ];
    const v = buildSetupView(rows, [], "2026-10-11");
    expect(v.steps).toEqual({ done: 1, total: 4, percent_done: 25, waiting_on_a_provider: 1, waiting_for_weaver_review: 0, overdue: 1 });
    expect(v.left.map((s) => s.step)).toEqual(["Connect payments", "Elsewhere", "Optional thing"]);
    expect(v.left[0]).toMatchObject({ owner: "Priya Shah", overdue: true, status: "Waiting on a provider", fix_at: { href: "/settings/payments" } });
    // A route this version has no screen for is not offered as a link.
    expect(v.left[1].fix_at).toBeNull();
    expect(v.summary).toContain("1 of 4 setup steps are done (25%); 3 left, 1 past their due date.");
  });

  it("says every go-live check that does not pass, with what is missing and where", () => {
    const v = buildSetupView([], [
      { key: "agreements_accepted", title: "Agreements accepted", ok: false, detail: "The terms of service have not been accepted." },
      { key: "email_domain_verified", title: "Email domain verified", ok: true, detail: "ok" },
    ], "2026-10-11");
    expect(v.go_live_checks.failing).toBe(1);
    expect(v.go_live_checks.failing_list).toEqual([
      { check: "Agreements accepted", what_is_missing: "The terms of service have not been accepted.", owner: "Security", fix_at: { label: "Settings › Agreements", href: "/settings/agreements" } },
    ]);
    expect(v.summary).toContain("1 go-live check does not pass yet.");
    expect(buildSetupView([row({ status: "done" })], [], "2026-10-11").summary).toContain("All 1 setup steps are done.");
  });
});

describe("buildHealthView", () => {
  const base = {
    connections: [] as never[],
    readiness: [],
    emailDomains: [],
    texting: { registrations: [], connection: null, phoneSignIn: true, quietStartHour: 21, quietEndHour: 7 },
  };

  it("says a service that is not connected, and where to connect it", () => {
    const v = buildHealthView(base);
    const qbo = v.services.find((s) => s.service === "QuickBooks Online")!;
    expect(qbo).toMatchObject({ status: "Not connected", working: false, fix_at: { href: "/accounting/qbo/setup" } });
    expect(v.summary).toMatch(/not connected yet/);
  });

  it("says a connected service whose go-live check fails is not ready, with the reason", () => {
    const v = buildHealthView({
      ...base,
      connections: [{ provider: "resend", status: "connected", display_name: "Resend", settings: {}, connected_at: null, token_expires_at: null, last_error: null }],
      readiness: [{ key: "email_domain_verified", title: "Email domain", ok: false, detail: "The sending domain is waiting for DNS." }],
      emailDomains: [{ domain: "jsh.org", status: "pending", last_error: null }],
    });
    const email = v.services.find((s) => s.service === "Email sending domain")!;
    expect(email).toMatchObject({ status: "Connected, but not ready", working: false });
    expect(email.in_words).toContain("waiting for DNS");
    expect(v.email_domains).toEqual([{ domain: "jsh.org", status: "Waiting for DNS", note: "The records to add at the domain's registrar are listed in Settings › Email." }]);
    expect(v.needs_attention).toBe(1);
  });

  it("explains why texts may not go out, from the registration to quiet hours", () => {
    const rejected = buildHealthView({ ...base, texting: { ...base.texting, registrations: [{ kind: "10dlc", status: "rejected", detail: { reviewer_note: "The sample messages do not name the community." } }] } });
    expect(rejected.texting.carrier_status).toBe("Rejected");
    expect(rejected.texting.why_texts_may_not_go_out[0]).toContain("rejected: The sample messages do not name the community.");
    const approved = buildHealthView({ ...base, texting: { ...base.texting, registrations: [{ kind: "10dlc", status: "approved", detail: { from_number: "+16305550100" } }] } });
    expect(approved.texting).toMatchObject({ carrier_status: "Approved", sending_number: "+16305550100", quiet_hours: "9 PM to 7 AM" });
    expect(approved.texting.why_texts_may_not_go_out.join(" ")).not.toMatch(/registration/);
    const none = buildHealthView(base);
    expect(none.texting.why_texts_may_not_go_out[0]).toMatch(/not registered yet/);
  });
});
