import { PLAN_GROUP_LABEL, monthName, parsePlan, parsePlanContext, skeletonPlan } from "@/lib/care/plan";
import { STEP_KIND_LABEL } from "@/lib/care/playbooks";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { rpcJson } from "../db";

import { requireNiva } from "./shared";

export type DraftCarePlanData = {
  year: number;
  organization_mission: string | null;
  fiscal_year_starts_in: string;
  households_in_each_group: { group: string; households: number }[];
  the_organizations_own_calendar: { title: string; on: string }[];
  quiet_periods: { name: string; from: string; to: string; every_year: boolean }[];
  the_plan_today: { status: string; moments: number };
  /** The system's own first draft for the year: plain arithmetic and wording, never an ask. Improve on it in words; a care manager saves, edits and approves it on the screen. */
  first_draft: { summary: string; moments: { on: string; for_whom: string; touch: string; title: string; note: string | null }[] };
  how_to_save_it: string;
};

const input = object({
  year: f.optional(f.integer("The year of the plan (for example 2027). Leave it out for the coming year.", { min: 2000, max: 2100 })),
});

/** A yearly care plan from the mission, the calendar, the fiscal year and the quiet periods. Nothing is saved: a care manager does that. */
export const careDraftCarePlan = defineCommand<Infer<typeof input>, DraftCarePlanData>({
  key: "care.draft_care_plan",
  title: "Draft the yearly care plan",
  description:
    "The material for a yearly relationship-care plan, and a first draft of it: the organization's mission, its fiscal year, its own calendar, its quiet periods, how many households are in each group (a count, never a household), " +
    "and a calendar of moments saying which group of households gets which kind of touch and when. Talk the draft through, suggest changes in words, and explain the thinking. " +
    "It is a draft: nothing is saved or run. A care manager saves it on the care area's Care plan page, edits it and approves it; nothing in a plan ever asks for money. Needs care.manage.",
  level: "draft",
  permission: "careManage",
  module: "care",
  alsoModules: ["ai"],
  assistantOnly: true,
  input,
  async execute(ctx, { year }) {
    await requireNiva(ctx);
    const { db, center } = ctx.session;
    const today = (ctx.now?.() ?? new Date()).toISOString().slice(0, 10);
    const y = year ?? Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 11 ? 1 : 0);
    const [ctxRaw, planRaw] = await Promise.all([
      rpcJson(db, "care_plan_context", { p_center: center.id, p_year: y }, "read what the plan is made from"),
      rpcJson(db, "care_plan_get", { p_center: center.id, p_year: y }, "read the plan"),
    ]);
    const c = parsePlanContext(ctxRaw);
    const plan = parsePlan(planRaw);
    const draft = skeletonPlan(c, y);
    return {
      ok: true,
      data: {
        year: y,
        organization_mission: c.mission,
        fiscal_year_starts_in: monthName(c.fiscalYearStartMonth),
        households_in_each_group: Object.entries(c.groups).map(([g, n]) => ({ group: PLAN_GROUP_LABEL[g as keyof typeof PLAN_GROUP_LABEL] ?? g, households: n ?? 0 })),
        the_organizations_own_calendar: c.calendar.slice(0, 20),
        quiet_periods: c.quietPeriods.map((q) => ({ name: q.name, from: q.startsOn, to: q.endsOn, every_year: q.yearly })),
        the_plan_today: { status: plan.status === "none" ? "No plan yet" : plan.status === "approved" ? "Approved" : "A draft", moments: plan.items.length },
        first_draft: {
          summary: draft.summary,
          moments: draft.items.map((i) => ({ on: i.on, for_whom: PLAN_GROUP_LABEL[i.group], touch: STEP_KIND_LABEL[i.kind], title: i.title, note: i.note || null })),
        },
        how_to_save_it: "A care manager opens the care area, Care plan, chooses the year and presses Draft the plan, then edits it and approves it. Nothing runs until it is approved, and no moment asks for money.",
      },
    };
  },
});
