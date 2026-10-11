import { describe, expect, it } from "vitest";

import {
  ageBucket,
  ageHours,
  childGivenNames,
  composeReply,
  countBy,
  explainMessage,
  latestBy,
  maskAddress,
  mentionsChild,
  pickExcerpt,
  rankSources,
  reachability,
  searchWords,
  triageCounts,
  waitedWords,
  type InboxRow,
  type SourceRow,
  type ThreadRow,
} from "@/lib/commands/catalog/messages/pure";

const NOW = new Date("2026-10-10T15:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const when = (iso: string) => `on ${iso.slice(0, 10)}`;

describe("age", () => {
  it("puts a wait in a bucket and says it in words", () => {
    expect(ageBucket(2)).toBe("under_a_day");
    expect(ageBucket(30)).toBe("one_to_two_days");
    expect(ageBucket(100)).toBe("three_to_seven_days");
    expect(ageBucket(24 * 9)).toBe("over_a_week");
    expect(waitedWords(0.2)).toBe("12 minutes");
    expect(waitedWords(1)).toBe("1 hour");
    expect(waitedWords(5)).toBe("5 hours");
    expect(waitedWords(24 * 3)).toBe("3 days");
    expect(ageHours(ago(6), NOW)).toBeCloseTo(6);
    expect(ageHours("2030-01-01T00:00:00Z", NOW)).toBe(0);
  });
});

describe("triageCounts", () => {
  const inboxes: InboxRow[] = [
    { id: "ib-1", name: "Events", response_target_hours: 48 },
    { id: "ib-2", name: "Membership", response_target_hours: 24 },
  ];
  const t = (id: string, inbox: string, status: string, hours: number, over: Partial<ThreadRow> = {}): ThreadRow => ({
    id,
    inbox_id: inbox,
    status,
    assignee_user: null,
    first_response_at: null,
    created_at: ago(hours),
    subject: null,
    from_person_id: null,
    ...over,
  });

  it("counts what waits on us, by age and inbox, and leaves closed ones out", () => {
    const c = triageCounts(
      [
        t("a", "ib-1", "open", 72), // 3 days, nobody, no reply, past 48 h
        t("b", "ib-1", "open", 3), // 3 hours
        t("c", "ib-2", "assigned", 30, { assignee_user: "u1", first_response_at: ago(20) }),
        t("d", "ib-2", "waiting", 50, { first_response_at: ago(40) }),
        t("e", "ib-1", "closed", 400),
        t("f", "ib-2", "open", 25), // past its 24 h target
      ],
      inboxes,
      NOW,
    );
    expect(c).toMatchObject({ open: 5, waiting_on_us: 4, waiting_on_member: 1, unassigned: 3, no_first_reply: 3, past_target: 2 });
    expect(c.by_age.map((b) => b.count)).toEqual([1, 2, 1, 0]);
    expect(c.by_inbox.map((i) => [i.name, i.waiting_on_us, i.waiting_on_member])).toEqual([
      ["Events", 2, 0],
      ["Membership", 2, 1],
    ]);
    expect(c.by_inbox[0].oldest_waiting).toBe("3 days");
  });

  it("is zero for an empty inbox", () => {
    expect(triageCounts([], inboxes, NOW)).toMatchObject({ open: 0, waiting_on_us: 0, past_target: 0 });
  });
});

describe("the child guard for message text", () => {
  const names = childGivenNames(["Zoya Shah", "Aarav Patel", "Mary Ann Joshi", "Zoé Rao"]);

  it("keeps the given names and leaves the family names", () => {
    expect([...names].sort()).toEqual(["aarav", "ann", "mary", "zoe", "zoya"]);
  });
  it("finds a child's first name as a word, in any case, with an apostrophe, or with an accent", () => {
    expect(mentionsChild("Zoya needs a gluten free meal", names)).toBe(true);
    expect(mentionsChild("my son AARAV is in the quiz", names)).toBe(true);
    expect(mentionsChild("Zoya's class starts at nine", names)).toBe(true);
    expect(mentionsChild("Zoé is coming", names)).toBe(true);
    expect(mentionsChild("Ann", names)).toBe(true);
  });
  it("does not match part of a word, an adult's family name or nothing", () => {
    expect(mentionsChild("Is the dinner vegetarian?", names)).toBe(false);
    expect(mentionsChild("Shah family parking", names)).toBe(false);
    expect(mentionsChild("Zoyaa", names)).toBe(false);
    expect(mentionsChild(null, names)).toBe(false);
    expect(mentionsChild("Zoya", new Set())).toBe(false);
  });
  it("reads Gujarati and Hindi names whole", () => {
    const native = childGivenNames(["ઝોયા શાહ", "आरव पटेल"]);
    expect(mentionsChild("ઝોયા ને ગ્લુટેન ફ્રી ભોજન જોઈએ છે", native)).toBe(true);
    expect(mentionsChild("आरव की कक्षा", native)).toBe(true);
    expect(mentionsChild("કાર્યક્રમ ક્યારે છે", native)).toBe(false);
  });
});

describe("approved answers", () => {
  const menu: SourceRow = {
    id: "s1",
    kind: "niva_source",
    title: "Diwali dinner food",
    body_md: "The Diwali dinner is fully vegetarian and Jain friendly. No onion, no garlic and no root vegetables are used.\n\nDinner is served from 6 PM in the main hall.",
    source_url: "https://example.org/diwali",
  };
  const parking: SourceRow = { id: "s2", kind: "faq", title: "Parking at the temple", body_md: "Free parking is behind the hall.", source_url: null };

  it("drops filler and short words from a question", () => {
    expect(searchWords("Hello, is the Diwali dinner vegetarian? We are Jain and avoid onion and garlic.")).toEqual(["diwali", "dinner", "vegetarian", "jain", "avoid", "onion", "garlic"]);
  });
  it("ranks the source that answers the question first and returns nothing when none does", () => {
    const ranked = rankSources("Is the Diwali dinner vegetarian? We avoid onion and garlic.", [parking, menu]);
    expect(ranked.map((r) => r.id)).toEqual(["s1"]);
    expect(ranked[0].matched).toEqual(expect.arrayContaining(["diwali", "dinner", "vegetarian"]));
    expect(rankSources("When does the library open?", [menu, parking])).toEqual([]);
    expect(rankSources("", [menu])).toEqual([]);
  });
  it("needs two different words of the question, or the one word of a one-word question in the title", () => {
    expect(rankSources("Where is the hall?", [parking])).toEqual([]);
    expect(rankSources("parking please", [parking]).map((r) => r.id)).toEqual(["s2"]);
    // One word of a longer question is not enough: a wrong answer to a family is worse than none.
    expect(rankSources("Where do we park for the dinner?", [menu, parking])).toEqual([]);
    // "park" and "parking" are the same word of the question.
    expect(rankSources("Where do we park? Is there parking?", [parking]).map((r) => r.id)).toEqual(["s2"]);
  });
  it("picks the paragraph that answers and cuts a long one at a sentence", () => {
    expect(pickExcerpt(menu.body_md ?? "", ["dinner", "served"])).toBe("Dinner is served from 6 PM in the main hall.");
    const long = `${"Sentence one is here. ".repeat(60)}`;
    const cut = pickExcerpt(long, ["sentence"], 100);
    expect(cut.length).toBeLessThanOrEqual(101);
    expect(cut.endsWith(".")).toBe(true);
  });
  it("writes a reply from the best source, or nothing when there is none", () => {
    const [best] = rankSources("Is the Diwali dinner vegetarian?", [menu]);
    const reply = composeReply({ firstName: "Priya", community: "Jain Society", inbox: "Events inbox", best });
    expect(reply).toContain("Hello Priya,");
    expect(reply).toContain("fully vegetarian");
    expect(reply).toContain("More: https://example.org/diwali");
    expect(reply).toContain("Events inbox · Jain Society");
    expect(composeReply({ firstName: null, community: "Jain Society", inbox: "Events", best: null })).toBeNull();
    expect(composeReply({ firstName: null, community: "Jain Society", inbox: "Events", best })).toContain("Hello there,");
  });
});

describe("why a message did not go out", () => {
  const base = { channel: "sms", failure_reason: null, scheduled_at: ago(2), sent_at: null, delivered_at: null };
  it("says delivered and handed-over messages went out", () => {
    expect(explainMessage({ ...base, status: "delivered", delivered_at: ago(1) }, null, when, NOW)).toMatchObject({ state: "Delivered", went_out: true });
    expect(explainMessage({ ...base, status: "sent", sent_at: ago(1) }, null, when, NOW)).toMatchObject({ state: "Handed over", went_out: true });
  });
  it("uses the reason the database recorded", () => {
    const e = explainMessage({ ...base, status: "failed", failure_reason: "The number is a landline." }, null, when, NOW);
    expect(e).toMatchObject({ state: "Failed", why: "The number is a landline.", went_out: false });
    expect(explainMessage({ ...base, status: "cancelled", failure_reason: "Not sent: the boli closed before it went." }, null, when, NOW).why).toBe("Not sent: the boli closed before it went.");
  });
  it("explains each state without a recorded reason", () => {
    expect(explainMessage({ ...base, status: "bounced" }, null, when, NOW).why).toMatch(/did not accept it/);
    expect(explainMessage({ ...base, status: "suppressed", channel: "email" }, null, when, NOW).why).toMatch(/do-not-send list/);
    expect(explainMessage({ ...base, status: "failed" }, null, when, NOW).why).toMatch(/did not say why/);
  });
  it("tells a message waiting for its time from one the background service gave up on", () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    expect(explainMessage({ ...base, status: "queued", scheduled_at: future }, null, when, NOW)).toMatchObject({ state: "Waiting for its time" });
    const dead = { status: "failed", attempts: 5, max_attempts: 5, last_error: "401", run_after: null };
    expect(explainMessage({ ...base, status: "queued" }, dead, when, NOW)).toMatchObject({ state: "Failed", why: expect.stringContaining("5 times") });
    const retry = { status: "queued", attempts: 2, max_attempts: 5, last_error: "timeout", run_after: ago(-1) };
    expect(explainMessage({ ...base, status: "queued" }, retry, when, NOW)).toMatchObject({ state: "Retrying" });
    expect(explainMessage({ ...base, status: "queued" }, null, when, NOW)).toMatchObject({ state: "Queued" });
  });
});

describe("can this person be reached", () => {
  const optin = (opted_in: boolean, address: string | null = "x@example.org") => ({ opted_in, address, recorded_at: ago(100) });
  const r = (over: Partial<Parameters<typeof reachability>[0]>) => reachability({ channel: "email", optin: optin(true), consentGranted: null, suppression: null, ...over }, when);

  it("says yes only when there is an opt-in, an address, consent and no suppression", () => {
    expect(r({})).toMatchObject({ reachable: true });
  });
  it("gives the plain reason for each no", () => {
    expect(r({ optin: null }).why).toMatch(/No answer is recorded about email/);
    expect(r({ optin: optin(false) }).why).toMatch(/opted out of email/);
    expect(r({ optin: optin(true, "") }).why).toMatch(/no email address on file/);
    expect(r({ consentGranted: false }).why).toMatch(/withdrew their consent/);
    expect(r({ suppression: { reason: "bounce", created_at: ago(500) } })).toMatchObject({ reachable: false, why: expect.stringMatching(/do-not-send list.*a bounce/) });
    expect(r({ channel: "sms", optin: optin(false) }).why).toMatch(/opted out of text/);
  });
  it("does not judge push or in-app by contact choices", () => {
    expect(r({ channel: "push" })).toMatchObject({ reachable: null });
  });
});

describe("small helpers", () => {
  it("masks an address so it can be recognised but not used", () => {
    expect(maskAddress("priya@example.org")).toBe("p***@example.org");
    expect(maskAddress("+15125550101")).toBe("ending 0101");
    expect(maskAddress("")).toBeNull();
    expect(maskAddress(null)).toBeNull();
  });
  it("keeps the newest row of each key and counts by key", () => {
    const rows = [
      { k: "a", recorded_at: "2026-01-01" },
      { k: "a", recorded_at: "2026-03-01" },
      { k: "b", recorded_at: "2026-02-01" },
    ];
    expect(latestBy(rows, (r) => r.k).get("a")?.recorded_at).toBe("2026-03-01");
    expect(countBy(rows, (r) => r.k)).toEqual({ a: 2, b: 1 });
  });
});
