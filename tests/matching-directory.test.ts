import { describe, expect, it } from "vitest";

// CatchTheMatch slice 2 (migrations 0765-0767): the shared employer-program directory's words, form reader and decisions, and
// where Gift matching shows. The database checks every rule again (test 166); these keep the screens honest.

import { givingTabs, type TabContext } from "@/lib/giving-today/tabs";
import { decisionFromForm, decisionMessage } from "@/lib/matching/decision";
import {
  deadlineText,
  factsAsRow,
  forwardReasonText,
  linkDomain,
  parseRatio,
  parseSearch,
  programFromForm,
  ratioInput,
  ratioText,
  religiousSentence,
  verifiedText,
} from "@/lib/matching/directory";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";

function form(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

const deadline = { deadline_kind: null, deadline_months: null, deadline_month: null, deadline_day: null };

describe("the words", () => {
  it("say the ratio as people do and read it back", () => {
    expect(ratioText(10000)).toBe("1:1 (1 for every 1 given)");
    expect(ratioText(5000)).toBe("0.5:1 (0.5 for every 1 given)");
    expect(ratioText(20000)).toBe("2:1 (2 for every 1 given)");
    expect(ratioText(null)).toBe("Not known yet");
    expect(parseRatio("1")).toBe(10000);
    expect(parseRatio("0.5")).toBe(5000);
    expect(parseRatio("2:1")).toBe(20000);
    expect(parseRatio("0.25")).toBe(2500);
    expect(parseRatio("11")).toBeNull();
    expect(parseRatio("half")).toBeNull();
    expect(ratioInput(12500)).toBe("1.25");
  });

  it("say when to ask", () => {
    expect(deadlineText({ ...deadline, deadline_kind: "end_of_gift_year" })).toBe("By December 31 of the year of the gift");
    expect(deadlineText({ ...deadline, deadline_kind: "months_after_gift", deadline_months: 1 })).toBe("Within 1 month of the gift");
    expect(deadlineText({ ...deadline, deadline_kind: "months_after_gift", deadline_months: 12 })).toBe("Within 12 months of the gift");
    expect(deadlineText({ ...deadline, deadline_kind: "date_next_year", deadline_month: 1, deadline_day: 31 })).toBe("By January 31 of the year after the gift");
    expect(deadlineText(deadline)).toBe("Not known yet");
  });

  it("say plainly whether religious organizations qualify, so members know before they ask", () => {
    expect(religiousSentence("eligible")).toMatch(/^Religious organizations qualify/);
    expect(religiousSentence("non_worship_only")).toMatch(/only for programs that are not worship/);
    expect(religiousSentence("excluded")).toBe("Religious organizations do not qualify.");
    expect(religiousSentence(null)).toMatch(/^Not known yet/);
  });

  it("show the site a link goes to", () => {
    expect(linkDomain("https://www.acme.example/giving?x=1")).toBe("acme.example");
    expect(linkDomain("https://acme.benevity.example/match")).toBe("acme.benevity.example");
    expect(linkDomain("not a link")).toBe("");
    expect(linkDomain(null)).toBe("");
  });

  it("say who checked the facts, never naming another community", () => {
    expect(verifiedText({ kind: "weaver", on: "2026-10-01" })).toBe("Checked by Weaver's team on Oct 1, 2026");
    expect(verifiedText({ kind: "community", on: "2026-10-01" })).toBe("Verified by a community on Oct 1, 2026");
    expect(verifiedText({ kind: "community", on: "2026-10-01", ownCommunity: true })).toBe("Verified by your community on Oct 1, 2026");
    expect(verifiedText({ kind: null, on: null })).toBe("Not checked yet");
  });
});

describe("the form", () => {
  const base = { company_name: "  Acme   Corp ", gift_match: "on", source: "employer_site", verified_on: "2026-10-01" };

  it("reads the facts, drops what does not apply, and keeps each other name once", () => {
    const r = programFromForm(
      form({
        ...base,
        names: ["ACME", "acme", "アクメ", "", "Acme Corp"].join("\n"),
        country: "us",
        ratio: "0.5",
        min_gift: "25",
        max_gift: "1,000.00",
        gift_types: ["one_time", "stock", "bogus"],
        org_kinds: ["any_charity"],
        religious_orgs: "non_worship_only",
        deadline_kind: "months_after_gift",
        deadline_months: "12",
        deadline_month: "3",
        volunteer_per_hour: "10",
      }),
      "weaver",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.facts).toMatchObject({
      company_name: "Acme Corp",
      names: ["ACME", "アクメ"],
      country: "US",
      currency: "USD",
      match_ratio_bp: 5000,
      min_gift_cents: 2500,
      max_gift_cents: 100000,
      gift_types: ["one_time", "stock"],
      religious_orgs: "non_worship_only",
      deadline_kind: "months_after_gift",
      deadline_months: 12,
      deadline_month: null,
      volunteer_grant: false,
      volunteer_cents_per_hour: null,
      source: "employer_site",
      verified_on: "2026-10-01",
    });
  });

  it("drops the gift rules of a volunteer-only program", () => {
    const r = programFromForm(form({ company_name: "Globex", volunteer_grant: "on", ratio: "2", max_year: "500", volunteer_per_hour: "10", volunteer_min_hours: "20" }), "community");
    expect(r.ok && r.facts).toMatchObject({ gift_match: false, volunteer_grant: true, match_ratio_bp: null, max_year_cents: null, volunteer_cents_per_hour: 1000, volunteer_min_hours: 20, source: null });
  });

  it("says what is wrong in plain English", () => {
    const err = (entries: Record<string, string | string[]>, context: "weaver" | "community" = "community") => {
      const r = programFromForm(form(entries), context);
      return r.ok ? null : r.error;
    };
    expect(err({ gift_match: "on" })).toBe("Enter the company's name.");
    expect(err({ company_name: "X" })).toMatch(/^Say what the program does/);
    expect(err({ company_name: "X", gift_match: "on", ratio: "twice" })).toMatch(/^The match ratio is what the employer gives/);
    expect(err({ company_name: "X", gift_match: "on", min_gift: "500", max_gift: "100" })).toBe("The minimum gift is more than the maximum matched per gift.");
    expect(err({ company_name: "X", gift_match: "on", deadline_kind: "date_next_year", deadline_month: "2", deadline_day: "30" })).toBe("The deadline is not a real date (February 30).");
    expect(err({ company_name: "X", gift_match: "on", portal_url: "http://acme.example" })).toBe("The portal's link must be a full web address that starts with https://.");
    expect(err({ company_name: "X", gift_match: "on", country: "USA" })).toMatch(/two-letter code/);
    expect(err({ company_name: "X", gift_match: "on" }, "weaver")).toBe("Say where the facts come from.");
    expect(err({ company_name: "X", gift_match: "on", deadline_kind: "months_after_gift" })).toMatch(/^Say how many months/);
    expect(err({ company_name: "X", gift_match: "on", source: "partner" })).toBe("Only Weaver's team can name a licensed matching-gift database as the source.");
    expect(err({ company_name: "X", gift_match: "on", source: "partner", verified_on: "2026-10-01" }, "weaver")).toBeNull();
  });

  it("reads a submission's facts back for the screens", () => {
    const row = factsAsRow({ company_name: "Initech", names: ["INTC"], match_ratio_bp: 10000, gift_types: ["one_time", 3], gift_match: true });
    expect(row).toMatchObject({ company_name: "Initech", names: ["INTC"], match_ratio_bp: 10000, gift_types: ["one_time"], currency: "USD", source: "submission" });
    expect(factsAsRow(null, "Fallback").company_name).toBe("Fallback");
    expect(parseSearch({ total: 2, rows: [{ id: "a", company_name: "A" }, null] })).toMatchObject({ total: 2, rows: [{ id: "a" }] });
  });
});

describe("a decision", () => {
  const id = "16600000-0000-4000-8000-0000000000e1";
  const entry = "16600000-0000-4000-8000-0000000000e2";

  it("needs a reason to reject", () => {
    expect(decisionFromForm(form({ submission_id: id, decision: "reject" }))).toEqual({ ok: false, error: "say why it is rejected. The community that sent it sees the reason." });
    expect(decisionFromForm(form({ submission_id: id, decision: "reject", reason: "No such program" }))).toEqual({
      ok: true,
      args: { p_submission: id, p_decision: "reject", p_reason: "No such program" },
    });
  });

  it("marks a duplicate of an entry or of another submission", () => {
    const d = decisionFromForm(form({ submission_id: id, decision: "duplicate", duplicate_of: `entry:${entry}` }));
    expect(d.ok && d.args).toMatchObject({ p_decision: "duplicate", p_into_program: entry, p_into_submission: undefined });
    const s = decisionFromForm(form({ submission_id: id, decision: "duplicate", duplicate_of: `submission:${entry}` }));
    expect(s.ok && s.args).toMatchObject({ p_into_submission: entry, p_into_program: undefined });
    expect(decisionFromForm(form({ submission_id: id, decision: "duplicate", duplicate_of: "" })).ok).toBe(false);
  });

  it("approves the facts as edited", () => {
    const a = decisionFromForm(form({ submission_id: id, decision: "approve", company_name: "Initech", gift_match: "on", ratio: "1", source: "submission" }));
    expect(a.ok && a.args).toMatchObject({ p_decision: "approve", p_program: { company_name: "Initech", match_ratio_bp: 10000, source: "submission" } });
    expect(decisionFromForm(form({ submission_id: "x", decision: "approve" })).ok).toBe(false);
  });

  it("tells the community when its approval went to Weaver's team, and why", () => {
    expect(decisionMessage("forwarded", "community")).toMatch(/^Sent to Weaver's team/);
    expect(decisionMessage("forwarded", "community", "links_changed")).toMatch(/Weaver's team checks every link/);
    expect(decisionMessage("forwarded", "community", "other_community")).toMatch(/another community verified this entry/);
    expect(forwardReasonText("paused")).toMatch(/paused publishing/);
    expect(forwardReasonText("bogus")).toBe("Weaver's team decides it");
    expect(decisionMessage("approved", "community")).toMatch(/verified by your community/);
    expect(decisionMessage("approved", "weaver")).toMatch(/checked by Weaver's team/);
  });
});

describe("where Gift matching shows", () => {
  const nav = (permissions: string[], o: { isPlatformAdmin?: boolean; modulesOff?: string[] } = {}) =>
    visibleNav({ permissions, isPlatformAdmin: o.isPlatformAdmin ?? false, modulesOff: o.modulesOff ?? [] }).flatMap((m) => m.tabs.map((t) => t.href));

  it("is a Giving tab for CatchTheMatch's own roles, with the product on", () => {
    expect(nav(["matching.view"])).toContain("/giving/matching");
    expect(nav(["matching.manage", "giving.view"])).toContain("/giving/matching");
    expect(nav(["matching.view"], { modulesOff: ["matching"] })).not.toContain("/giving/matching");
    expect(nav(["giving.manage", "giving.view"])).not.toContain("/giving/matching");
  });

  it("is never opened to a platform admin as such; Weaver's team has the platform directory instead", () => {
    const weaver = nav([], { isPlatformAdmin: true });
    expect(weaver).not.toContain("/giving/matching");
    expect(weaver).toContain("/platform/matching");
    expect(nav(["matching.manage"])).not.toContain("/platform/matching");
  });

  it("is in the New look's Giving row for its readers", () => {
    const ctx = (permissions: string[]): TabContext => ({ permissions, isPlatformAdmin: false, modulesOff: ["bolis"], kind: NEUTRAL_KIND });
    expect(givingTabs(ctx(["matching.view"])).map((t) => t.key)).toContain("matching");
    expect(givingTabs(ctx(["giving.view", "giving.manage"])).map((t) => t.key)).not.toContain("matching");
  });
});
