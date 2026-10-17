import { stateLine, holdLine, parseApproachHousehold } from "@/lib/care/approach";
import { classifyHealth, parseHealthFacts } from "@/lib/care/health";
import { CHANNEL_LABEL, RECOGNITION_LABEL, SOURCE_LABEL, THANKS_LABEL, TOUCH_KIND_LABEL, formatDay, parseCard, parseTouchPage } from "@/lib/care/model";
import { parseHouseholdThanks } from "@/lib/care/thanks";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type HouseholdCard } from "../../types";
import { rpcJson } from "../db";

import { cardOf, firstName, requireNiva } from "./shared";

export type HouseholdBriefData = {
  household: HouseholdCard;
  relationship_owner: string | null;
  backup: string | null;
  needs_an_owner: boolean;
  how_they_like_to_be_treated: {
    thanked_by: string | null;
    recognition: string | null;
    preferred_way_to_reach: string | null;
    language: string | null;
    adult_to_reach_first: string | null;
    best_call_time: string | null;
    do_not_ask: boolean;
  };
  what_we_know: { interests: string[]; expertise: string[]; special_days: string[]; anniversaries: string[] };
  how_the_relationship_is_going: { sign: string; reasons: string[] } | null;
  thank_yous_waiting: number | null;
  asking: { status: string; reasons: string[] } | null;
  recent_touches: { when: string; source: string; kind: string; way: string; was_an_ask: boolean }[];
  notes_on_file: number;
  reminders: string[];
};

const input = object({
  household_id: f.uuid("The household (its id, from people.search or another card). A household is never found by name alone."),
});

/** What to know before you call: one household, in words, from the care record. Never an amount, never a note's text. */
export const careHouseholdBrief = defineCommand<Infer<typeof input>, HouseholdBriefData>({
  key: "care.household_brief",
  title: "Brief me on a household before I call",
  description:
    "What to know before calling one household: the household card, its relationship owner, how they like to be thanked and recognised, the way and language to use, who to reach first, interests and expertise on file, " +
    "how the relationship is going (a sign with its reasons), thank-yous waiting, whether it is time to ask (only that, in words) and the last few touches (what kind, how, when; never the words of a note). " +
    "Needs the household's id: find it first with people.search and let the person choose by the card, never by name. No amounts and nothing about anyone under 18. If the household asked not to be asked, say so plainly and never explain why. Read only.",
  level: "read",
  permission: "care",
  module: "care",
  alsoModules: ["ai"],
  assistantOnly: true,
  input,
  async execute(ctx, { household_id }) {
    await requireNiva(ctx);
    const { db, center } = ctx.session;
    const card = parseCard(await rpcJson(db, "care_household_card", { p_household: household_id }, "read the household's care record"));
    if (card.household.id === "") throw new CommandError("That household was not found, or you can't see its care record.");
    const [touchesRaw, factsRaw, thanksRaw, approachRaw] = await Promise.all([
      rpcJson(db, "care_household_touches", { p_household: household_id, p_limit: 6 }, "read the household's touches"),
      rpcJson(db, "care_health_facts", { p_center: center.id, p_households: [household_id] }, "read how the relationship is going"),
      rpcJson(db, "care_household_thanks", { p_household: household_id }, "read the household's thank-yous"),
      rpcJson(db, "care_approach_household", { p_household: household_id }, "read whether it is time to ask"),
    ]);
    const touches = parseTouchPage(touchesRaw);
    const facts = parseHealthFacts(factsRaw);
    const f0 = facts.rows[0];
    const sign = f0 ? classifyHealth(f0, { today: facts.today, historyMonths: facts.historyMonths, giving: facts.giving }) : null;
    const thanks = parseHouseholdThanks(thanksRaw);
    const approach = parseApproachHousehold(approachRaw);
    const p = card.profile;
    const people = card.people ?? [];
    const contact = p?.contactName ?? card.household.primaryMember;
    const callTime = people.find((x) => x.bestCallTime)?.bestCallTime ?? null;

    let asking: HouseholdBriefData["asking"] = null;
    if (approach.state === "excluded") asking = { status: "Do not ask", reasons: [] };
    else if (approach.state === "ready" || approach.state === "held") {
      asking = { status: stateLine(approach) ?? "", reasons: approach.state === "held" ? approach.holds.map(holdLine) : [] };
    }

    const reminders = [
      "Never ask for money in a brief or a note.",
      "A person makes the call or sends the message; Weaver sends nothing.",
      ...(p?.recognition === "anonymous" ? ["They give in private: thank them privately and never name them."] : []),
      ...(p?.recognition === "private_only" ? ["Thank them personally; never name them in public."] : []),
      ...(p?.thanks === "none" ? ["They asked for no thanks: do not call to thank them."] : []),
      ...(p?.doNotAsk ? ["They asked not to be asked: nothing that asks."] : []),
    ];

    return {
      ok: true,
      data: {
        household: cardOf(card.household),
        relationship_owner: card.owners.owner?.name ?? null,
        backup: card.owners.backup?.name ?? null,
        needs_an_owner: card.owners.needsOwner,
        how_they_like_to_be_treated: {
          thanked_by: p?.thanks ? THANKS_LABEL[p.thanks] : null,
          recognition: p?.recognition ? RECOGNITION_LABEL[p.recognition] : null,
          preferred_way_to_reach: p?.channel ? (CHANNEL_LABEL[p.channel] ?? p.channel) : null,
          language: p?.language ?? null,
          adult_to_reach_first: contact ?? null,
          best_call_time: callTime,
          do_not_ask: p?.doNotAsk === true,
        },
        what_we_know: {
          interests: [...new Set(people.flatMap((x) => x.interests))].slice(0, 8),
          expertise: [...new Set(people.flatMap((x) => x.expertise))].slice(0, 8),
          special_days: (card.specialDays ?? []).slice(0, 6).map((d) => [d.label ?? d.kind, d.date ? formatDay(d.date).replace(/\s\d{4}$/, "") : ""].filter(Boolean).join(": ")),
          anniversaries: people.filter((x) => x.anniversary).slice(0, 3).map(() => "An anniversary is on file"),
        },
        how_the_relationship_is_going: sign ? { sign: sign.label, reasons: sign.reasons.slice(0, 5) } : null,
        thank_yous_waiting: thanks.state === "ok" ? thanks.open.length : null,
        asking,
        recent_touches: touches.rows.slice(0, 6).map((t) => ({
          when: formatDay(t.at.slice(0, 10)),
          source: SOURCE_LABEL[t.source] ?? t.source,
          kind: t.kind ? (TOUCH_KIND_LABEL[t.kind as keyof typeof TOUCH_KIND_LABEL] ?? t.kind) : (t.label ?? "A touch"),
          way: t.channel ? (CHANNEL_LABEL[t.channel] ?? t.channel) : "",
          was_an_ask: t.isAsk,
        })),
        notes_on_file: card.notesTotal,
        reminders: firstName(contact) ? [`Address them as ${firstName(contact)}.`, ...reminders] : reminders,
      },
    };
  },
});
