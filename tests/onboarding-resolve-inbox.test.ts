import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  answerRequestFor,
  applyToRestPreview,
  cardView,
  currentGroup,
  defaultPick,
  evidenceView,
  frontGroup,
  idLabel,
  inboxReducer,
  initialState,
  isToDo,
  maskEmail,
  metricTiles,
  noBulkReason,
  progressText,
  rememberNote,
  routeHint,
  sameForRestLabel,
  statusLabel,
} from "@/lib/onboarding/resolve/inbox";
import { SIGNATURES, type Question } from "@/lib/onboarding/resolve/exceptions";
import { answerGroup, makeRunConfig, type ResolveDb } from "@/lib/onboarding/resolve/store";
import type { RunMetrics } from "@/lib/onboarding/resolve/metrics";
import type { CardRecord, InboxGroup, InboxView, Progress } from "@/lib/onboarding/resolve/views";
import { buildGolden } from "./fixtures/onboarding-resolve/golden";
import { TODAY, run } from "./fixtures/onboarding-resolve/helpers";

function question(signature: keyof typeof SIGNATURES, openItems = 3): Question {
  const spec = SIGNATURES[signature];
  return {
    id: `q:${signature}`,
    signature,
    tier: spec.tier,
    title: `Question about ${signature}`,
    detail: "Detail",
    count: openItems,
    answers: spec.answers.map((code, i) => ({ code, label: `Label ${code}`, recommended: i === 0 })),
    recommended: spec.answers[0],
    sameForRest: { available: spec.sameForRest, others: openItems - 1, label: "" },
    rememberable: spec.rememberable,
    routeTo: spec.routeTo,
    examples: [],
    value: { moneyCents: 0, members: 0, contacts: 0 },
  };
}

/** What the database's catalog says (stricter than the engine's SIGNATURES in three places; tests/onboarding-resolve-store.test.ts keeps the two honest). */
const dbRememberable = (signature: keyof typeof SIGNATURES) => SIGNATURES[signature].rememberable && signature !== "name_only" && signature !== "duplicate_gift_two_sources";
const dbSameForRest = (signature: keyof typeof SIGNATURES) => SIGNATURES[signature].sameForRest && signature !== "minor_record";

function group(signature: keyof typeof SIGNATURES, over: Partial<InboxGroup> = {}): InboxGroup {
  const spec = SIGNATURES[signature];
  return {
    id: `g-${signature}`,
    signature,
    tier: spec.tier,
    status: "open",
    question: question(signature),
    recommended: spec.answers[0],
    routeSuggested: spec.routeTo,
    routedTo: null,
    subjectCount: 3,
    itemCount: 3,
    openItems: 3,
    answeredItems: 0,
    moneyCents: 0,
    members: 0,
    contacts: 0,
    rank: 0,
    answer: null,
    applyToRest: false,
    nextItemId: `i-${signature}-1`,
    money: spec.money,
    sameForRest: dbSameForRest(signature),
    rememberable: dbRememberable(signature),
    ...over,
  };
}

const progress = (over: Partial<Progress> = {}): Progress => ({
  groupsTotal: 4,
  groupsOpen: 4,
  groupsAnswered: 0,
  groupsPostponed: 0,
  groupsSkipped: 0,
  groupsSent: 0,
  questionsLeft: 4,
  itemsTotal: 8,
  itemsOpen: 8,
  itemsAnswered: 0,
  answeredByPeople: 0,
  answeredByRules: 0,
  suggestionsAccepted: 0,
  firstAnsweredAt: null,
  lastAnsweredAt: null,
  minutesLeft: 2.5,
  ...over,
});

const view = (groups: InboxGroup[], over: Partial<InboxView> = {}): InboxView => ({
  status: "ready",
  stalled: false,
  engineVersion: "resolve-1",
  storedAt: "2026-10-11T10:00:00.000Z",
  recordCount: 100,
  metrics: null,
  progress: progress(),
  groups,
  ...over,
});

describe("which question is in front", () => {
  const money = group("duplicate_gift_two_sources", { rank: 0 });
  const phone = group("shared_phone_households", { rank: 1 });
  const minor = group("minor_record", { rank: 2 });

  it("is the first open one by rank: money before members", () => {
    expect(currentGroup(view([phone, money, minor]))?.id).toBe(money.id);
  });

  it("goes to the next open one once the first is answered, put off or skipped", () => {
    expect(currentGroup(view([{ ...money, status: "answered", openItems: 0 }, phone, minor]))?.id).toBe(phone.id);
    expect(currentGroup(view([{ ...money, status: "postponed" }, phone, minor]))?.id).toBe(phone.id);
    expect(currentGroup(view([{ ...money, status: "skipped" }, phone, minor]))?.id).toBe(phone.id);
  });

  it("comes back to what was put off when nothing else is open, but never to what was skipped or passed on", () => {
    expect(currentGroup(view([{ ...money, status: "postponed" }, { ...phone, status: "answered", openItems: 0 }]))?.id).toBe(money.id);
    expect(currentGroup(view([{ ...money, status: "skipped" }, { ...phone, status: "sent" }]))).toBeNull();
  });

  it("is nothing when every question is answered", () => {
    expect(currentGroup(view([{ ...money, status: "answered", openItems: 0 }]))).toBeNull();
    expect(currentGroup(view([]))).toBeNull();
  });

  it("honours a question the person picked, if it can still be worked on", () => {
    expect(currentGroup(view([money, phone]), phone.id)?.id).toBe(phone.id);
    expect(currentGroup(view([money, { ...phone, status: "skipped" }]), phone.id)?.id).toBe(phone.id);
    expect(currentGroup(view([money, { ...phone, status: "answered", openItems: 0 }]), phone.id)?.id).toBe(money.id);
  });

  it("counts a question as to do only when something in it is unanswered", () => {
    expect(isToDo(phone)).toBe(true);
    expect(isToDo({ ...phone, openItems: 0 })).toBe(false);
    expect(isToDo({ ...phone, status: "skipped" })).toBe(false);
    expect(statusLabel("postponed")).toBe("Later");
    expect(statusLabel("sent")).toBe("Passed on");
  });
});

describe("the answer in front", () => {
  it("is the recommended one before anything is touched", () => {
    expect(defaultPick(group("shared_phone_households"))).toBe("separate");
    expect(defaultPick(group("spouse_maiden_name"))).toBe("same_household");
    expect(defaultPick(group("duplicate_gift_two_sources"))).toBe("same_gift");
  });

  it("falls back to the first answer when the recommended one is not offered", () => {
    expect(defaultPick(group("name_only", { recommended: "use_first" }))).toBe("separate");
  });

  it("offers 'the same answer for the other N' with the number still open, and only where it is allowed", () => {
    expect(sameForRestLabel(group("shared_phone_households", { openItems: 14 }))).toBe("Use the same answer for the other 13");
    expect(sameForRestLabel(group("shared_phone_households", { openItems: 2 }))).toBe("Use the same answer for the other one");
    expect(sameForRestLabel(group("shared_phone_households", { openItems: 1 }))).toBeNull();
    expect(sameForRestLabel(group("amount_differs", { openItems: 5 }))).toBeNull();
  });

  it("says why money cannot be answered in bulk, and nothing when there is nothing else to answer", () => {
    expect(noBulkReason(group("amount_differs", { openItems: 5 }))).toBe("Each of these needs its own answer, because it involves money");
    expect(noBulkReason(group("amount_differs", { openItems: 1 }))).toBeNull();
    expect(noBulkReason(group("shared_phone_households", { openItems: 5 }))).toBeNull();
    expect(noBulkReason(group("minor_record", { openItems: 5 }))).toBe("Rows about children are answered one at a time.");
  });

  it("says in advance what 'the same answer' will do", () => {
    const g = group("shared_phone_households", { openItems: 14 });
    expect(applyToRestPreview(g, "separate")).toBe("This answers the other 13 the same way: Label separate.");
    expect(applyToRestPreview({ ...g, openItems: 2 }, "separate")).toBe("This answers the other one the same way: Label separate.");
    expect(applyToRestPreview({ ...g, openItems: 1 }, "separate")).toBeNull();
  });

  it("says whether the answer is remembered, and who is best placed to give it", () => {
    expect(rememberNote(group("shared_phone_households"))).toMatch(/remembers this answer/);
    expect(rememberNote(group("minor_record"))).toBe("Answers about children and money are never remembered");
    expect(rememberNote(group("duplicate_gift_two_sources"))).toBe("Answers about children and money are never remembered");
    expect(rememberNote(group("name_only"))).toMatch(/a name alone is never enough/);
    expect(routeHint(group("duplicate_gift_two_sources"))).toBe("The treasurer is best placed to answer this one.");
    expect(routeHint(group("name_only"))).toBe("The membership coordinator is best placed to answer this one.");
    expect(routeHint(group("low_confidence_read"))).toBeNull();
  });
});

describe("what an answer asks the database to do", () => {
  const g = group("shared_phone_households", { openItems: 14 });

  it("answers the item in front, with the answer chosen", () => {
    expect(answerRequestFor(g, "separate", "one")).toEqual({
      ok: true,
      request: { groupId: g.id, answer: "separate", itemId: g.nextItemId, applyToRest: false, expectedOthers: null, remember: true },
    });
  });

  it("uses the same answer for the rest when asked to", () => {
    expect(answerRequestFor(g, "same_household", "rest")).toEqual({
      ok: true,
      request: { groupId: g.id, answer: "same_household", itemId: g.nextItemId, applyToRest: true, expectedOthers: 13, remember: true },
    });
  });

  it("does not remember what cannot be remembered (a child, a money conflict, a gift, a name alone)", () => {
    const r = answerRequestFor(group("minor_record", { openItems: 3 }), "person_will_add", "one");
    expect(r.ok && r.request.remember).toBe(false);
    for (const sig of ["amount_differs", "duplicate_gift_two_sources", "name_only"] as const) {
      const m = answerRequestFor(group(sig, { openItems: 1 }), SIGNATURES[sig].answers[0], "one");
      expect(m.ok && m.request.remember, sig).toBe(false);
    }
  });

  it("answers a child's row one at a time: never the same answer for the others", () => {
    expect(answerRequestFor(group("minor_record", { openItems: 3 }), "person_will_add", "rest")).toEqual({ ok: false, error: "Rows about children are answered one at a time." });
    expect(sameForRestLabel(group("minor_record", { openItems: 3 }))).toBeNull();
  });

  it("refuses an answer that is not one of the question's, or none", () => {
    expect(answerRequestFor(g, "same_gift", "one")).toEqual({ ok: false, error: "Choose one of the answers first." });
    expect(answerRequestFor(g, null, "one")).toEqual({ ok: false, error: "Choose one of the answers first." });
  });

  it("refuses 'the same answer for the others' for money, in the words the engine uses", () => {
    expect(answerRequestFor(group("amount_differs", { openItems: 4 }), "hold", "rest")).toEqual({
      ok: false,
      error: "Each of these needs its own answer, because it involves money",
    });
  });

  it("refuses it when there is no other item, and when the question is already answered", () => {
    expect(answerRequestFor(group("name_only", { openItems: 1 }), "separate", "rest")).toEqual({ ok: false, error: "There is nothing else in this question to use the same answer for." });
    expect(answerRequestFor(group("name_only", { status: "answered", openItems: 0 }), "separate", "one")).toEqual({ ok: false, error: "This question is already answered." });
    expect(answerRequestFor(group("name_only", { nextItemId: null }), "separate", "one").ok).toBe(false);
  });

  it("is what the database receives: one item, or the others too", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db: ResolveDb = {
      async rpc(fn, args) {
        calls.push({ fn, args });
        return { data: { answered: 14, open_items: 0, status: "answered", remembered_as: "rule:x" }, error: null };
      },
      async importRows() {
        return { data: [], error: null };
      },
    };
    const rest = answerRequestFor(g, "separate", "rest");
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    const res = await answerGroup(db, {
      groupId: rest.request.groupId,
      answer: rest.request.answer,
      itemId: rest.request.itemId,
      applyToRest: rest.request.applyToRest,
      expectedOthers: rest.request.expectedOthers ?? undefined,
      remember: rest.request.remember,
    });
    expect(res).toEqual({ ok: true, data: { answered: 14, openItems: 0, status: "answered", rememberedAs: "rule:x", notRemembered: null } });
    // The number on the button goes with the answer: the database refuses if the number it would answer is another.
    expect(calls[0]).toEqual({
      fn: "resolve_answer",
      args: { p_group: g.id, p_answer: "separate", p_item: g.nextItemId, p_apply_rest: true, p_remember: true, p_expected_others: 13 },
    });
    const one = answerRequestFor(g, "separate", "one");
    if (!one.ok) throw new Error("expected a request");
    await answerGroup(db, { groupId: one.request.groupId, answer: one.request.answer, itemId: one.request.itemId, applyToRest: one.request.applyToRest });
    expect(calls[1].args.p_apply_rest).toBe(false);
  });
});

describe("the same answer for the others, on the real engine's questions", () => {
  it("is offered exactly for the kinds of question that one answer may cover, and the rest are one at a time", () => {
    const golden = buildGolden({ rows: 300, seed: 1 });
    const { groups } = run(golden.records, { dateOrderBySource: makeRunConfig(golden.records, TODAY).dateOrderBySource });
    expect(groups.length).toBeGreaterThan(3);
    for (const g of groups) {
      const asView = group(g.signature, { openItems: g.items.length + 1 });
      expect(sameForRestLabel(asView) !== null, g.signature).toBe(dbSameForRest(g.signature));
      if (!dbSameForRest(g.signature)) expect(answerRequestFor(asView, SIGNATURES[g.signature].answers[0], "rest").ok, g.signature).toBe(false);
    }
  });
});

describe("the numbers at the top", () => {
  it("writes how many questions are left and how long they will take", () => {
    expect(progressText(progress())).toMatchObject({ headline: "4 questions left", minutes: "about 3 minutes", left: 4, total: 4, fraction: 0 });
    expect(progressText(progress({ questionsLeft: 1, minutesLeft: 0.4 }))).toMatchObject({ headline: "1 question left", minutes: "less than a minute", fraction: 0.75 });
    expect(progressText(progress({ questionsLeft: 1, minutesLeft: 1 })).minutes).toBe("about 1 minute");
    expect(progressText(progress({ questionsLeft: 0, minutesLeft: 0 }))).toMatchObject({ headline: "No questions left", minutes: "", fraction: 1 });
    expect(progressText(progress({ groupsTotal: 0, questionsLeft: 0 })).headline).toBe("Nothing to ask");
    expect(progressText(null).headline).toBe("No questions yet");
  });

  it("tells how much Weaver decided by itself, what the questions cost, the time, and what is held", () => {
    const base = run([]).metrics;
    const m: RunMetrics = {
      ...base,
      rows: 1000,
      auto: 818,
      held: 60,
      learned: 20,
      autoShare: 0.818,
      questions: 9,
      questionsPer1000: 9,
      questionTarget: 10,
      withinQuestionTarget: true,
      minutes: 9.4,
      withinMinuteTarget: true,
    };
    const tiles = metricTiles({ metrics: m, recordCount: 1000 });
    expect(tiles.map((t) => t.label)).toEqual(["Resolved automatically", "Questions per 1,000 rows", "Minutes of your time", "Held for a person"]);
    expect(tiles[0]).toMatchObject({ value: "82%", hint: "818 of 1,000 rows, and 20 more from answers you gave before", tone: "success" });
    expect(tiles[1]).toMatchObject({ value: "9", hint: "9 questions, within the target of 10" });
    expect(tiles[2]).toMatchObject({ value: "9" });
    expect(tiles[3]).toMatchObject({ value: "60" });
    expect(metricTiles({ metrics: { ...m, withinQuestionTarget: false, questionsPer1000: 14 }, recordCount: 1000 })[1].tone).toBe("saffron");
    expect(metricTiles({ metrics: null, recordCount: 0 })).toEqual([]);
  });
});

describe("the cards", () => {
  const adult: CardRecord = {
    id: "r1",
    minor: false,
    rowNo: 12,
    source: "directory.xlsx",
    sourceKind: "spreadsheet",
    kind: "person",
    card: {
      name: "Mira Shah",
      firstName: null,
      lastName: null,
      mobile: "+17135550142",
      phone: "(713) 555-0142",
      phone2: null,
      email: "mira.shah@example.com",
      email2: null,
      address1: "12 Lotus Ln",
      address2: "Apt 4",
      city: "Sugar Land",
      state: "TX",
      zip: "77478",
      ids: { household_number: "0417", person_legacy: "P-3" },
      existingNumber: "0417",
      gift: null,
    },
  };

  it("tells two households apart: name, address, phone ending, masked e-mail, identifiers, where the row is from", () => {
    const c = cardView(adult);
    expect(c.heading).toBe("Mira Shah");
    expect(c.kind).toBe("Person");
    expect(c.lines).toEqual(["12 Lotus Ln, Apt 4, Sugar Land, TX 77478", "Phone ending 0142", "E-mail m***@example.com"]);
    expect(c.ids).toEqual(["Household number 0417", "Person ID in the old system P-3"]);
    expect(c.origin).toBe("Row 12 of directory.xlsx");
    expect(c.held).toBe(false);
    expect(c.inRecords).toBe(false);
  });

  it("never shows a whole phone number or e-mail address", () => {
    const text = JSON.stringify(cardView(adult));
    expect(text).not.toContain("5550142");
    expect(text).not.toContain("mira.shah");
    expect(maskEmail("a.b@c.org")).toBe("a***@c.org");
  });

  it("is never a name alone: a card with only a name still says where the row is from", () => {
    const only = cardView({ ...adult, card: { ...adult.card!, mobile: null, phone: null, email: null, address1: null, address2: null, city: null, state: null, zip: null, ids: {}, existingNumber: null } });
    expect(only.heading).toBe("Mira Shah");
    expect(only.lines).toEqual([]);
    expect(only.origin).toBe("Row 12 of directory.xlsx");
  });

  it("writes a household already in the records as that, with its number", () => {
    const c = cardView({ ...adult, source: "Records already in Weaver", sourceKind: "existing", kind: "household", card: { ...adult.card!, ids: {}, existingNumber: "0417" } });
    expect(c.inRecords).toBe(true);
    expect(c.origin).toBe("Already in your records");
    expect(c.ids).toEqual(["Household number 0417"]);
    expect(c.kind).toBe("Household");
  });

  it("writes a gift as money and a date, with its check number", () => {
    const c = cardView({ ...adult, kind: "gift", card: { ...adult.card!, name: null, mobile: null, phone: null, email: null, address1: null, address2: null, city: null, state: null, zip: null, ids: {}, existingNumber: null, gift: { amount: "125.05", date: "2025-12-31", ref: "1042" } } });
    expect(c.heading).toBe("No name on this row");
    expect(c.lines).toEqual(["$125.05 on 2025-12-31", "Check or reference 1042"]);
  });

  it("withholds a child's row: no name, no detail", () => {
    const c = cardView({ id: "r9", minor: true, rowNo: 4, source: "kids.csv", sourceKind: "spreadsheet", kind: "person", card: null });
    expect(c.held).toBe(true);
    expect(c.heading).toBe("Row 4 of kids.csv");
    expect(c.kind).toBe("About a child");
    expect(c.lines.join(" ")).toMatch(/withheld/);
    expect(c.ids).toEqual([]);
  });

  it("names the identifier systems in words", () => {
    expect(idLabel("household_legacy")).toBe("Household ID in the old system");
    expect(idLabel("neon_account")).toBe("Neon account");
  });

  it("sums up what agrees and what does not, without repeating", () => {
    const e = evidenceView({
      evidence: [
        { kind: "phone", label: "same mobile", independent: true },
        { kind: "phone", label: "same mobile", independent: true },
        { kind: "email", label: "e-mail matches", independent: true },
      ],
      conflicts: [{ kind: "unit", label: "a different unit at the same address", severity: "lower" }],
    });
    expect(e.agree).toEqual(["same mobile", "e-mail matches"]);
    expect(e.summary).toBe("Agrees: same mobile; e-mail matches. Differs: a different unit at the same address.");
    expect(evidenceView({ evidence: [], conflicts: [] }).summary).toBe("");
    expect(evidenceView({ evidence: [], conflicts: [{ kind: "unit", label: "x", severity: "lower" }] }).summary).toBe("Nothing but the name agrees. Differs: x.");
  });
});

describe("how the screen moves", () => {
  const money = group("duplicate_gift_two_sources", { rank: 0, nextItemId: "i-money-1" });
  const phone = group("shared_phone_households", { rank: 1, nextItemId: "i-phone-1" });

  it("starts on the first open question with the recommended answer chosen", () => {
    const s = initialState(view([phone, money]));
    expect(frontGroup(s)?.id).toBe(money.id);
    expect(s.pick).toBe("same_gift");
    expect(s.pickFor).toBe("i-money-1");
    expect(s.busy).toBeNull();
    expect(s.error).toBeNull();
  });

  it("keeps the answer the person chose while the item is the same, and resets it when the item changes", () => {
    let s = initialState(view([money, phone]));
    s = inboxReducer(s, { type: "pick", code: "different_gifts" });
    expect(s.pick).toBe("different_gifts");
    // The server sends the same inbox back (for example after "Look again"): the choice stays.
    s = inboxReducer(s, { type: "view", view: view([money, phone]) });
    expect(s.pick).toBe("different_gifts");
    // The question was answered: the next one is in front, with its own recommended answer.
    s = inboxReducer(s, { type: "view", view: view([{ ...money, status: "answered", openItems: 0, nextItemId: null }, phone]) });
    expect(frontGroup(s)?.id).toBe(phone.id);
    expect(s.pick).toBe("separate");
    expect(s.pickFor).toBe("i-phone-1");
  });

  it("moves to the next item of the same question after one answer, and chooses the recommended answer again", () => {
    let s = initialState(view([phone]));
    s = inboxReducer(s, { type: "pick", code: "same_household" });
    s = inboxReducer(s, { type: "view", view: view([{ ...phone, openItems: 2, answeredItems: 1, nextItemId: "i-phone-2" }]) });
    expect(frontGroup(s)?.nextItemId).toBe("i-phone-2");
    expect(s.pick).toBe("separate");
  });

  it("opens a question picked from the list, and ignores one that cannot be worked on", () => {
    let s = initialState(view([money, phone]));
    s = inboxReducer(s, { type: "select", groupId: phone.id });
    expect(frontGroup(s)?.id).toBe(phone.id);
    expect(s.pickFor).toBe("i-phone-1");
    const answered = { ...money, status: "answered" as const, openItems: 0 };
    const t = inboxReducer(initialState(view([answered, phone])), { type: "select", groupId: answered.id });
    expect(frontGroup(t)?.id).toBe(phone.id);
  });

  it("goes back to the list's first question when the picked one is answered", () => {
    let s = initialState(view([money, phone]));
    s = inboxReducer(s, { type: "select", groupId: phone.id });
    s = inboxReducer(s, { type: "view", view: view([money, { ...phone, status: "answered", openItems: 0 }]) });
    expect(s.selectedGroupId).toBeNull();
    expect(frontGroup(s)?.id).toBe(money.id);
  });

  it("shows a failure next to what was done and keeps everything else as it was", () => {
    let s = initialState(view([money, phone]));
    s = inboxReducer(s, { type: "pick", code: "different_gifts" });
    s = inboxReducer(s, { type: "busy", busy: "answer" });
    expect(s.busy).toBe("answer");
    s = inboxReducer(s, { type: "error", error: "Could not record your answer — the database could not be reached — check the connection and try again." });
    expect(s.busy).toBeNull();
    expect(s.error).toMatch(/^Could not record your answer/);
    expect(s.pick).toBe("different_gifts");
    expect(frontGroup(s)?.id).toBe(money.id);
    // Trying again clears the message; a new inbox from the server does too.
    expect(inboxReducer(s, { type: "busy", busy: "answer" }).error).toBeNull();
    expect(inboxReducer(s, { type: "view", view: view([money, phone]) }).error).toBeNull();
  });

  it("has nothing in front when every question is answered", () => {
    const s = initialState(view([{ ...money, status: "answered", openItems: 0 }, { ...phone, status: "skipped" }]));
    expect(frontGroup(s)).toBeNull();
    expect(s.pick).toBeNull();
  });
});

