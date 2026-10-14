import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The row component calls the classic screens' two server actions and refreshes the page; here nothing is called, only rendered.
vi.mock("server-only", () => ({}));
vi.mock("@/app/(app)/memberships/applications/actions", () => ({ decideApplicationAction: vi.fn() }));
vi.mock("@/app/(app)/people/requests/actions", () => ({ decideHouseholdRequestAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const screen = vi.hoisted(() => ({ runScreenCommand: vi.fn() }));
vi.mock("@/lib/commands/screen", () => screen);

import { InboxError, InboxSection } from "@/components/people-v2/inbox/inbox-section";
import type { PendingReviewsData } from "@/lib/commands/catalog/people/pending-reviews";
import type { HouseholdCard } from "@/lib/commands/types";
import { HIDDEN_APPLICANT, blockedSentence, buildInbox, waitedText, waitingCount, type InboxModel } from "@/lib/people-v2/inbox";
import { loadInbox } from "@/lib/people-v2/inbox-load";
import { NEEDS_REASON, NEEDS_ROLE, decisionFields, flowReducer, initialFlow, type FlowEvent, type InboxFlow } from "@/lib/people-v2/inbox-flow";

import { fakeSession } from "./commands/helpers";

const NOW = "2026-10-13T15:00:00Z";
const card = (id: string, name: string, over: Partial<HouseholdCard> = {}): HouseholdCard => ({
  household_id: id,
  household_name: name,
  household_number: "0301",
  org_household_id: "RCC-H-1102",
  adults: ["Samira Hassan", "Karim Hassan"],
  primary_adult: "Samira Hassan",
  zone: "North Riverside",
  city: "Riverside",
  last_gift_on: null,
  open_pledge_cents: null,
  open_pledge: null,
  ...over,
});

const data = (over: Partial<PendingReviewsData> = {}): PendingReviewsData => ({
  applications: [
    { id: "a1", applicant: "Aarti Rao", tier: "Yearly", step: "waiting for the center review", fee: "$50.00", household: card("h1", "Rao household"), since: "2026-10-04T10:00:00Z", next: "approved", blocked: null },
    { id: "a2", applicant: "田中 花子", tier: "Life", step: "waiting for the center review", fee: null, household: card("h2", "田中 household", { household_number: "0470" }), since: "2026-10-12T10:00:00Z", next: "awaiting_ec", blocked: null },
    { id: "a3", applicant: HIDDEN_APPLICANT, tier: "Life", step: "waiting for the Executive Committee", fee: null, household: null, since: "2026-10-11T10:00:00Z", next: null, blocked: "you already made the center review, so a different Executive Committee member must give the EC approval" },
  ],
  applications_total: 3,
  family_requests: [
    { id: "r1", kind: "Add a family member", summary: "Add Омар Али, asked for as their brother", household: card("h1", "Rao household"), since: "2026-10-09T10:00:00Z", who: "Омар Али", asked: "brother", asked_role: null },
    { id: "r2", kind: "Add a family member", summary: "Add Meera Shah, asked for as their parent", household: card("h3", "Shah household", { household_number: "0212" }), since: "2026-10-05T10:00:00Z", who: "Meera Shah", asked: "parent", asked_role: "parent" },
  ],
  family_requests_total: 3,
  family_requests_for_the_screen: 1,
  ...over,
});

const opts = { now: NOW, timeZone: "America/Chicago", duplicates: { count: 2, href: "/people?view=duplicates" } as InboxModel["duplicates"], applicationsHref: "/memberships/applications", requestsHref: "/people/requests" };
const model = (over: Partial<PendingReviewsData> = {}) => buildInbox(data(over), opts);

describe("the Inbox model", () => {
  it("says how long a row has waited, in whole days and never negative", () => {
    expect(waitedText("2026-10-13T01:00:00Z", NOW)).toBe("sent today");
    expect(waitedText("2026-10-12T10:00:00Z", NOW)).toBe("waiting 1 day");
    expect(waitedText("2026-10-04T10:00:00Z", NOW)).toBe("waiting 9 days");
    expect(waitedText("2026-10-20T10:00:00Z", NOW)).toBe("sent today");
    expect(waitedText("not a date", NOW)).toBe("sent today");
  });

  it("says who a refused approval waits for", () => {
    expect(blockedSentence("you already made the center review, so a different Executive Committee member must give the EC approval")).toBe(
      "Waiting for a different Executive Committee member: you made the center review.",
    );
    expect(blockedSentence("the final approval for this tier is an Executive Committee step")).toBe("Waiting for an Executive Committee member.");
    expect(blockedSentence("the named reference has not approved it yet")).toBe("The named reference has not approved it yet.");
  });

  it("offers Approve when it is final, the center review when the Executive Committee follows, and the reason when it cannot be done", () => {
    const [yearly, life, waiting] = model().applications;
    expect(yearly.approval).toMatchObject({ kind: "approve", label: "Approve", yes: "Yes, approve" });
    expect(yearly.approval.kind === "approve" && yearly.approval.confirm).toBe("Approve Aarti Rao's Yearly membership? It becomes active now and the $50.00 fee is recorded as an open pledge.");
    expect(life.approval).toMatchObject({ kind: "approve", label: "Record center review", yes: "Yes, record it" });
    expect(life.approval.kind === "approve" && life.approval.confirm).toBe("Record the center review for 田中 花子's Life application? It then waits for the Executive Committee.");
    expect(waiting.approval).toEqual({ kind: "blocked", sentence: "Waiting for a different Executive Committee member: you made the center review." });
  });

  it("never names an applicant the role cannot see in a sentence", () => {
    const hidden = model({ applications: [{ ...data().applications[2], next: "approved", blocked: null }] }).applications[0];
    expect(hidden.approval.kind === "approve" && hidden.approval.confirm).toContain("this applicant's Life membership");
    expect(hidden.approval.kind === "approve" && hidden.approval.confirm).not.toContain("can't see's");
  });

  it("shows the household card line and a link to the family, or says the role cannot see the household", () => {
    const [yearly, , waiting] = model().applications;
    expect(yearly).toMatchObject({ cardLine: "No. 0301 · RCC-H-1102 · Samira Hassan & Karim Hassan · Riverside · North Riverside", familyHref: "/households/h1" });
    expect(waiting).toMatchObject({ cardLine: null, familyHref: null });
  });

  it("carries what a request asked for, and preselects only a relationship that exists", () => {
    const [brother, parent] = model().requests;
    expect(brother).toMatchObject({ who: "Омар Али", asked: "brother", askedRole: null, what: "Add Омар Али to the family" });
    expect(parent).toMatchObject({ asked: "parent", askedRole: "parent" });
  });

  it("offers every relationship but primary, in the community's own words", () => {
    expect(model().roles.map((r) => r.value)).toEqual(["spouse", "child", "parent", "sibling", "other"]);
    expect(model().roles.find((r) => r.value === "child")?.label).toBe("Son or daughter");
  });

  it("counts what waits in all, and keeps the totals the command gave", () => {
    const m = model();
    expect(m.applicationsTotal).toBe(3);
    expect(m.requestsTotal).toBe(3);
    expect(m.forScreen).toBe(1);
    expect(waitingCount(m)).toBe(8);
    expect(waitingCount({ applicationsTotal: null, requestsTotal: 0, duplicates: null })).toBe(0);
  });
});

describe("one Inbox row's states", () => {
  const run = (s: InboxFlow, ...events: FlowEvent[]) => events.reduce(flowReducer, s);

  it("asks one inline question, then sends, then is done", () => {
    let s = run(initialFlow(), { type: "approve" });
    expect(s.phase).toBe("approve");
    s = run(s, { type: "send", needsRole: false });
    expect(s).toMatchObject({ phase: "sending", from: "approve", error: null });
    s = run(s, { type: "ok", message: "Approved · Yearly membership is now active." });
    expect(s).toMatchObject({ phase: "done", message: "Approved · Yearly membership is now active." });
    expect(run(s, { type: "decline" }).phase).toBe("done");
  });

  it("will not send a decline without a reason, and then sends the trimmed one", () => {
    let s = run(initialFlow(), { type: "decline" }, { type: "send", needsRole: false });
    expect(s).toMatchObject({ phase: "decline", error: NEEDS_REASON });
    s = run(s, { type: "reason", text: "   " }, { type: "send", needsRole: false });
    expect(s.phase).toBe("decline");
    s = run(s, { type: "reason", text: "  Not a resident  " });
    expect(s.error).toBeNull();
    s = run(s, { type: "send", needsRole: false });
    expect(s.phase).toBe("sending");
    expect(decisionFields("a1", s, false)).toEqual({ id: "a1", decision: "reject", reason: "Not a resident" });
  });

  it("will not approve a family request until a relationship is chosen, and takes the one the member asked for", () => {
    let s = run(initialFlow(), { type: "approve" }, { type: "send", needsRole: true });
    expect(s).toMatchObject({ phase: "approve", error: NEEDS_ROLE });
    s = run(s, { type: "role", role: "sibling" });
    expect(s.error).toBeNull();
    s = run(s, { type: "send", needsRole: true });
    expect(decisionFields("r1", s, true)).toEqual({ id: "r1", decision: "approve", reason: "", role: "sibling" });
    const asked = run(initialFlow("parent"), { type: "approve" }, { type: "send", needsRole: true });
    expect(asked.phase).toBe("sending");
  });

  it("goes back to the form it came from, with everything still typed in, when the server says no", () => {
    let s = run(initialFlow(), { type: "decline" }, { type: "reason", text: "Duplicate of an older application" }, { type: "send", needsRole: false });
    s = run(s, { type: "fail", error: "Could not decline the application — it changed while you were looking. Reload and try again." });
    expect(s).toMatchObject({ phase: "decline", reason: "Duplicate of an older application", error: expect.stringContaining("changed while you were looking") });
    let a = run(initialFlow("parent"), { type: "approve" }, { type: "send", needsRole: true }, { type: "fail", error: "No." });
    expect(a).toMatchObject({ phase: "approve", role: "parent", error: "No." });
    a = run(a, { type: "send", needsRole: true });
    expect(a).toMatchObject({ phase: "sending", error: null });
  });

  it("ignores everything but the answer while it is sending, and cancelling clears the reason and the error", () => {
    const sending = run(initialFlow(), { type: "approve" }, { type: "send", needsRole: false });
    expect(run(sending, { type: "decline" })).toBe(sending);
    expect(run(sending, { type: "cancel" })).toBe(sending);
    const typed = run(initialFlow("parent"), { type: "decline" }, { type: "reason", text: "x" }, { type: "cancel" });
    expect(typed).toMatchObject({ phase: "idle", reason: "", error: null, role: "parent" });
  });

  it("sends no relationship with an application, and none with a decline", () => {
    const approving = run(initialFlow("parent"), { type: "approve" }, { type: "send", needsRole: false });
    expect(decisionFields("a1", approving, false)).toEqual({ id: "a1", decision: "approve", reason: "" });
    const declining = run(initialFlow("parent"), { type: "decline" }, { type: "reason", text: "no" }, { type: "send", needsRole: true });
    expect(decisionFields("r1", declining, true)).toEqual({ id: "r1", decision: "reject", reason: "no" });
  });
});

describe("the Inbox as drawn", () => {
  const html = (m: InboxModel) => renderToStaticMarkup(createElement(InboxSection, { model: m }));

  it("shows who, what, since when, the household card and the actions on each row", () => {
    const out = html(model());
    expect(out).toContain("Aarti Rao");
    expect(out).toContain("Yearly membership · fee $50.00");
    expect(out).toContain("Since Oct 4, 2026");
    expect(out).toContain("waiting 9 days");
    expect(out).toContain("No. 0301 · RCC-H-1102");
    expect(out).toContain('href="/households/h1"');
    expect(out).toContain(">Approve<");
    expect(out).toContain(">Decline<");
    expect(out).toContain("Record center review");
    expect(out).toContain("8 waiting");
  });

  it("works for names in other scripts", () => {
    const out = html(model());
    expect(out).toContain("田中 花子");
    expect(out).toContain("Add Омар Али to the family");
    expect(out).toContain("Asked for as their brother");
  });

  it("shows the relationship chips on a request, with the asked-for one selected", () => {
    const out = html(model());
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain("Son or daughter");
    expect(out).toMatch(/aria-checked="true"[^>]*>Parent</);
  });

  it("says who a blocked row is waiting for, in place of an Approve button", () => {
    const only = html(model({ applications: [data().applications[2]], applications_total: 1, family_requests: [], family_requests_total: 0, family_requests_for_the_screen: 0 }));
    expect(only).toContain("Waiting for a different Executive Committee member: you made the center review.");
    expect(only).toContain("No household card: your role cannot see this household.");
    expect(only).not.toContain(">Approve<");
    expect(only).toContain(">Decline<");
  });

  it("points to the screens for what the list does not hold, and for requests that mention a child", () => {
    const out = html(model({ applications_total: 20 }));
    expect(out).toContain("Showing the oldest 3 of 20");
    expect(out).toContain('href="/memberships/applications"');
    expect(out).toContain("1 more request is");
    expect(out).toContain("they mention a child");
  });

  it("hides applications for a role that cannot see them, and says so", () => {
    const out = html(model({ applications: [], applications_total: null, note: "Your role cannot see membership applications, so only family requests are listed." }));
    expect(out).not.toContain("Membership applications");
    expect(out).toContain("Your role cannot see membership applications");
  });

  it("says plainly when nothing waits, and when the duplicates could not be counted", () => {
    const empty = buildInbox(data({ applications: [], applications_total: 0, family_requests: [], family_requests_total: 0, family_requests_for_the_screen: 0 }), { ...opts, duplicates: { count: 0, href: "/people?view=duplicates" } });
    const out = html(empty);
    expect(out).toContain("No applications are waiting.");
    expect(out).toContain("No family requests are waiting.");
    expect(out).toContain("Nothing is waiting for a decision.");
    expect(html({ ...empty, duplicates: { count: null, href: "/people?view=duplicates" } })).toContain("Could not be counted just now.");
  });

  it("says what could not be read, with a way to try again", () => {
    const out = renderToStaticMarkup(createElement(InboxError, { message: "Could not read the family change requests." }));
    expect(out).toContain("Could not load what is waiting for a decision.");
    expect(out).toContain("Could not read the family change requests.");
    expect(out).toContain('href="/people"');
  });
});

describe("loading the Inbox", () => {
  const dup = { count: 1, href: "/people?view=duplicates" };
  beforeEach(() => screen.runScreenCommand.mockReset());

  it("is left out for a role that cannot see applications or requests, so the home keeps its counts", async () => {
    const r = await loadInbox(fakeSession({ permissions: ["events.view"] }), dup);
    expect(r).toBeNull();
    expect(screen.runScreenCommand).not.toHaveBeenCalled();
  });

  it("reads what is waiting with the screen path and builds the rows", async () => {
    screen.runScreenCommand.mockResolvedValue({ ok: true, data: data() });
    const r = await loadInbox(fakeSession({ permissions: ["people.view"] }), dup);
    expect(screen.runScreenCommand).toHaveBeenCalledWith("people.pending_reviews", {}, "load what is waiting for a decision");
    expect(r && r.ok && r.model.applications).toHaveLength(3);
    expect(r && r.ok && r.model.duplicates).toEqual(dup);
  });

  it("says why it could not read, never an empty list", async () => {
    screen.runScreenCommand.mockResolvedValue({ ok: false, error: "Could not read the family change requests — the connection dropped." });
    expect(await loadInbox(fakeSession({ permissions: ["people.view"] }), dup)).toEqual({ ok: false, error: "Could not read the family change requests — the connection dropped." });
    screen.runScreenCommand.mockResolvedValue({ ok: true });
    expect(await loadInbox(fakeSession({ permissions: ["people.view"] }), dup)).toMatchObject({ ok: false, error: expect.stringContaining("answer was empty") });
  });
});
