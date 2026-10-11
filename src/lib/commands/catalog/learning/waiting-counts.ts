import { isPermissionError } from "@/lib/access-db";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import { CommandDbError, CommandError } from "../../types";

import { NO_ACCESS_HERE } from "./setup";

const input = object({});

/** The counts app.pathshala_task_counts gives, in the words the Pathshala home uses. Only these keys are read; anything else the database might add is ignored. */
const COUNTS: { key: string; what: string; where: string }[] = [
  { key: "to_place", what: "Registrations waiting for the office to place", where: "Pathshala › Enrollments" },
  { key: "held_for_payment", what: "Seats held while a family pays", where: "Pathshala › Enrollments" },
  { key: "held_ending_soon", what: "Held seats that run out within 6 hours", where: "Pathshala › Enrollments" },
  { key: "held_for_membership", what: "Registrations held until the household's membership is active", where: "Pathshala › Enrollments" },
  { key: "waiting_for_waiver", what: "Registrations waiting for a signed waiver", where: "Pathshala › Enrollments" },
  { key: "waitlisted", what: "Places on a waitlist", where: "Pathshala › Enrollments" },
  { key: "children_to_add", what: "Registrations waiting for a family to add their details", where: "Pathshala › Enrollments" },
  { key: "assistance_to_decide", what: "Fee assistance requests to decide", where: "Pathshala › Enrollments" },
  { key: "payments_after_release", what: "Payments that arrived after a seat was released", where: "Pathshala › Enrollments" },
  { key: "levels_without_fee", what: "Levels with a class but no fee, so families cannot choose them yet", where: "Pathshala › Terms › Fees and rules" },
];

export type WaitingCountsData = {
  /** What is waiting, with how many. Only things that have at least one are listed. */
  waiting: { what: string; count: number; where_a_person_does_it: string }[];
  total: number;
  nothing_waiting: boolean;
};

function whole(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** How many Pathshala tasks are waiting (registrations to place, held seats, fee assistance, levels with no fee): counts only. */
export const waitingCounts = defineCommand<Infer<typeof input>, WaitingCountsData>({
  key: "learning.waiting_counts",
  title: "Look at how many Pathshala tasks are waiting",
  description:
    "Say how many Pathshala tasks are waiting for the office: registrations to place, seats held while a family pays, held seats about to run out, registrations waiting for a membership or a waiver, waitlist places, fee assistance requests to decide and levels that have a class but no fee. " +
    "It gives COUNTS only. It never says who or which family: a person works through them on the Pathshala Enrollments screen. It changes nothing.",
  level: "read",
  permission: "pathshala",
  module: "pathshala",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const res = await db.rpc("pathshala_task_counts", { p_center: center.id });
    if (res.error) {
      if (isPermissionError(res.error)) throw new CommandError(NO_ACCESS_HERE);
      throw new CommandDbError(res.error, "count the Pathshala tasks");
    }
    const raw = res.data && typeof res.data === "object" && !Array.isArray(res.data) ? (res.data as Record<string, unknown>) : {};
    const waiting = COUNTS.flatMap((c) => {
      const n = whole(raw[c.key]);
      return n !== null && n > 0 ? [{ what: c.what, count: n, where_a_person_does_it: c.where }] : [];
    });
    const total = waiting.reduce((sum, w) => sum + w.count, 0);
    return {
      ok: true,
      data: { waiting, total, nothing_waiting: waiting.length === 0 },
      message: waiting.length === 0 ? "Nothing is waiting in Pathshala." : waiting.map((w) => `${w.count} · ${w.what.charAt(0).toLowerCase()}${w.what.slice(1)}`).join("; ") + ".",
    };
  },
});
