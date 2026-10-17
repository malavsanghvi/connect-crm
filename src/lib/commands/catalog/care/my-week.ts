import { CHANNEL_LABEL, TOUCH_KIND_LABEL } from "@/lib/care/model";
import { draftFor, dueLine, parseWeek, weekLine } from "@/lib/care/week";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import type { HouseholdCard } from "../../types";
import { rpcJson } from "../db";

import { MAX_HOUSEHOLDS, cardOf, requireNiva } from "./shared";

export type MyWeekData = {
  summary: string;
  total: number;
  overdue: number;
  /** Up to five tasks (never more than ten households), the most pressing first. */
  tasks: {
    what: string;
    why: string;
    due: string;
    overdue: boolean;
    kind_of_touch: string;
    how: string;
    household: HouseholdCard;
    first_name_to_use: string | null;
    /** A starting draft in the community's own words, with the name filled. A person sends it; nothing is sent. */
    draft: string | null;
  }[];
  households_needing_an_owner: number;
  reminders: string[];
};

const input = object({});

/** The signed-in person's relationship-care week: the same list as "Your week" in the portal. */
export const careMyWeek = defineCommand<Infer<typeof input>, MyWeekData>({
  key: "care.my_week",
  title: "Show my relationship-care week",
  description:
    "The relationship-care tasks waiting for the person you are helping this week: up to five, the most pressing first, each with why it matters, when it is due, the household (by its card: " +
    "number, adults, city) and a ready draft in the organization's own words. It shows only the households the person owns or backs up. Use it for 'what should I do for our families this week?' " +
    "and to prepare the person for a call. Nothing here is an ask for money and there are no amounts; a person sends any message. If it says Niva is not set up for relationship care, say so and point to the care area.",
  level: "read",
  permission: "care",
  module: "care",
  alsoModules: ["ai"],
  assistantOnly: true,
  input,
  async execute(ctx) {
    await requireNiva(ctx);
    const raw = await rpcJson(ctx.session.db, "care_week", { p_center: ctx.session.center.id }, "read the relationship-care week");
    const w = parseWeek(raw);
    const tasks = w.tasks.slice(0, MAX_HOUSEHOLDS).map((t) => ({
      what: t.title,
      why: t.why,
      due: dueLine(t.dueOn, w.today),
      overdue: t.overdue,
      kind_of_touch: TOUCH_KIND_LABEL[t.touchKind],
      how: CHANNEL_LABEL[t.channel] ?? t.channel,
      household: cardOf(t.household),
      first_name_to_use: t.contact,
      draft: t.draft ? draftFor(t, w) : null,
    }));
    return {
      ok: true,
      data: {
        summary: weekLine(w),
        total: w.total,
        overdue: w.overdue,
        tasks,
        households_needing_an_owner: w.needsOwner,
        reminders: ["A person sends every message; Weaver sends nothing.", "None of these tasks asks for money.", "Open the care area, Your week, to mark a task done."],
      },
      message: w.total === 0 ? "Nothing waits for them this week." : undefined,
    };
  },
});
