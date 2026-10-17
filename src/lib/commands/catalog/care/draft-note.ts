import { parseGestures } from "@/lib/care/gestures";
import { CHANNEL_LABEL, RECOGNITION_LABEL, THANKS_LABEL, TOUCH_KIND_LABEL, formatDay, parseCard, parseTouchPage } from "@/lib/care/model";
import { fillDraft, parsePlaybooks } from "@/lib/care/playbooks";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type HouseholdCard } from "../../types";
import { rpcJson } from "../db";

import { cardOf, firstName, requireNiva } from "./shared";

export type DraftNoteData = {
  household: HouseholdCard;
  purpose: string;
  write_to: string | null;
  sign_off_name: string | null;
  organization: string;
  mission: string | null;
  way_to_send: string;
  language: string | null;
  how_they_like_to_be_thanked: string | null;
  recognition: string | null;
  recent_touches: { when: string; kind: string; way: string; was_an_ask: boolean }[];
  /** Starting drafts from the community's own library (gestures and playbook steps of this purpose), names filled in. */
  starting_drafts: { from: string; text: string }[];
  rules_for_this_note: string[];
};

const PURPOSES = ["thank_you", "check_in", "greeting", "welcome", "update", "invitation"] as const;
const input = object({
  household_id: f.uuid("The household (its id, from people.search or another card). A household is never found by name alone."),
  purpose: f.enum("What the note is for: thank_you, check_in (how are you), greeting (a special day), welcome, update (what their gift did) or invitation (to see or take part).", PURPOSES),
});

/** The facts and starting words to write one personal note from. A draft only: a person sends it. */
export const careDraftNote = defineCommand<Infer<typeof input>, DraftNoteData>({
  key: "care.draft_note",
  title: "Draft a personal note to a household",
  description:
    "The material for ONE personal note to a household: who to write to and by what name, the way and language they prefer, how they like to be thanked and recognised, the organization's mission in a line, the last few touches, " +
    "and starting drafts from the organization's own library, with the names filled in. Write the note from this in the organization's warm voice, short and personal. It is a draft: nothing is sent, a person sends it. " +
    "A note NEVER asks for money, and never mentions an amount. Needs the household's id (people.search first). If rules_for_this_note says they asked not to be asked or for no thanks, follow it.",
  level: "draft",
  permission: "care",
  module: "care",
  alsoModules: ["ai"],
  assistantOnly: true,
  input,
  async execute(ctx, { household_id, purpose }) {
    await requireNiva(ctx);
    const { db, center } = ctx.session;
    const card = parseCard(await rpcJson(db, "care_household_card", { p_household: household_id }, "read the household's care record"));
    if (card.household.id === "") throw new CommandError("That household was not found, or you can't see its care record.");
    const [touchesRaw, gesturesRaw, playbooksRaw, profile] = await Promise.all([
      rpcJson(db, "care_household_touches", { p_household: household_id, p_limit: 3 }, "read the household's touches"),
      rpcJson(db, "care_gestures_list", { p_center: center.id }, "read the gesture library"),
      rpcJson(db, "care_playbooks_list", { p_center: center.id }, "read the playbooks"),
      db.from("org_profiles").select("mission").eq("center_id", center.id).maybeSingle(),
    ]);
    if (profile.error) throw new CommandError("Could not read the organization's mission. Try again in a moment.");
    const mission = (profile.data?.mission ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
    const touches = parseTouchPage(touchesRaw);
    const p = card.profile;
    const org = center.short_name?.trim() || center.name;
    const contact = firstName(p?.contactName ?? card.household.primaryMember);
    const me = firstName(ctx.session.person?.name ?? null);
    const channel = p?.channel ?? "phone";

    const fill = (t: string | null) => fillDraft(t, { name: contact, me, org });
    const fromGestures = parseGestures(gesturesRaw).gestures
      .filter((g) => g.enabled && g.suggest && g.kind === purpose && g.draft)
      .slice(0, 2)
      .map((g) => ({ from: `Gesture: ${g.name}`, text: fill(g.draft) }));
    const fromPlaybooks = parsePlaybooks(playbooksRaw).playbooks
      .filter((pb) => pb.enabled)
      .flatMap((pb) => pb.steps.filter((s) => s.kind === purpose && s.draft).map((s) => ({ from: `Playbook: ${pb.name}`, text: fill(s.draft) })))
      .slice(0, 2);

    const rules = [
      "A person sends this. Nothing is sent by Weaver.",
      "Do not ask for money, and do not mention any amount.",
      ...(p?.thanks === "none" && purpose === "thank_you" ? ["They asked for no thanks: do not write a thank-you note; offer a check-in instead."] : []),
      ...(p?.doNotAsk ? ["They asked not to be asked: the note must not ask for anything."] : []),
      ...(p?.recognition === "anonymous" ? ["They give in private: thank them privately and never name them or their gift."] : []),
      ...(p?.recognition === "private_only" ? ["Never name them in public."] : []),
      ...(p?.language ? [`Write in their language (${p.language}) if the person asking can send it that way.`] : []),
      "Mention a child by name only if the person asking raised it; the card lists adults only.",
    ];

    return {
      ok: true,
      data: {
        household: cardOf(card.household),
        purpose: TOUCH_KIND_LABEL[purpose],
        write_to: contact,
        sign_off_name: me,
        organization: org,
        mission,
        way_to_send: CHANNEL_LABEL[channel] ?? channel,
        language: p?.language ?? null,
        how_they_like_to_be_thanked: p?.thanks ? THANKS_LABEL[p.thanks] : null,
        recognition: p?.recognition ? RECOGNITION_LABEL[p.recognition] : null,
        recent_touches: touches.rows.slice(0, 3).map((t) => ({
          when: formatDay(t.at.slice(0, 10)),
          kind: t.kind ? (TOUCH_KIND_LABEL[t.kind as keyof typeof TOUCH_KIND_LABEL] ?? t.kind) : (t.label ?? "A touch"),
          way: t.channel ? (CHANNEL_LABEL[t.channel] ?? t.channel) : "",
          was_an_ask: t.isAsk,
        })),
        starting_drafts: [...fromGestures, ...fromPlaybooks],
        rules_for_this_note: rules,
      },
    };
  },
});
