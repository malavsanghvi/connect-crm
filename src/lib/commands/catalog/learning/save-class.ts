// Add a class, or change one (Pathshala › Classes). The class form's Save button runs this very `execute` (through runCommandFromScreen),
// with the sentences it has always given. A class is set-up data: a name, a level, a day and time, a room and a size. It holds no learner.

import type { TablesInsert, TablesUpdate } from "@/lib/database.types";
import { classTimeLabel } from "@/lib/pathshala/format";
import { schoolOrGeneric } from "@/lib/kind-samples";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandError, type CommandContext, type CommandPreview, type PreviewLine } from "../../types";
import { must } from "../db";

import { NO_TERM } from "./setup";

export const MEETING_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

const input = object({
  class_id: f.optional(f.uuid("The class to change (its id, from learning.classes_needing_teachers or learning.term_setup). Leave it out to add a new class.")),
  term_id: f.optional(f.uuid("The term the class belongs to (its id, from learning.term_setup). Needed for a new class.")),
  level_id: f.optional(f.uuid("The level the class teaches (its id, from learning.term_setup). Needed for a new class.")),
  name: f.optional(f.string("The class name, like 'Level 2 · Room B'. Needed for a new class.", { max: 120 })),
  room: f.optional(f.string("The room. Empty clears it.", { min: 0, max: 80 })),
  capacity: f.optional(f.integer("The most the class takes. 0 means no seats are offered. Leave it out to keep it as it is (a new class then has no limit).", { min: 0, max: 5000 })),
  no_capacity_limit: f.optional(f.boolean("Yes to remove the limit on how many the class takes.")),
  meets_on: f.optional(f.enum("The day the class meets. A new class meets on Sunday unless you say otherwise.", MEETING_DAYS)),
  starts_time: f.optional(f.string("When it starts, as 24-hour HH:MM like 10:00. Empty clears it.", { min: 0, max: 8 })),
  ends_time: f.optional(f.string("When it ends, as 24-hour HH:MM like 11:30. Empty clears it.", { min: 0, max: 8 })),
  class_email: f.optional(f.string("The class's own email address. Empty clears it.", { min: 0, max: 200 })),
  waitlist_enabled: f.optional(f.boolean("Yes when a full class keeps a waitlist.")),
});
export type SaveClassInput = Infer<typeof input>;

type Row = Record<string, unknown>;
const orNull = (s: string | undefined): string | null | undefined => (s === undefined ? undefined : s.trim() === "" ? null : s.trim());

/** The columns this call sets (undefined = leave as it is). A new class gets the same defaults the class form always gave. */
function valuesOf(inp: SaveClassInput, creating: boolean): Row {
  const v: Row = {
    term_id: inp.term_id,
    level_id: inp.level_id,
    name: inp.name,
    room: orNull(inp.room),
    capacity: inp.no_capacity_limit === true ? null : inp.capacity,
    meets_on: inp.meets_on,
    starts_time: orNull(inp.starts_time),
    ends_time: orNull(inp.ends_time),
    class_email: orNull(inp.class_email),
    waitlist_enabled: inp.waitlist_enabled,
  };
  if (creating) {
    if (v.capacity === undefined) v.capacity = null;
    if (v.meets_on === undefined) v.meets_on = "sunday";
    if (v.starts_time === undefined) v.starts_time = null;
    if (v.ends_time === undefined) v.ends_time = null;
    if (v.room === undefined) v.room = null;
    if (v.class_email === undefined) v.class_email = null;
    if (v.waitlist_enabled === undefined) v.waitlist_enabled = false;
  }
  for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
  return v;
}

type Plan = { creating: boolean; values: Row; before: Row | null; termName: string | null; levelName: string | null };

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

async function plan(ctx: CommandContext, inp: SaveClassInput): Promise<Plan> {
  const { db } = ctx.session;
  const screen = ctx.via === "screen";
  const creating = inp.class_id === undefined;
  const values = valuesOf(inp, creating);
  if (creating) {
    // The same words the form's own checks gave.
    if (!values.term_id) throw new CommandError("Term is required.");
    if (!values.level_id) throw new CommandError("Level is required.");
    if (!values.name) throw new CommandError("Class name is required.");
  }
  for (const key of ["starts_time", "ends_time"] as const) {
    const t = values[key];
    if (typeof t === "string" && !TIME.test(t)) throw new CommandError(`${key === "starts_time" ? "Start time" : "End time"} must be a time.`);
  }

  let before: Row | null = null;
  if (!creating) {
    before = must(await db.from("pathshala_classes").select("*").eq("id", inp.class_id as string).maybeSingle(), "find the class") as Row | null;
    if (!before) throw new CommandError(screen ? "That class no longer exists. Reload the page." : "That class was not found, or you can't see it.");
  }
  const starts = (values.starts_time !== undefined ? values.starts_time : before?.starts_time) as string | null | undefined;
  const ends = (values.ends_time !== undefined ? values.ends_time : before?.ends_time) as string | null | undefined;
  if (starts && ends && ends <= starts) throw new CommandError("The class must end after it starts.");

  let termName: string | null = null;
  let levelName: string | null = null;
  const termId = (values.term_id ?? before?.term_id) as string | undefined;
  const levelId = (values.level_id ?? before?.level_id) as string | undefined;
  if (!screen) {
    // For a person asking through Niva or the palette: say plainly when the term or level is not there (the form only offers real ones).
    if (termId) {
      const t = must(await db.from("pathshala_terms").select("name, status").eq("id", termId).maybeSingle(), "find the term") as { name: string } | null;
      if (!t) throw new CommandError(NO_TERM);
      termName = t.name;
    }
    if (levelId) {
      const l = must(await db.from("pathshala_levels").select("name, active").eq("id", levelId).maybeSingle(), "find the level") as { name: string } | null;
      if (!l) throw new CommandError("That level was not found, or you can't see it.");
      levelName = l.name;
    }
  }
  return { creating, values, before, termName, levelName };
}

function whenLine(meetsOn: unknown, starts: unknown): string | null {
  return meetsOn || starts ? classTimeLabel(meetsOn as string | undefined, starts as string | undefined) : null;
}

export const saveClassCommand = defineCommand<SaveClassInput, undefined>({
  key: "learning.save_class",
  title: "Add or change a class",
  description: (kind) => {
    const schoolName = schoolOrGeneric(kind);
    return (
      `Add a ${schoolName} class (a name, a term, a level, the day and time, a room and how many it takes) or change one. Only the details you send change; the rest stay. ` +
      `It shows what the class will look like, or each change from-and-to, and asks the person to confirm. It is about the class itself: it never adds or moves a learner and never assigns a teacher (use learning.assign_teacher for that).`
    );
  },
  level: "confirm",
  permission: "pathshalaManage",
  module: "pathshala",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/pathshala/actions.ts#saveClass"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = await plan(ctx, inp);
    const v = p.values;
    if (p.creating) {
      const lines: PreviewLine[] = [
        { label: "Class", value: String(v.name) },
        ...(p.termName ? [{ label: "Term", value: p.termName }] : []),
        ...(p.levelName ? [{ label: "Level", value: p.levelName }] : []),
        { label: "Meets", value: whenLine(v.meets_on, v.starts_time) ?? "Sunday" },
        { label: "Room", value: (v.room as string | null) ?? "not set" },
        { label: "Takes", value: v.capacity === null ? "no limit" : String(v.capacity) },
        { label: "Waitlist when full", value: v.waitlist_enabled ? "yes" : "no" },
      ];
      return { summary: `Add the class ${String(v.name)}${p.termName ? ` to ${p.termName}` : ""}.`, lines };
    }
    const b = p.before as Row;
    const changed: PreviewLine[] = [];
    const add = (label: string, key: string, show: (x: unknown) => string | null = (x) => (x === null || x === undefined || x === "" ? null : String(x))) => {
      if (key in v && !same(v[key], b[key])) changed.push({ label, before: show(b[key]), after: show(v[key]) });
    };
    add("Class name", "name");
    add("Room", "room");
    add("Takes", "capacity", (x) => (x === null || x === undefined ? "no limit" : String(x)));
    add("Day", "meets_on");
    add("Starts", "starts_time");
    add("Ends", "ends_time");
    add("Class email", "class_email");
    add("Waitlist when full", "waitlist_enabled", (x) => (x ? "yes" : "no"));
    if ("term_id" in v && !same(v.term_id, b.term_id)) changed.push({ label: "Term", before: null, after: p.termName ?? "another term" });
    if ("level_id" in v && !same(v.level_id, b.level_id)) changed.push({ label: "Level", before: null, after: p.levelName ?? "another level" });
    return {
      summary: changed.length ? `Change the class ${String(b.name)}.` : `No changes for the class ${String(b.name)}.`,
      lines: changed,
      warnings: changed.length ? [] : ["Everything you gave is already how the class is set up, so nothing would change."],
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = await plan(ctx, inp);
    const { db, center } = ctx.session;
    if (p.creating) {
      must(await db.from("pathshala_classes").insert({ ...p.values, center_id: center.id } as TablesInsert<"pathshala_classes">), "create the class");
    } else {
      const res = must(await db.from("pathshala_classes").update(p.values as TablesUpdate<"pathshala_classes">).eq("id", inp.class_id as string).select("id"), "save the class");
      if (!res || res.length === 0) throw new CommandError("Could not save the class — it was not found, or you don't have permission to change it.");
    }
    revalidateAfterCommand(["/pathshala"]);
    return { ok: true, data: undefined, message: p.creating ? "Class created." : "Class saved." };
  },
});
