"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { Json, TablesUpdate } from "@/lib/database.types";
import type { ActionResult } from "@/lib/errors";
import { all, bool, FormError, int, isoDate, must, ok, oneOf, reqStr, runAction, str } from "@/lib/forms";
import { appendStatusUpdate, mergeLessons, type Lesson } from "@/lib/logic/eams";
import { canStartVoting, nextVoteHistory, periodOpen, toDateRange } from "@/lib/logic/resolutions";
import { randomToken } from "@/lib/logic/tokens";
import { formatDateTime, fromDateTimeLocal } from "@/lib/pathshala/format";
import { actionContext } from "@/lib/pathshala/server";
import { can, hasScopedRole } from "@/lib/permissions";

const PHASES = ["pre", "during", "after"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const ACTION_TYPES = ["task", "meeting", "email", "call", "whatsapp_announcement"] as const;
const STATES = ["not_started", "in_progress", "completed", "removed"] as const;

const eventsManage = (a: Parameters<typeof can>[0]) => can(a, "events.manage");

// ---------------------------------------------------------------------------
// Actions (checklist items)
// ---------------------------------------------------------------------------
function actionValues(fd: FormData) {
  const eventId = str(fd, "event_id");
  const phase = str(fd, "phase");
  if (phase && !(PHASES as readonly string[]).includes(phase)) throw new FormError("Choose Before, During or After.");
  if (phase && !eventId) throw new FormError("A phase only applies to an action that belongs to an event.");
  const owner = str(fd, "owner_person_id");
  const backups = all(fd, "backup_owner_ids").filter((id) => id !== owner);
  return {
    name: reqStr(fd, "name", "Action name"),
    description: str(fd, "description"),
    event_id: eventId,
    phase: (phase as (typeof PHASES)[number] | null) ?? null,
    owner_person_id: owner,
    backup_owner_ids: backups,
    // "During" actions take the event date from the database trigger.
    due_on: phase === "during" && eventId ? null : isoDate(fd, "due_on", "Due date"),
    priority: oneOf(fd, "priority", PRIORITIES, "Priority", "medium"),
    action_type: oneOf(fd, "action_type", ACTION_TYPES, "Type", "task"),
    confidential: bool(fd, "confidential"),
    is_idea: bool(fd, "is_idea"),
  };
}

export async function createAction(_prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.createAction", "create the action", async () => {
    const { supabase, centerId, viewer } = await actionContext();
    const values = actionValues(fd);
    if (!can(viewer, "events.manage") && !(values.event_id && hasScopedRole(viewer, values.event_id, "event_lead"))) {
      throw new FormError("Only event managers, or this event's lead, can add actions.");
    }
    const created = must(
      await supabase.from("actions").insert({ ...values, center_id: centerId, created_by: viewer.userId }).select("id").single(),
      "create the action",
    );
    if (str(fd, "then") === "open" && created) redirect(`/pathshala/committee/actions/${created.id}`);
    refresh();
    return ok("Action added.");
  });
}

export async function updateAction(actionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.updateAction", "save the action", async () => {
    const { supabase } = await actionContext();
    const values = { ...actionValues(fd), state: oneOf(fd, "state", STATES, "State", "not_started") };
    const res = must(await supabase.from("actions").update(values).eq("id", actionId).select("id"), "save the action");
    if (!res?.length) throw new FormError("You can't edit this action (only its owner, the event lead or committee managers can).");
    refresh();
    return ok("Action saved.");
  });
}

export async function setActionState(actionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.setActionState", "update the action", async () => {
    const { supabase } = await actionContext();
    const state = oneOf(fd, "state", STATES, "State");
    const res = must(await supabase.from("actions").update({ state }).eq("id", actionId).select("id"), "update the action");
    if (!res?.length) throw new FormError("You can't change this action.");
    refresh();
    return ok(state === "completed" ? "Marked complete." : state === "in_progress" ? "Marked in progress." : "Updated.");
  });
}

export async function addStatusUpdate(actionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.addStatusUpdate", "add the status note", async () => {
    const { supabase, viewer, tz } = await actionContext();
    const text = reqStr(fd, "text", "Status note");
    const current = must(await supabase.from("actions").select("status_updates").eq("id", actionId).maybeSingle(), "load the action");
    if (!current) throw new FormError("That action no longer exists or you can't see it.");
    const status_updates = appendStatusUpdate(current.status_updates, {
      date: new Date().toISOString(),
      text,
      author: viewer.displayName,
    });
    const res = must(await supabase.from("actions").update({ status_updates }).eq("id", actionId).select("id"), "add the status note");
    if (!res?.length) throw new FormError("You can't update this action.");
    void tz;
    refresh();
    return ok("Note added.");
  });
}

export async function deleteAction(actionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("committee.deleteAction", "delete the action", async () => {
    const { supabase } = await actionContext(eventsManage, "Only committee members who manage events can delete actions.");
    const res = must(await supabase.from("actions").delete().eq("id", actionId).select("id"), "delete the action");
    if (!res?.length) throw new FormError("You can't delete this action.");
    redirect("/pathshala/committee/actions");
  });
}

/**
 * Push an event action back to its template (EAMS "push to template"): the
 * template item with the same name in that phase is overwritten, otherwise
 * added; sibling events from the same template that are not in the past and
 * lack the action get a copy.
 */
export async function pushActionToTemplate(actionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("committee.pushActionToTemplate", "push the action to its template", async () => {
    const { supabase, centerId, viewer, tz } = await actionContext(eventsManage, "Only committee members who manage events can change templates.");
    const action = must(await supabase.from("actions").select("*").eq("id", actionId).maybeSingle(), "load the action");
    if (!action?.event_id || !action.phase) throw new FormError("Only actions that belong to an event phase can be pushed to a template.");
    const event = must(await supabase.from("events").select("id, template_id, starts_at").eq("id", action.event_id).maybeSingle(), "load the event");
    if (!event?.template_id) throw new FormError("This event wasn't created from a template.");
    const items = must(
      await supabase.from("event_template_items").select("*").eq("template_id", event.template_id).eq("phase", action.phase),
      "load the template checklist",
    ) ?? [];
    const match = items.find((i) => i.name.trim().toLowerCase() === action.name.trim().toLowerCase());
    const offset =
      action.due_on && event.starts_at && action.phase !== "during"
        ? Math.round((Date.parse(action.due_on + "T00:00:00Z") - Date.parse(event.starts_at.slice(0, 10) + "T00:00:00Z")) / 86_400_000)
        : null;
    const spec = {
      name: action.name,
      description: action.description,
      priority: action.priority,
      action_type: action.action_type,
      confidential: action.confidential,
      offset_days: offset ?? match?.offset_days ?? null,
    };
    let itemId: string;
    if (match) {
      must(await supabase.from("event_template_items").update(spec).eq("id", match.id), "update the template item");
      itemId = match.id;
    } else {
      const created = must(
        await supabase
          .from("event_template_items")
          .insert({ ...spec, center_id: centerId, template_id: event.template_id, phase: action.phase, sort_order: items.length * 10 + 10 })
          .select("id")
          .single(),
        "add the template item",
      );
      itemId = created!.id;
    }
    if (!action.template_item_id) {
      must(await supabase.from("actions").update({ template_item_id: itemId }).eq("id", action.id), "link the action to the template");
    }
    // Fan out to sibling events from the same template that are still ahead.
    const today = new Date().toISOString().slice(0, 10);
    const siblings = (must(await supabase.from("events").select("id, starts_at").eq("template_id", event.template_id).neq("id", event.id), "find sibling events") ?? []).filter(
      (e) => !e.starts_at || e.starts_at.slice(0, 10) >= today,
    );
    let added = 0;
    if (siblings.length) {
      const existing = must(
        await supabase.from("actions").select("event_id, name").in("event_id", siblings.map((s) => s.id)).eq("phase", action.phase),
        "check sibling events",
      ) ?? [];
      const inserts = siblings
        .filter((s) => !existing.some((x) => x.event_id === s.id && x.name.trim().toLowerCase() === action.name.trim().toLowerCase()))
        .map((s) => ({
          center_id: centerId,
          event_id: s.id,
          phase: action.phase,
          template_item_id: itemId,
          name: spec.name,
          description: spec.description,
          priority: spec.priority,
          action_type: spec.action_type,
          confidential: spec.confidential,
          due_on: spec.offset_days !== null && s.starts_at ? shiftDate(s.starts_at, spec.offset_days) : null,
          created_by: viewer.userId,
        }));
      if (inserts.length) {
        must(await supabase.from("actions").insert(inserts), "add the action to other events");
        added = inserts.length;
      }
    }
    void tz;
    refresh();
    return ok(`${match ? "Template item updated" : "Added to the template"}${added ? ` and to ${added} upcoming event${added === 1 ? "" : "s"}` : ""}.`);
  });
}

function shiftDate(isoTs: string, days: number) {
  const d = new Date(isoTs.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------
export async function saveTemplate(templateId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.saveTemplate", "save the template", async () => {
    const { supabase, centerId } = await actionContext(eventsManage, "Only committee members who manage events can change templates.");
    const values = {
      name: reqStr(fd, "name", "Template name"),
      description: str(fd, "description"),
      default_owner_person_id: str(fd, "default_owner_person_id"),
      confidential: bool(fd, "confidential"),
    };
    if (templateId) {
      must(await supabase.from("event_templates").update(values).eq("id", templateId), "save the template");
      refresh();
      return ok("Template saved.");
    }
    const created = must(await supabase.from("event_templates").insert({ ...values, center_id: centerId }).select("id").single(), "create the template");
    redirect(`/pathshala/committee/templates/${created!.id}`);
  });
}

export async function saveTemplateItem(templateId: string, itemId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.saveTemplateItem", "save the checklist item", async () => {
    const { supabase, centerId } = await actionContext(eventsManage, "Only committee members who manage events can change templates.");
    const phase = oneOf(fd, "phase", PHASES, "Phase");
    const values = {
      phase,
      name: reqStr(fd, "name", "Item name"),
      description: str(fd, "description"),
      priority: oneOf(fd, "priority", PRIORITIES, "Priority", "medium"),
      action_type: oneOf(fd, "action_type", ACTION_TYPES, "Type", "task"),
      offset_days: phase === "during" ? null : int(fd, "offset_days", "Days from the event", { min: -365, max: 365 }),
      sort_order: int(fd, "sort_order", "Order") ?? 0,
      confidential: bool(fd, "confidential"),
    };
    if (itemId) {
      must(await supabase.from("event_template_items").update(values).eq("id", itemId), "save the checklist item");
    } else {
      must(await supabase.from("event_template_items").insert({ ...values, center_id: centerId, template_id: templateId }), "add the checklist item");
    }
    refresh();
    return ok(itemId ? "Item saved." : "Item added.");
  });
}

export async function deleteTemplateItem(itemId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("committee.deleteTemplateItem", "remove the checklist item", async () => {
    const { supabase } = await actionContext(eventsManage, "Only committee members who manage events can change templates.");
    must(await supabase.from("event_template_items").delete().eq("id", itemId), "remove the checklist item");
    refresh();
    return ok("Item removed.");
  });
}

export async function addLesson(target: { table: "event_templates" | "events"; id: string }, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.addLesson", "save the lesson", async () => {
    const { supabase, viewer } = await actionContext();
    if (target.table === "event_templates" && !can(viewer, "events.manage")) throw new FormError("Only committee members who manage events can change templates.");
    const text = reqStr(fd, "text", "Lesson");
    const current = must(await supabase.from(target.table).select("lessons_learned").eq("id", target.id).maybeSingle(), "load lessons learned");
    if (!current) throw new FormError("That record no longer exists or you can't see it.");
    const lessons = Array.isArray(current.lessons_learned) ? (current.lessons_learned as Lesson[]) : [];
    const next = [...lessons, { id: randomToken(8), text, author: viewer.displayName, created_at: new Date().toISOString() }];
    const res = must(await supabase.from(target.table).update({ lessons_learned: next }).eq("id", target.id).select("id"), "save the lesson");
    if (!res?.length) throw new FormError("You can't edit this record.");
    refresh();
    return ok("Lesson added.");
  });
}

export async function removeLesson(target: { table: "event_templates" | "events"; id: string }, lessonId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("committee.removeLesson", "remove the lesson", async () => {
    const { supabase } = await actionContext();
    const current = must(await supabase.from(target.table).select("lessons_learned").eq("id", target.id).maybeSingle(), "load lessons learned");
    if (!current) throw new FormError("That record no longer exists or you can't see it.");
    const lessons = (Array.isArray(current.lessons_learned) ? (current.lessons_learned as Lesson[]) : []).filter((l) => l.id !== lessonId);
    const res = must(await supabase.from(target.table).update({ lessons_learned: lessons }).eq("id", target.id).select("id"), "remove the lesson");
    if (!res?.length) throw new FormError("You can't edit this record.");
    refresh();
    return ok("Lesson removed.");
  });
}

/** Merge an event's lessons learned into its template (same id overwrites, new ones append). */
export async function pushLessonsToTemplate(eventId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("committee.pushLessonsToTemplate", "copy lessons to the template", async () => {
    const { supabase } = await actionContext(eventsManage, "Only committee members who manage events can change templates.");
    const event = must(await supabase.from("events").select("template_id, lessons_learned").eq("id", eventId).maybeSingle(), "load the event");
    if (!event?.template_id) throw new FormError("This event wasn't created from a template.");
    const template = must(await supabase.from("event_templates").select("lessons_learned").eq("id", event.template_id).maybeSingle(), "load the template");
    if (!template) throw new FormError("The template no longer exists.");
    const merged = mergeLessons(template.lessons_learned, event.lessons_learned);
    must(await supabase.from("event_templates").update({ lessons_learned: merged }).eq("id", event.template_id), "save the template lessons");
    refresh();
    return ok(`Template now has ${merged.length} lesson${merged.length === 1 ? "" : "s"}.`);
  });
}

// ---------------------------------------------------------------------------
// Pathshala year: one event per template via rpc('create_event_from_template')
// ---------------------------------------------------------------------------
export async function createYear(_prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.createYear", "create the Pathshala year", async () => {
    // The RPC is SECURITY DEFINER and does not check permissions itself, so this check matters.
    const { supabase, tz } = await actionContext(eventsManage, "Only committee members who manage events can create a Pathshala year.");
    const year = reqStr(fd, "program_year", "Pathshala year");
    if (!/^\d{4}-\d{4}$/.test(year)) throw new FormError('Write the year like "2026-2027".');
    const templateIds = all(fd, "template_id");
    if (!templateIds.length) throw new FormError("Choose at least one template.");
    const created: string[] = [];
    const failed: string[] = [];
    for (const templateId of templateIds) {
      const name = str(fd, `name_${templateId}`) ?? reqStr(fd, `default_name_${templateId}`, "Event name");
      const date = str(fd, `date_${templateId}`);
      let startsAt: string | null = null;
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FormError(`The date for "${name}" isn't valid.`);
        // Default the start time to 10:00 local; edit it on the event.
        startsAt = fromDateTimeLocal(`${date}T10:00`, tz);
      }
      const { error } = await supabase.rpc("create_event_from_template", {
        p_template: templateId,
        p_name: name,
        // The generated type says string, but the SQL parameter accepts null (an undated event).
        p_starts_at: startsAt as string,
        p_program_year: year,
      });
      if (error) {
        console.error("[committee.createYear] template failed", templateId, error);
        failed.push(name);
      } else created.push(name);
    }
    refresh();
    if (failed.length) {
      throw new FormError(
        `Created ${created.length} event${created.length === 1 ? "" : "s"}; could not create: ${failed.join(", ")}. Try those again (already-created ones won't be duplicated if you untick them).`,
      );
    }
    return ok(`Created ${created.length} event${created.length === 1 ? "" : "s"} for ${year}.`);
  });
}

// ---------------------------------------------------------------------------
// Concerns
// ---------------------------------------------------------------------------
const pathshalaManage = (a: Parameters<typeof can>[0]) => can(a, "pathshala.manage");

export async function createConcern(_prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.createConcern", "log the concern", async () => {
    const { supabase, centerId, viewer } = await actionContext(pathshalaManage, "Only the Pathshala principal can log concerns here.");
    must(
      await supabase.from("concerns").insert({
        center_id: centerId,
        source: oneOf(fd, "source", ["teacher", "parent", "member", "other"] as const, "Source"),
        submitter_name: str(fd, "submitter_name"),
        submitter_email: str(fd, "submitter_email"),
        submitter_phone: str(fd, "submitter_phone"),
        class_id: str(fd, "class_id"),
        title: reqStr(fd, "title", "Title"),
        description: reqStr(fd, "description", "Description"),
        suggestions: str(fd, "suggestions"),
        owner_user_id: bool(fd, "assign_me") ? viewer.userId : null,
      }),
      "log the concern",
    );
    refresh();
    return ok("Concern logged.");
  });
}

export async function updateConcern(concernId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.updateConcern", "save the concern", async () => {
    const { supabase, viewer } = await actionContext();
    const current = must(await supabase.from("concerns").select("status_updates, status").eq("id", concernId).maybeSingle(), "load the concern");
    if (!current) throw new FormError("That concern no longer exists or you can't see it.");
    const status = oneOf(fd, "status", ["reported", "in_progress", "closed"] as const, "Status");
    const resolution = str(fd, "resolution");
    if (status === "closed" && !resolution) throw new FormError("Write how the concern was resolved before closing it.");
    const note = str(fd, "note");
    const updates = Array.isArray(current.status_updates) ? current.status_updates : [];
    const patch: TablesUpdate<"concerns"> = { status, resolution };
    const owner = str(fd, "owner");
    if (owner === "me") patch.owner_user_id = viewer.userId;
    else if (owner === "none") patch.owner_user_id = null;
    if (note || status !== current.status) {
      patch.status_updates = [
        ...updates,
        { date: new Date().toISOString(), text: note ?? `Status changed to ${status.replace("_", " ")}`, author: viewer.displayName },
      ] as Json;
    }
    const res = must(
      await supabase.from("concerns").update(patch).eq("id", concernId).select("id"),
      "save the concern",
    );
    if (!res?.length) throw new FormError("You can't change this concern (only its owner or the Pathshala principal can).");
    refresh();
    return ok("Concern saved.");
  });
}

/** EAMS "⚡ Create action" from a concern: creates the action and links it. */
export async function createActionFromConcern(concernId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.createActionFromConcern", "create an action from the concern", async () => {
    const { supabase, centerId, viewer } = await actionContext(
      (a) => can(a, "events.manage") && can(a, ["pathshala.manage", "pathshala.view"]),
      "You need to manage committee actions to do this.",
    );
    const concern = must(await supabase.from("concerns").select("*").eq("id", concernId).maybeSingle(), "load the concern");
    if (!concern) throw new FormError("That concern no longer exists or you can't see it.");
    if (concern.linked_action_id) throw new FormError("This concern already has an action.");
    const action = must(
      await supabase
        .from("actions")
        .insert({
          center_id: centerId,
          name: str(fd, "name") ?? `Concern: ${concern.title}`,
          description: [concern.description, concern.suggestions ? `Suggestions: ${concern.suggestions}` : null].filter(Boolean).join("\n\n"),
          owner_person_id: str(fd, "owner_person_id"),
          due_on: isoDate(fd, "due_on", "Due date"),
          priority: oneOf(fd, "priority", PRIORITIES, "Priority", "high"),
          created_by: viewer.userId,
        })
        .select("id")
        .single(),
      "create the action",
    );
    const linked = must(
      await supabase.from("concerns").update({ linked_action_id: action!.id, status: concern.status === "reported" ? "in_progress" : concern.status }).eq("id", concernId).select("id"),
      "link the action to the concern",
    );
    if (!linked?.length) throw new FormError("The action was created but could not be linked to the concern (you may not be allowed to edit it).");
    refresh();
    return ok("Action created and linked.");
  });
}

// ---------------------------------------------------------------------------
// Resolutions (comment period -> voting -> outcome)
// ---------------------------------------------------------------------------
const govManage = (a: Parameters<typeof can>[0]) => can(a, "governance.manage");

export async function saveResolution(resolutionId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.saveResolution", "save the resolution", async () => {
    const { supabase, centerId, viewer } = await actionContext(govManage, "Only committee chairs (governance managers) can create or edit resolutions.");
    const values = {
      title: reqStr(fd, "title", "Title"),
      description: str(fd, "description"),
      rationale: str(fd, "rationale"),
      quorum: int(fd, "quorum", "Quorum", { min: 1, max: 50 }) ?? 4,
    };
    if (resolutionId) {
      const cur = must(await supabase.from("resolutions").select("voting_status").eq("id", resolutionId).maybeSingle(), "load the resolution");
      if (cur?.voting_status === "completed" && !viewer.isPlatformAdmin) throw new FormError("Voting has closed; only the outcome note can change now.");
      must(await supabase.from("resolutions").update(values).eq("id", resolutionId), "save the resolution");
      refresh();
      return ok("Resolution saved.");
    }
    const created = must(
      await supabase.from("resolutions").insert({ ...values, center_id: centerId, created_by: viewer.userId }).select("id").single(),
      "create the resolution",
    );
    redirect(`/pathshala/committee/resolutions/${created!.id}`);
  });
}

export async function setPeriod(resolutionId: string, kind: "comment" | "voting", _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.setPeriod", "update the period", async () => {
    const { supabase } = await actionContext(govManage, "Only committee chairs can open, pause or close periods.");
    const r = must(await supabase.from("resolutions").select("*").eq("id", resolutionId).maybeSingle(), "load the resolution");
    if (!r) throw new FormError("That resolution no longer exists.");
    if (r.withdrawn_at) throw new FormError("This resolution was withdrawn.");
    const to = oneOf(fd, "to", ["started", "paused", "completed"] as const, "Change");
    const today = new Date().toISOString().slice(0, 10);
    const current = kind === "comment" ? r.comment_status : r.voting_status;
    const patch: TablesUpdate<"resolutions"> = kind === "comment" ? { comment_status: to } : { voting_status: to };
    if (to === "started" && current === "not_started") {
      const start = isoDate(fd, "start", "Opens on") ?? today;
      const end = isoDate(fd, "end", "Closes on");
      if (!end) throw new FormError("Choose the closing date.");
      if (end < start) throw new FormError("The closing date must be on or after the opening date.");
      if (kind === "comment") patch.comment_period = toDateRange(start, end);
      else patch.voting_period = toDateRange(start, end);
      if (kind === "voting") {
        if (!canStartVoting(r, today)) throw new FormError("Voting can only start after the comment period is closed (or its closing date has passed).");
        if (r.comment_status !== "completed") patch.comment_status = "completed";
      }
    } else if (to === "started" && current !== "paused") {
      throw new FormError("Only a paused period can be resumed.");
    } else if (to === "paused" && current !== "started") {
      throw new FormError("Only an open period can be paused.");
    } else if (to === "completed" && current !== "started" && current !== "paused") {
      throw new FormError("Only an open or paused period can be closed.");
    }
    must(await supabase.from("resolutions").update(patch).eq("id", resolutionId), "update the period");
    refresh();
    return ok(to === "started" ? (current === "paused" ? "Resumed." : "Opened.") : to === "paused" ? "Paused." : "Closed.");
  });
}

export async function addComment(resolutionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.addComment", "add your comment", async () => {
    const { supabase, centerId, viewer } = await actionContext((a) => can(a, "governance.view"), "Only committee members can comment.");
    const r = must(await supabase.from("resolutions").select("comment_status, comment_period, withdrawn_at").eq("id", resolutionId).maybeSingle(), "load the resolution");
    if (!r) throw new FormError("That resolution no longer exists.");
    if (r.withdrawn_at || !periodOpen(r.comment_status, r.comment_period, new Date().toISOString().slice(0, 10))) {
      throw new FormError("The comment period isn't open.");
    }
    must(
      await supabase.from("resolution_comments").insert({ center_id: centerId, resolution_id: resolutionId, author_user: viewer.userId, body: reqStr(fd, "body", "Comment") }),
      "add your comment",
    );
    refresh();
    return ok("Comment added.");
  });
}

export async function editComment(commentId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.editComment", "save your comment", async () => {
    const { supabase, viewer } = await actionContext((a) => can(a, "governance.view"), "Only committee members can comment.");
    const intent = str(fd, "intent");
    if (intent === "delete") {
      const res = must(await supabase.from("resolution_comments").delete().eq("id", commentId).eq("author_user", viewer.userId).select("id"), "delete your comment");
      if (!res?.length) throw new FormError("You can only delete your own comments.");
      refresh();
      return ok("Comment deleted.");
    }
    const res = must(
      await supabase
        .from("resolution_comments")
        .update({ body: reqStr(fd, "body", "Comment"), edited_at: new Date().toISOString() })
        .eq("id", commentId)
        .eq("author_user", viewer.userId)
        .select("id"),
      "save your comment",
    );
    if (!res?.length) throw new FormError("You can only edit your own comments.");
    refresh();
    return ok("Comment saved.");
  });
}

export async function castVote(resolutionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.castVote", "record your vote", async () => {
    const { supabase, centerId, viewer } = await actionContext((a) => can(a, "governance.vote"), "Only current committee members can vote.");
    const r = must(await supabase.from("resolutions").select("voting_status, voting_period, withdrawn_at").eq("id", resolutionId).maybeSingle(), "load the resolution");
    if (!r) throw new FormError("That resolution no longer exists.");
    if (r.withdrawn_at || !periodOpen(r.voting_status, r.voting_period, new Date().toISOString().slice(0, 10))) {
      throw new FormError("Voting isn't open.");
    }
    const vote = oneOf(fd, "vote", ["yes", "no", "abstain"] as const, "Vote");
    const reason = str(fd, "reason");
    const existing = must(
      await supabase.from("resolution_votes").select("*").eq("resolution_id", resolutionId).eq("voter_user", viewer.userId).maybeSingle(),
      "load your previous vote",
    );
    const now = new Date().toISOString();
    if (existing) {
      must(
        await supabase
          .from("resolution_votes")
          .update({ vote, reason, voted_at: now, vote_history: nextVoteHistory(existing) })
          .eq("id", existing.id),
        "change your vote",
      );
      refresh();
      return ok(`Vote changed to ${vote}.`);
    }
    must(
      await supabase.from("resolution_votes").insert({ center_id: centerId, resolution_id: resolutionId, voter_user: viewer.userId, vote, reason, voted_at: now }),
      "record your vote",
    );
    refresh();
    return ok(`Voted ${vote}.`);
  });
}

export async function saveOutcome(resolutionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.saveOutcome", "save the outcome note", async () => {
    const { supabase } = await actionContext(govManage, "Only committee chairs can write the outcome note.");
    must(await supabase.from("resolutions").update({ outcome_note: str(fd, "outcome_note") }).eq("id", resolutionId), "save the outcome note");
    refresh();
    return ok("Outcome note saved.");
  });
}

export async function setWithdrawn(resolutionId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("committee.setWithdrawn", "update the resolution", async () => {
    const { supabase, viewer } = await actionContext(govManage, "Only committee chairs can withdraw resolutions.");
    const withdraw = str(fd, "withdraw") === "1";
    const r = must(await supabase.from("resolutions").select("voting_status").eq("id", resolutionId).maybeSingle(), "load the resolution");
    if (!r) throw new FormError("That resolution no longer exists.");
    if (withdraw && r.voting_status === "completed") throw new FormError("A resolution can't be withdrawn after voting has closed.");
    if (!withdraw && !can(viewer, "settings.manage")) throw new FormError("Only a center admin can restore a withdrawn resolution.");
    must(
      await supabase
        .from("resolutions")
        .update(withdraw ? { withdrawn_at: new Date().toISOString(), withdrawn_by: viewer.userId } : { withdrawn_at: null, withdrawn_by: null })
        .eq("id", resolutionId),
      "update the resolution",
    );
    refresh();
    return ok(withdraw ? `Withdrawn on ${formatDateTime(new Date().toISOString())}.` : "Restored.");
  });
}
