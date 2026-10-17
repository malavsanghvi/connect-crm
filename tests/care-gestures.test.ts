import { describe, expect, it } from "vitest";

import {
  NEVER_ASK,
  blankGesture,
  checkGesture,
  gestureInput,
  gestureLine,
  ideasFor,
  needsLine,
  parseGestures,
  suitsLine,
  toPayload,
  wordsAsk,
  type Gesture,
} from "@/lib/care/gestures";
import { parseCard } from "@/lib/care/model";

// DonorDelight slice 6 (0894): the gesture library in words, "never an ask", and which gestures suit a household.

const g = (over: Record<string, unknown> = {}) => ({
  id: "g1", key: "thank_you_call", name: "A thank-you call with no ask", description: "A short call to say thank you and to listen.", cost: "free", effort: "quick", who: "anyone",
  suits_thanks: ["call", "in_person", "message"], suits_recognition: [], needs: [], suggest: true, kind: "thank_you", channel: "phone", draft: "Hello {{name}}, it is {{me}} from {{org}}.", enabled: true, starter_key: "thank_you_call", ...over,
});
const LIBRARY = parseGestures({
  audience: "faith", starters_missing: 0, can_manage: true, label: "Member care",
  gestures: [
    g(),
    g({ id: "g2", key: "handwritten_card", name: "A handwritten card", suits_thanks: ["card", "message"], kind: "thank_you", channel: "post", cost: "low", draft: "Dear {{name}}, thank you. {{me}}" }),
    g({ id: "g3", key: "ask_advice", name: "Ask for their advice", suits_thanks: ["call", "in_person"], needs: ["expertise"], kind: "check_in", who: "leader", draft: null }),
    g({ id: "g4", key: "special_day_greeting", name: "A greeting on their special day", suits_thanks: [], needs: ["special_day"], kind: "greeting", channel: "text" }),
    g({ id: "g5", key: "public_recognition", name: "Recognition, only if they chose it", suits_thanks: [], suits_recognition: ["public"], kind: "other", channel: "other", draft: null }),
    g({ id: "g6", key: "care_moment", name: "A care moment", suits_thanks: [], suggest: false, kind: "care_moment" }),
    g({ id: "g7", key: "paused", name: "Paused one", suits_thanks: [], enabled: false }),
    g({ id: "g8", key: "share_interest", name: "Share something about their interest", suits_thanks: [], needs: ["interests"], kind: "update", channel: "email" }),
  ],
}).gestures;

const person = (over: Record<string, unknown> = {}) => ({ person_id: "p1", name: "Ama Mensah", is_primary: true, best_call_time: null, interests: [], expertise: [], language: null, anniversary: null, dietary: [], dietary_other: null, agreed: {}, ...over });
const card = (over: Record<string, unknown> = {}, profile: Record<string, unknown> | null = {}, people: unknown[] | null = [person()], specialDays: unknown[] | null = []) =>
  parseCard({
    household: { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [{ person_id: "p1", name: "Ama Mensah", is_primary: true }], merged: false },
    label: "Member care", access: { level: "manage", manage: true, amounts: false, people: true }, owners: { owner: null, backup: null, needs_owner: true },
    profile: profile === null ? null : { thanks: null, recognition: null, channel: null, language: null, contact_person_id: null, contact_name: null, do_not_ask: false, rest_until: null, resting: false, ...profile },
    languages: ["en"], today: "2026-10-17", people, special_days: specialDays, notes: [], notes_total: 0, last_touch: null, touches_12m: 0, asks_12m: 0, ...over,
  });
const keys = (c: ReturnType<typeof card>, ctx = {}) => ideasFor(LIBRARY, c, ctx).map((i) => i.gesture.key);

describe("parseGestures", () => {
  it("reads the gestures with their cost, effort, who and the profiles they suit", () => {
    const list = parseGestures({ audience: "civic", starters_missing: 4, can_manage: true, label: "Donor care", gestures: [g(), { name: "no id" }] });
    expect(list.gestures).toHaveLength(1);
    expect(list.gestures[0]).toMatchObject({ cost: "free", effort: "quick", who: "anyone", suitsThanks: ["call", "in_person", "message"], kind: "thank_you", channel: "phone", suggest: true, enabled: true });
    expect(list.startersMissing).toBe(4);
    expect(list.audience).toBe("civic");
    expect(list.label).toBe("Donor care");
  });
  it("an unknown cost, effort, who, kind or channel is the plain default, and nonsense is safe", () => {
    const odd = parseGestures({ gestures: [g({ cost: "lavish", effort: "huge", who: "nobody", kind: "ask", channel: "pigeon" })] }).gestures[0];
    expect(odd).toMatchObject({ cost: "free", effort: "quick", who: "anyone", kind: "other", channel: null });
    expect(parseGestures(null)).toEqual({ gestures: [], startersMissing: 0, audience: "civic", canManage: false, label: "DonorDelight" });
  });
});

describe("never an ask", () => {
  it("recognises words that ask for a gift, a donation or a pledge", () => {
    for (const t of ["Please give generously", "Would you consider donating to our appeal?", "Make a gift today", "Make a donation", "Donate now", "Send $50", "Could you please contribute?"]) expect(wordsAsk(t)).toBe(true);
  });
  it("does not mistake a thank-you for an ask", () => {
    for (const t of ["Thank you for your gift today. We are grateful.", "A photo of what their gift built", "Thank you for your generosity", "", null, undefined]) expect(wordsAsk(t)).toBe(false);
  });
  it("a gesture that asks cannot be saved: in its name, its description or its draft", () => {
    const ok = { ...blankGesture(), name: "A card", description: "A card of thanks." };
    expect(checkGesture(ok)).toEqual({ ok: true });
    expect(checkGesture({ ...ok, name: "Please give" })).toEqual({ ok: false, error: NEVER_ASK });
    expect(checkGesture({ ...ok, description: "Ask them to make a donation." })).toEqual({ ok: false, error: NEVER_ASK });
    expect(checkGesture({ ...ok, draft: "Would you consider donating $100?" })).toEqual({ ok: false, error: NEVER_ASK });
  });
  it("the payload has no field for an ask, and a care moment is never offered on its own", () => {
    const p = toPayload({ ...blankGesture(), name: "  Sit with them ", description: "Visit.", kind: "care_moment", suggest: true });
    expect(p).toMatchObject({ name: "Sit with them", kind: "care_moment", suggest: false, draft: null });
    expect(Object.keys(p).some((k) => /ask/i.test(k))).toBe(false);
  });
  it("checks the rest in the database's words", () => {
    const ok = { ...blankGesture(), name: "A", description: "B" };
    expect(checkGesture({ ...ok, name: " " })).toEqual({ ok: false, error: "Give the gesture a name of up to 80 characters." });
    expect(checkGesture({ ...ok, description: "" })).toEqual({ ok: false, error: "Say what to do, in up to 400 characters." });
    expect(checkGesture({ ...ok, draft: "x".repeat(1501) })).toEqual({ ok: false, error: "The draft is at most 1,500 characters." });
  });
});

describe("words", () => {
  it("gestureLine, suitsLine and needsLine", () => {
    expect(gestureLine(LIBRARY[1])).toBe("Low cost · A few minutes · Anyone");
    expect(gestureLine(LIBRARY[2])).toBe("Free · A few minutes · A leader");
    expect(suitsLine(LIBRARY[1])).toBe("Suits households who like to be thanked a card or a message");
    expect(suitsLine(LIBRARY[4])).toBe("Suits households who are happy to be named");
    expect(suitsLine({ suitsThanks: [], suitsRecognition: [] })).toBeNull();
    expect(needsLine(LIBRARY[2])).toBe("Needs: expertise on file");
    expect(needsLine({ needs: [] })).toBeNull();
  });
  it("round-trips an input", () => {
    const input = gestureInput(LIBRARY[0]);
    expect(input).toMatchObject({ id: "g1", name: "A thank-you call with no ask", cost: "free", suitsThanks: ["call", "in_person", "message"], draft: "Hello {{name}}, it is {{me}} from {{org}}." });
    expect(toPayload(input)).toMatchObject({ id: "g1", suits_thanks: ["call", "in_person", "message"], needs: [], channel: "phone" });
  });
});

describe("ideasFor: which gestures suit a household", () => {
  it("a household with no profile and no records gets only what suits any household", () => {
    expect(keys(card({}, null, null, null))).toEqual(["thank_you_call", "handwritten_card"]);
  });
  it("how they like to be thanked decides, with why", () => {
    const ideas = ideasFor(LIBRARY, card({}, { thanks: "card" }));
    expect(ideas.map((i) => i.gesture.key)).toEqual(["handwritten_card"]);
    expect(ideas[0].reasons).toEqual(["They like to be thanked a card"]);
    expect(keys(card({}, { thanks: "call" }))).toEqual(["thank_you_call"]);
  });
  it("a household that asked for no thanks gets no thank-you gesture", () => {
    expect(keys(card({}, { thanks: "none" }))).toEqual([]);
  });
  it("recognition only for a household that chose to be named, never for one that gives in private or has not said", () => {
    expect(keys(card({}, { recognition: "public" }))).toContain("public_recognition");
    expect(keys(card({}, { recognition: "anonymous" }))).not.toContain("public_recognition");
    expect(keys(card({}, { recognition: "private_only" }))).not.toContain("public_recognition");
    expect(keys(card({}, { recognition: null }))).not.toContain("public_recognition");
  });
  it("a gesture that needs a record is offered only when the household has it, and only to someone who may read it", () => {
    const rich = card({}, {}, [person({ expertise: ["tax law"], interests: ["gardening"] })], [{ kind: "birthday", label: null, date: "2026-11-03", tithi: null, person_name: "Ama" }]);
    const k = keys(rich);
    expect(k).toEqual(expect.arrayContaining(["ask_advice", "special_day_greeting", "share_interest"]));
    const poor = keys(card({}, {}, [person()], []));
    expect(poor).not.toEqual(expect.arrayContaining(["ask_advice"]));
    expect(poor).not.toContain("special_day_greeting");
    const blind = keys(card({}, {}, null, null));
    expect(blind).not.toContain("share_interest");
    expect(blind).not.toContain("ask_advice");
  });
  it("a paused gesture and a care moment are never offered on their own", () => {
    const k = keys(card({}, {}, [person({ expertise: ["x"], interests: ["y"] })], [{ kind: "birthday", date: "2026-11-03" }]));
    expect(k).not.toContain("paused");
    expect(k).not.toContain("care_moment");
  });
  it("what suits best comes first, at most five, and the draft is filled with their name, the sender and the organization", () => {
    const c = card({}, { thanks: "call", contact_name: "Kofi Mensah" }, [person({ expertise: ["tax law"], interests: ["gardening"] })], [{ kind: "birthday", date: "2026-11-03" }]);
    const ideas = ideasFor(LIBRARY, c, { org: "Grace Church", me: "Ravi" });
    expect(ideas.length).toBeLessThanOrEqual(5);
    expect(ideas[0].gesture.key).toBe("ask_advice");
    const call = ideas.find((i) => i.gesture.key === "thank_you_call");
    expect(call?.draft).toBe("Hello Kofi, it is Ravi from Grace Church.");
    expect(call?.channel).toBe("phone");
  });
  it("the way is the gesture's, else the household's own, else a call", () => {
    const lib: Gesture[] = [{ ...LIBRARY[0], channel: null, suitsThanks: [] }];
    expect(ideasFor(lib, card({}, { channel: "email" }))[0].channel).toBe("email");
    expect(ideasFor(lib, card({}, null, null, null))[0].channel).toBe("phone");
  });
  it("nothing in an idea is an amount or a child's name", () => {
    expect(JSON.stringify(ideasFor(LIBRARY, card({}, { thanks: "card" })))).not.toMatch(/amount|cents|\$[0-9]/i);
  });
});
