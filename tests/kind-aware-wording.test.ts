import { beforeEach, describe, expect, it, vi } from "vitest";

// The helpers added with the admin redesign (Niva's example sentences and prompt, the routines, the learning commands, the media library,
// the rail, the reports) used to speak as if every organization were a Jain temple in the United States. They now read the organization's
// kind, its currency and its country. Every case here is worked out for a Jain temple, a church, a mosque and a chamber of commerce,
// and for dollars, rupees and pounds.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { allSuggestionTexts, contextLine, suggestionsFor, suggestionWords } from "@/lib/assistant/context";
import { kindSentence, moneyRule, systemPrompt } from "@/lib/assistant/prompt";
import { CONTENT_COMMANDS } from "@/lib/commands/catalog/content";
import { LEARNING_COMMANDS } from "@/lib/commands/catalog/learning";
import { buildMediaLibrary } from "@/lib/commands/catalog/content/pure";
import { runCommand } from "@/lib/commands/run";
import { describe as describeText } from "@/lib/commands/text";
import {
  communityFormat,
  compactMoney,
  currencyPhrase,
  currencySymbol,
  moneyExample,
  moneyIn,
  numberIn,
  regionLocale,
  regionalWorkWeek,
  weekdayName,
  workWeekFor,
} from "@/lib/community-format";
import { mediaKindLabel, mediaKindsPhrase, principalTitle, sample, schoolOrGeneric, schoolWord } from "@/lib/kind-samples";
import { formatCents } from "@/lib/money";
import { briefingSentence, buildBriefing } from "@/lib/routines/briefing";
import { todayLabel } from "@/lib/routines/clock";
import { COUNTERS, RECIPES, routineWords, startingRoleNames, textOf } from "@/lib/routines/recipes";
import { resolveRoutine } from "@/lib/routines/resolve";
import { workspaceLabel, workspacesFor } from "@/lib/workspaces";

import { CHAMBER, CHURCH, GBP, INR, JAIN, KINDS, MOSQUE, USD } from "./fixtures/kinds";
import { asPrincipal, learningWorld } from "./commands/learning-world";
import { FRIDAY, MONDAY, TUESDAY, facts, viewer } from "./routines/fixtures";

const ALL_KINDS = [
  ["a Jain temple", JAIN],
  ["a church", CHURCH],
  ["a mosque", MOSQUE],
  ["a chamber of commerce", CHAMBER],
] as const;

const NOT_JAIN = [
  ["a church", CHURCH],
  ["a mosque", MOSQUE],
  ["a chamber of commerce", CHAMBER],
] as const;

/** Every word of Jain or temple origin, and the dollar sign: none may reach an organization that is not a Jain temple. */
const JAIN_AND_US = /diwali|samosa|stavan|pathshala|jainism|gyan|satvik|derasar|\bjsh\b|paryushan|\$/i;

const ALL_KEYS = new Set([
  "people.search", "people.find_household", "people.pending_reviews", "people.suggest_duplicates", "people.household_summary", "people.add_person", "people.update_person",
  "giving.pledges_behind", "giving.draft_payment", "giving.zelle_waiting", "giving.bank_lines_unmatched", "giving.waiting_for_second_approver", "giving.household_summary",
  "accounting.month_close_blockers", "events.upcoming", "events.clone_draft", "events.summary", "events.readiness", "events.audience_preview", "events.set_field",
  "messages.draft_reminder", "messages.inbox_triage", "messages.campaigns", "messages.audience_preview", "messages.why_not_delivered", "messages.draft_reply",
  "content.approval_queue", "content.niva_sources", "content.media_library", "content.draft_item",
  "store.orders_waiting", "store.set_order_status", "store.low_stock", "store.sales_summary", "store.draft_product", "store.adjust_stock",
  "learning.classes_needing_teachers", "learning.waiting_counts", "learning.term_setup", "learning.registration_checklist", "learning.fee_report", "learning.draft_term_change",
  "platform.waiting", "platform.community_summary", "platform.preview_kind_change", "tasks.mine",
]);

// ---------------------------------------------------------------------------
describe("how a community writes money, numbers and days", () => {
  it("takes the convention from its country and its currency from its own row", () => {
    expect(regionLocale("US")).toBe("en-US");
    expect(regionLocale("in")).toBe("en-IN");
    expect(regionLocale("GB")).toBe("en-GB");
    // no usable country: the generic English convention, never a failure
    expect(regionLocale(null)).toBe("en-US");
    expect(regionLocale("United States")).toBe("en-US");
    expect(communityFormat({ currency: "inr", country: "IN" })).toEqual(INR);
    expect(communityFormat({ currency: "GBP", country: "GB" })).toEqual(GBP);
    expect(communityFormat({ currency: "USD", country: "US" })).toEqual(USD);
  });

  it("writes the same amount in the community's currency and its grouping", () => {
    expect(moneyIn(125_000_000, USD)).toBe("$1,250,000.00");
    expect(moneyIn(125_000_000, GBP)).toBe("£1,250,000.00");
    expect(moneyIn(125_000_000, INR)).toBe("₹12,50,000.00");
    // the portal's own writer is unchanged for anyone who does not pass a convention
    expect(formatCents(125_000)).toBe("$1,250.00");
    expect(formatCents(125_000, "GBP")).toBe("£1,250.00");
    expect(formatCents(null, "INR")).toBe("—");
    expect(formatCents(-5_050, "INR", "en-IN")).toBe("-₹50.50");
  });

  it("writes round examples and the symbol without assuming a dollar", () => {
    expect(moneyExample(25_000, USD)).toBe("$250");
    expect(moneyExample(25_000, INR)).toBe("₹250");
    expect(moneyExample(25_000, GBP)).toBe("£250");
    expect(moneyExample(850, GBP)).toBe("£8.50");
    expect([USD, INR, GBP].map(currencySymbol)).toEqual(["$", "₹", "£"]);
    expect(currencyPhrase("inr")).toBe("the community's currency (INR)");
    expect(currencyPhrase(null)).toBe("the community's currency");
  });

  it("shortens big amounts the way the community counts (a lakh is a lakh)", () => {
    expect(compactMoney(412_000_000, USD)).toBe("$4.12M");
    // Britain writes the short form with a small m
    expect(compactMoney(412_000_000, GBP)).toBe("£4.12m");
    expect(compactMoney(412_000_000, INR)).toMatch(/^₹41(\.\d+)?L$/);
    expect(compactMoney(2_500_000, USD)).toBe("$25K");
    expect(compactMoney(500_000, INR)).toBe("₹5,000");
    expect(compactMoney(123_456, GBP)).toBe("£1,234.56");
  });

  it("groups numbers and names days in the community's convention", () => {
    expect(numberIn(125_000, "en-US")).toBe("125,000");
    expect(numberIn(125_000, "en-IN")).toBe("1,25,000");
    expect(todayLabel("America/New_York", new Date("2026-10-10T15:00:00Z"))).toBe("Saturday, October 10");
    expect(todayLabel("Europe/London", new Date("2026-10-10T15:00:00Z"), "en-GB")).toBe("Saturday 10 October");
    expect(weekdayName(1, "en-US")).toBe("Monday");
  });

  it("works out the working week from the country, and lets the community's own settings win", () => {
    expect(regionalWorkWeek("en-US")).toEqual({ start: 1, end: 5 });
    expect(regionalWorkWeek("en-GB")).toEqual({ start: 1, end: 5 });
    // a week with Friday and Saturday off runs Sunday to Thursday
    expect(regionalWorkWeek("en-IL")).toEqual({ start: 0, end: 4 });
    expect(workWeekFor("en-US", { routines: { week_start: 0, week_end: 4 } })).toEqual({ start: 0, end: 4 });
    expect(workWeekFor("en-US", { routines: { week_start: 9 } })).toEqual({ start: 1, end: 5 });
    expect(workWeekFor("en-US", undefined)).toEqual({ start: 1, end: 5 });
  });
});

// ---------------------------------------------------------------------------
describe("the examples every kind uses", () => {
  it("are a tradition's own only for a kind that keeps one", () => {
    expect(sample(JAIN, "festival_event")).toBe("Diwali Dinner");
    expect(sample(JAIN, "level_example")).toBe("Jainism 2");
    for (const [name, kind] of NOT_JAIN) {
      expect(sample(kind, "festival_event"), name).toBe("Annual Gala");
      expect(sample(kind, "store_item"), name).toBe("T-shirt");
      expect(sample(kind, "level_example"), name).toBe("Level 2");
    }
    // pledges in a faith community, dues and pledges in a chamber
    expect(sample(CHURCH, "pledges")).toBe("pledges");
    expect(sample(CHAMBER, "pledges")).toBe("dues and pledges");
  });

  it("can be named by the kind's own data with no code change", () => {
    const own = { ...CHAMBER, terms: { ...CHAMBER.terms, festival_event: "Business Expo", pledges: "dues" } };
    expect(sample(own, "festival_event")).toBe("Business Expo");
    expect(sample(own, "pledges")).toBe("dues");
  });

  it("name each kind's school from its own data, and none where the kind has none", () => {
    expect(schoolWord(JAIN)).toBe("Pathshala");
    expect(schoolWord(CHURCH)).toBe("Sunday school");
    expect(schoolWord(MOSQUE)).toBe("Weekend school");
    expect(schoolWord(CHAMBER)).toBeNull();
    expect(schoolOrGeneric(CHAMBER)).toBe("school");
    expect(principalTitle(CHURCH)).toBe("Sunday school principal");
    expect(principalTitle(CHAMBER)).toBe("School principal");
  });
});

// ---------------------------------------------------------------------------
describe("Niva's example sentences", () => {
  const forKind = (kind: (typeof KINDS)[keyof typeof KINDS], fmt: { currency: string; locale: string }, plugins: string[] | null) => ({
    kind,
    currency: fmt.currency,
    locale: fmt.locale,
    paymentPlugins: plugins,
  });

  it("read as before for a Jain temple that writes dollars and takes checks and Zelle", () => {
    const ctx = forKind(JAIN, USD, ["zelle", "check"]);
    expect(suggestionsFor("/giving/payments", undefined, ALL_KEYS, ctx)).toEqual([
      "Who is behind on pledges?",
      "Record a $250 check from member number 1042",
      "Which Zelle reports are waiting for the bank?",
    ]);
    expect(suggestionsFor("/events", undefined, ALL_KEYS, ctx)).toContain("Copy last year's Diwali Dinner to November 8 as a draft");
    expect(suggestionsFor("/content/media", undefined, ALL_KEYS, ctx)[0]).toBe("How many stavans, videos and podcasts are in the media library?");
    expect(suggestionsFor("/pathshala/levels", undefined, ALL_KEYS, ctx)).toEqual(["Which levels have no fee set for the term?", "What would a fee of $135 for Jainism 2 change?"]);
  });

  it("use the community's currency and the paper payment its country calls by that name", () => {
    expect(suggestionsFor("/giving/payments", undefined, ALL_KEYS, forKind(CHURCH, GBP, ["check"]))).toEqual([
      "Who is behind on pledges?",
      "Record a £250 cheque from member number 1042",
      "Which bank lines are still unmatched?",
    ]);
    expect(suggestionsFor("/giving/payments", undefined, ALL_KEYS, forKind(MOSQUE, INR, ["cash"]))[1]).toBe("Record a ₹250 cash from member number 1042");
    expect(suggestionsFor("/giving/payments", undefined, ALL_KEYS, forKind(CHAMBER, USD, []))).toEqual([
      "Who is behind on dues and pledges?",
      "Record a $250 payment from member number 1042",
      "Which bank lines are still unmatched?",
    ]);
  });

  it("do not name a payment way, an amount or a currency that is not known", () => {
    // payment ways not read: no Zelle, no check
    const unknownWays = suggestionsFor("/giving/payments", undefined, ALL_KEYS, { kind: JAIN, currency: "USD", locale: "en-US", paymentPlugins: null });
    expect(unknownWays.join(" ")).not.toMatch(/zelle/i);
    expect(unknownWays[1]).toBe("Record a $250 payment from member number 1042");
    // no currency: no amount at all
    expect(suggestionsFor("/giving/payments", undefined, ALL_KEYS, { kind: JAIN })[1]).toBe("Record a payment from member number 1042");
    expect(suggestionsFor("/pathshala/levels", undefined, ALL_KEYS, { kind: JAIN })).toEqual(["Which levels have no fee set for the term?", "What would a new fee for Jainism 2 change?"]);
  });

  it.each(NOT_JAIN)("never speak of a Jain temple, a Jain festival or a dollar to %s", (_name, kind) => {
    for (const fmt of [USD, INR, GBP]) {
      const texts = allSuggestionTexts({ kind, currency: fmt.currency, locale: fmt.locale, paymentPlugins: ["check", "cash"], communitySlug: "houston" });
      expect(texts.length).toBeGreaterThan(40);
      if (fmt !== USD) for (const t of texts) expect(t, `${fmt.currency}: ${t}`).not.toMatch(/\$/);
      // a school sentence only names the kind's own school
      for (const t of texts) expect(t, t).not.toMatch(/diwali|samosa|stavan|pathshala|jainism|gyan|satvik|derasar|\bjsh\b|paryushan/i);
    }
    // with no context at all (an older server) nothing is guessed
    for (const t of allSuggestionTexts({ kind })) expect(t, t).not.toMatch(JAIN_AND_US);
    for (const t of allSuggestionTexts()) expect(t, t).not.toMatch(JAIN_AND_US);
  });

  it("name a payment way only when the community has switched it on", () => {
    const withZelle = allSuggestionTexts({ kind: CHURCH, paymentPlugins: ["zelle"] });
    expect(withZelle.some((t) => /Zelle/.test(t))).toBe(true);
    expect(allSuggestionTexts({ kind: CHURCH, paymentPlugins: ["card"] }).some((t) => /Zelle/.test(t))).toBe(false);
    expect(allSuggestionTexts({ kind: CHURCH, paymentPlugins: null }).some((t) => /Zelle/.test(t))).toBe(false);
  });

  it("offer the accounting sentence only to a community that has accounting", () => {
    const sentence = "Find the household with QuickBooks customer 2217";
    expect(allSuggestionTexts({ kind: CHAMBER })).toContain(sentence);
    expect(allSuggestionTexts({ kind: CHAMBER, modulesOff: ["accounting"] })).not.toContain(sentence);
  });

  it("use the kind's own school in the learning sentences, and offer none where the kind has no school", () => {
    expect(suggestionsFor("/pathshala", undefined, ALL_KEYS, { kind: CHURCH })).toEqual(["Which classes have no teacher yet, and who could teach them?", "How many Sunday school tasks are waiting?"]);
    expect(suggestionsFor("/pathshala", undefined, ALL_KEYS, { kind: MOSQUE })[1]).toBe("How many Weekend school tasks are waiting?");
    // a chamber has no school: the learning examples are not offered, the general ones are
    expect(suggestionsFor("/pathshala", undefined, ALL_KEYS, { kind: CHAMBER })).toEqual(["What is waiting for me?", "What events are coming up?", "Who is behind on dues and pledges?"]);
    expect(suggestionsFor("/pathshala", undefined, ALL_KEYS, { kind: CHURCH, modulesOff: ["pathshala"] })[0]).toBe("What is waiting for me?");
  });

  it("word the media library by the kind's own songs", () => {
    expect(suggestionsFor("/content/media", undefined, ALL_KEYS, { kind: CHURCH })[0]).toBe("How many songs, videos and podcasts are in the media library?");
  });

  it("name the community the Weaver team is looking at, never a fixed one", () => {
    expect(suggestionsFor("/platform", undefined, ALL_KEYS, { communitySlug: "riverside" })[2]).toBe("Summarise the community with address riverside");
    expect(suggestionsFor("/platform", undefined, ALL_KEYS, {}).join(" ")).not.toMatch(/with address/);
    expect(suggestionWords({ communitySlug: "  " }).slug).toBeNull();
  });

  it("say the rail's word for giving, learning and the store on the context line", () => {
    expect(contextLine({ path: "/pathshala" })).toBe("Looking at Learning");
    expect(contextLine({ path: "/pathshala" }, JAIN)).toBe("Looking at Pathshala");
    expect(contextLine({ path: "/pathshala" }, CHURCH)).toBe("Looking at Sunday school");
    expect(contextLine({ path: "/giving/payments" }, CHAMBER)).toBe("Looking at Pay");
    expect(contextLine({ path: "/giving/payments" }, JAIN)).toBe("Looking at Giving");
    expect(contextLine({ path: "/settings/roles" }, CHAMBER)).toBe("Looking at Settings");
  });
});

// ---------------------------------------------------------------------------
describe("what the model is told", () => {
  it.each([
    ["USD", "en-US", "$1,250.00"],
    ["INR", "en-IN", "₹1,250.00"],
    ["GBP", "en-GB", "£1,250.00"],
  ])("shows money in the community's currency (%s)", (currency, locale, shown) => {
    const rule = moneyRule(currency, locale);
    expect(rule).toContain(`the community's currency (${currency})`);
    expect(rule).toContain(shown);
    expect(rule).not.toMatch(/dollar/i);
    const prompt = systemPrompt({ centerName: "Riverside", currency, locale, roles: [], today: "2026-10-10", timeZone: "UTC" });
    expect(prompt).toContain(`the community's currency (${currency})`);
    expect(prompt).not.toContain("{money}");
  });

  it("does not name a currency it was not given", () => {
    expect(moneyRule(undefined)).toBe("Money is shown in the community's currency, never in cents or other minor units.");
  });

  it.each(ALL_KINDS)("tells the model what kind %s is and the words it uses", (_name, kind) => {
    const sentence = kindSentence(kind);
    expect(sentence).toContain("This community is ");
    const school = schoolWord(kind);
    if (school) expect(sentence).toContain(`its school is called "${school}"`);
    else expect(sentence).not.toMatch(/school/);
    if (kind !== JAIN) expect(sentence).not.toMatch(JAIN_AND_US);
  });
});

// ---------------------------------------------------------------------------
describe("the routines", () => {
  it.each(ALL_KINDS)("name the school's principal in the words of the kind (%s)", (_name, kind) => {
    const principal = resolveRoutine(viewer(["pathshala_principal"], { kind }), facts());
    if (schoolWord(kind)) {
      expect(principal.roles[0].title).toBe(`${schoolWord(kind)} principal`);
      expect(principal.groups.flatMap((g) => g.steps).length).toBeGreaterThan(0);
    } else {
      // no school in this kind: no role title that names one, and no step for it even if the module were left on
      expect(principal.groups).toEqual([]);
    }
  });

  it("skip the learning steps in a kind that does not offer the module, and in a community that switched it off", () => {
    const keys = (r: ReturnType<typeof resolveRoutine>) => r.groups.flatMap((g) => g.steps).map((s) => s.key);
    expect(keys(resolveRoutine(viewer(["pathshala_principal"], { kind: CHURCH }), facts()))).toContain("pathshala.placements");
    expect(keys(resolveRoutine(viewer(["pathshala_principal"], { kind: CHURCH, modulesOff: ["pathshala"] }), facts()))).toEqual([]);
    expect(keys(resolveRoutine(viewer(["pathshala_principal"], { kind: CHAMBER }), facts()))).toEqual([]);
  });

  it("say which routines a kind starts with, naming its school only when it has one", () => {
    expect(startingRoleNames(JAIN)).toEqual(["administrators", "treasurers", "membership coordinators", "event leads", "Pathshala principals"]);
    expect(startingRoleNames(MOSQUE)).toEqual(["administrators", "treasurers", "membership coordinators", "event leads", "Weekend school principals"]);
    expect(startingRoleNames(CHAMBER, false)).toEqual(["administrators", "treasurers", "membership coordinators", "event leads"]);
    expect(resolveRoutine(viewer(["treasurer"], { kind: CHURCH }), facts()).startingRoles).toContain("Sunday school principals");
    expect(resolveRoutine(viewer(["treasurer"], { kind: CHAMBER }), facts()).startingRoles).not.toContain("School principals");
  });

  it("name only the payment ways the community has", () => {
    const deposits = (plugins: string[] | null) => {
      const r = resolveRoutine(viewer(["treasurer"], { kind: CHURCH }), facts({ paymentPlugins: plugins, counts: { deposits: 2 } }));
      const step = r.groups.flatMap((g) => g.steps).find((s) => s.key === "treasurer.deposits")!;
      return { title: step.title, detail: step.detail };
    };
    expect(deposits(["zelle"])).toEqual({ title: "Match bank lines and Zelle payments to gifts", detail: "Bank lines or Zelle reports are waiting to be matched" });
    expect(deposits(["card", "check"])).toEqual({ title: "Match bank lines to gifts", detail: "Bank lines are waiting to be matched" });
    expect(deposits(null)).toEqual({ title: "Match bank lines and reported payments to gifts", detail: "Bank lines or reported payments are waiting to be matched" });
    const words = routineWords(CHURCH, { plugins: ["zelle"] });
    expect(textOf(COUNTERS.deposits.done, words)).toBe("Every bank line and Zelle report is matched");
    expect(textOf(COUNTERS.deposits.done, routineWords(CHURCH, { plugins: [] }))).toBe("Every bank line is matched");
  });

  it("leave out recurring gifts when the community has no way of paying by card or bank", () => {
    const keys = (plugins: string[] | null) =>
      resolveRoutine(viewer(["treasurer"], { kind: CHAMBER }), facts({ today: FRIDAY, paymentPlugins: plugins })).groups.flatMap((g) => g.steps).map((s) => s.key);
    expect(keys(["check"])).not.toContain("treasurer.recurring-failed");
    expect(keys(["card"])).toContain("treasurer.recurring-failed");
    expect(keys(null)).toContain("treasurer.recurring-failed");
  });

  it("name the paper payments the community takes in the spelling of its country", () => {
    const title = (locale: string, plugins: string[]) => {
      const r = resolveRoutine(viewer(["treasurer"], { kind: CHAMBER }), facts({ today: MONDAY, locale, paymentPlugins: plugins }));
      return r.groups.flatMap((g) => g.steps).find((s) => s.key === "treasurer.offline")!.title;
    };
    expect(title("en-US", ["check", "cash"])).toBe("Record the week's checks and cash");
    expect(title("en-GB", ["check", "cash"])).toBe("Record the week's cheques and cash");
    expect(title("en-IN", ["cash"])).toBe("Record the week's cash");
    expect(title("en-US", [])).toBe("Record the week's payments received by hand");
  });

  it("put the weekly steps on the community's own working days", () => {
    const due = (today: string, over: Parameters<typeof facts>[0] = {}) =>
      resolveRoutine(viewer(["treasurer"], { kind: CHAMBER }), facts({ today, ...over })).groups.flatMap((g) => g.steps).map((s) => s.key);
    // the United States and Britain work Monday to Friday: the same days as before
    expect(due(FRIDAY, { locale: "en-US" })).toContain("treasurer.pledge-aging");
    expect(due(MONDAY, { locale: "en-US" })).toContain("treasurer.offline");
    expect(due(FRIDAY, { locale: "en-GB" })).toContain("treasurer.pledge-aging");
    // a country whose weekend is Friday and Saturday works Sunday to Thursday
    expect(due("2026-10-15", { locale: "en-IL" })).toContain("treasurer.pledge-aging");
    expect(due(FRIDAY, { locale: "en-IL" })).not.toContain("treasurer.pledge-aging");
    expect(due("2026-10-11", { locale: "en-IL" })).toContain("treasurer.offline");
    // the community's own working week beats its country's
    expect(due("2026-10-14", { locale: "en-US", workWeek: { start: 3, end: 3 } })).toEqual(expect.arrayContaining(["treasurer.offline", "treasurer.pledge-aging"]));
    // and the coming-up line names the day, not a fixed one
    const later = resolveRoutine(viewer(["treasurer"], { kind: CHAMBER }), facts({ today: TUESDAY, locale: "en-IL" })).later;
    expect(later.find((l) => l.key === "treasurer.pledge-aging")?.dueText).toBe("Thursdays");
  });

  it("count in the community's convention", () => {
    const step = (locale: string) => {
      const r = resolveRoutine(viewer(["membership_coordinator"], { kind: CHAMBER }), facts({ locale, counts: { applications: 125_000 } }));
      return r.groups.flatMap((g) => g.steps).find((s) => s.key === "members.applications")!.detail;
    };
    expect(step("en-US")).toBe("125,000 applications waiting");
    expect(step("en-IN")).toBe("1,25,000 applications waiting");
    const items = buildBriefing(viewer(["membership_coordinator"], { kind: CHAMBER }), facts({ locale: "en-IN", counts: { applications: 125_000 } }));
    expect(briefingSentence(items[0])).toBe("1,25,000 membership applications waiting");
  });

  it("never say a Jain word to a community that is not a Jain temple", () => {
    for (const [name, kind] of NOT_JAIN) {
      const w = routineWords(kind, { plugins: ["check"] });
      const text = Object.values(RECIPES)
        .flat()
        .flatMap((s) => [textOf(s.title, w), textOf(s.why, w), s.ask === undefined ? "" : textOf(s.ask, w)])
        .join(" | ");
      expect(text, name).not.toMatch(/pathshala|gyan|zelle|stavan|diwali|derasar|\bjsh\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
describe("the rail", () => {
  it("names giving, learning and the store in the kind's words, and keeps the generic word where the kind has none", () => {
    expect(workspaceLabel("giving")).toBe("Giving");
    expect(workspaceLabel("learning")).toBe("Learning");
    expect(workspaceLabel("giving", JAIN)).toBe("Giving");
    expect(workspaceLabel("learning", JAIN)).toBe("Pathshala");
    expect(workspaceLabel("store", JAIN)).toBe("My Store");
    expect(workspaceLabel("giving", CHURCH)).toBe("Offering");
    expect(workspaceLabel("learning", CHURCH)).toBe("Sunday school");
    expect(workspaceLabel("store", CHURCH)).toBe("Bookshop");
    expect(workspaceLabel("giving", CHAMBER)).toBe("Pay");
    expect(workspaceLabel("learning", CHAMBER)).toBe("Learning");
    expect(workspaceLabel("store", CHAMBER)).toBe("Store");
    // a word too long for the rail is replaced by the generic one, and the other workspaces never change
    const long = { ...CHURCH, terms: { ...CHURCH.terms, school: "Sunday school and youth ministry" }, modules: {} };
    expect(workspaceLabel("learning", long)).toBe("Learning");
    expect(workspaceLabel("people", CHURCH)).toBe("People");
  });

  it("puts those words on the workspaces the person can open", () => {
    const mod = (key: string) => ({ key, label: key, href: `/${key}`, paths: [`/${key}`], tabs: [] }) as never;
    const labels = (kind?: typeof JAIN) => workspacesFor([mod("giving"), mod("pathshala"), mod("store")], kind).map((w) => w.label);
    expect(labels()).toEqual(["Giving", "Learning", "Store"]);
    expect(labels(CHURCH)).toEqual(["Offering", "Sunday school", "Bookshop"]);
  });
});

// ---------------------------------------------------------------------------
describe("the media library", () => {
  const library = { media: { stavan: { published: 2 }, video: { published: 1, draft: 1 }, podcast: {}, recipe: {} } };

  it("calls the devotional songs stavans only for a kind that keeps a tradition", () => {
    expect(buildMediaLibrary(library, JAIN).kinds.map((k) => k.label)).toEqual(["Stavan", "Video", "Podcast", "Recipe"]);
    for (const [name, kind] of NOT_JAIN) {
      const labels = buildMediaLibrary(library, kind).kinds.map((k) => k.label);
      expect(labels, name).toEqual(["Song", "Video", "Podcast", "Recipe"]);
      expect(buildMediaLibrary(library, kind).total).toBe(4);
    }
    // the database's own names for the kinds are the same for everyone
    expect(buildMediaLibrary(library, CHURCH).kinds.map((k) => k.kind)).toEqual(["stavan", "video", "podcast", "recipe"]);
    // nothing given: the general words
    expect(buildMediaLibrary(library).kinds[0].label).toBe("Song");
  });

  it("describes the library in the kind's words to the model", () => {
    const library = CONTENT_COMMANDS.find((c) => c.key === "content.media_library")!;
    expect(describeText(library.description, JAIN)).toMatch(/^How many stavans, videos, podcasts and recipes are in the media library/);
    expect(describeText(library.description, CHURCH)).toMatch(/^How many songs, videos, podcasts and recipes are in the media library/);
    expect(describeText(library.description, CHAMBER)).not.toMatch(/stavan/i);
    expect(mediaKindsPhrase(JAIN)).toBe("stavans, videos and podcasts");
    expect(mediaKindsPhrase(CHAMBER)).toBe("songs, videos and podcasts");
    expect(mediaKindsPhrase(JAIN, 4)).toBe("stavans, videos, podcasts and recipes");
    expect(mediaKindLabel(CHURCH, "stavan")).toBe("Song");
    expect(mediaKindLabel(CHURCH, "other_thing")).toBe("other thing");
  });
});

// ---------------------------------------------------------------------------
describe("the learning commands", () => {
  const descriptions = (kind: Parameters<typeof describeText>[1]) => LEARNING_COMMANDS.map((c) => describeText(c.description, kind));

  it.each(ALL_KINDS)("describe themselves to the model with the words of %s", (_name, kind) => {
    const school = schoolOrGeneric(kind);
    const all = descriptions(kind);
    expect(all.some((d) => d.includes(school))).toBe(true);
    if (kind !== JAIN) for (const d of all) expect(d).not.toMatch(JAIN_AND_US);
    for (const d of all) expect(d).not.toMatch(/dollar/i);
    // the titles are general words: they are shown where no community is known
    for (const c of LEARNING_COMMANDS) expect(c.title).not.toMatch(/pathshala/i);
  });

  it.each(ALL_KINDS)("say the kind's school while they work (%s)", async (_name, kind) => {
    const school = schoolOrGeneric(kind);
    const world = learningWorld();
    world.rpc.pathshala_task_counts = { to_place: 3 };
    const counts = await runCommand(asPrincipal({ world, session: { kind } }).ctx, "learning.waiting_counts", {});
    expect(counts.ok && !counts.needsConfirmation ? counts.message : "").toMatch(new RegExp(`^3 · registrations waiting for the office to place\\.$`));
    expect((counts as { data: { waiting: { where_a_person_does_it: string }[] } }).data.waiting[0].where_a_person_does_it).toBe(`${school} › Enrollments`);

    const quiet = learningWorld();
    quiet.rpc.pathshala_task_counts = { to_place: 0 };
    const nothing = await runCommand(asPrincipal({ world: quiet, session: { kind } }).ctx, "learning.waiting_counts", {});
    expect(nothing.ok && !nothing.needsConfirmation ? nothing.message : "").toBe(`Nothing is waiting in ${school}.`);
  });
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
