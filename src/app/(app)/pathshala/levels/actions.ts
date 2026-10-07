"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/lib/errors";
import { DbFailure, FormError, int, ok, reqStr, runAction, str } from "@/lib/forms";
import { pathshalaAreas as areas } from "@/lib/pathshala/access";
import { actionContext } from "@/lib/pathshala/server";
import type { LevelInput } from "@/lib/pathshala-registration/contract";
import { loadLevelRows, NEEDS_UPDATE, saveLevel } from "@/lib/pathshala-registration/db";
import { levelProblem, normalizeLevelKey, parseAgeInput, suggestLevelKey } from "@/lib/pathshala-registration/levels";
import { refusal } from "@/lib/pathshala-registration/refusal";

// Pathshala › Levels (PATHSHALA_REGISTRATION_PLAN §2.1): every write goes through app.save_pathshala_level (0590),
// which checks who may (pathshala.manage) and every value, and retires a used level instead of deleting it.

/** Add a level to a track (no id) or change one: name, key, order and age band. */
export async function saveLevelAction(levelId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveLevel", "save the level", async () => {
    const { supabase, centerId } = await actionContext(areas.manage, "Only the Pathshala principal can change levels.");
    const trackId = reqStr(fd, "track_id", "Track");
    const trackName = str(fd, "track_name");
    const name = reqStr(fd, "name", "Level name");
    const typedKey = str(fd, "key");
    // A new level without a key gets one from its name, in the seed's style ("Jainism 8" → "8").
    const key = typedKey ? normalizeLevelKey(typedKey) : levelId ? "" : suggestLevelKey(name, trackName);
    const sortOrder = int(fd, "sort_order", "Order") ?? 0;
    const min = parseAgeInput(str(fd, "min_age"), "minimum");
    if (!min.ok) throw new FormError(min.error);
    const max = parseAgeInput(str(fd, "max_age"), "maximum");
    if (!max.ok) throw new FormError(max.error);
    const problem = levelProblem({ name, key, sort_order: sortOrder, min_age: min.age, max_age: max.age });
    if (problem) throw new FormError(problem);
    const level: LevelInput = {
      ...(levelId ? { id: levelId } : {}),
      track_id: trackId,
      key,
      name,
      sort_order: sortOrder,
      min_age: min.age,
      max_age: max.age,
      // Retiring and offering again are their own buttons; the form keeps what the level is.
      active: str(fd, "active") !== "false",
    };
    const res = await saveLevel(supabase, centerId, level, str(fd, "reason"));
    if (!res.ok) return refusal(levelId ? `save ${name}` : `add ${name}`, res);
    refresh();
    return ok(levelId ? `${name} saved.` : `${name} added${trackName ? ` to ${trackName}` : ""}.`);
  });
}

/** Retire a level (no longer offered; its classes, enrollments and reports are kept) or offer it again. */
export async function setLevelActiveAction(levelId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  const active = str(fd, "active") === "true";
  const doing = active ? "offer the level again" : "retire the level";
  return runAction("pathshala.setLevelActive", doing, async () => {
    const { supabase, centerId } = await actionContext(areas.manage, "Only the Pathshala principal can retire levels.");
    // Read fresh for the name and the current state; send only {id, active} (0590: a key left out keeps its value), so a
    // stale page never undoes someone else's edit.
    const levels = await loadLevelRows(supabase, centerId);
    if (levels.status === "missing") return { ok: false, error: `Could not ${doing} — ${NEEDS_UPDATE}` };
    if (levels.status === "error") throw new DbFailure(levels.error, "read the level");
    if (levels.status === "shape") throw new FormError(`Could not ${doing} — the level could not be read (${levels.message}).`);
    const level = levels.value.find((l) => l.id === levelId);
    if (!level) throw new FormError("That level no longer exists. Reload the page.");
    if (level.active === active) return ok(active ? `${level.name} is already offered.` : `${level.name} is already retired.`);
    const res = await saveLevel(supabase, centerId, { id: level.id, active }, str(fd, "reason"));
    if (!res.ok) return refusal(active ? `offer ${level.name} again` : `retire ${level.name}`, res);
    refresh();
    return ok(active ? `${level.name} is offered again.` : `${level.name} is retired: it is no longer offered, and its classes and history are kept.`);
  });
}
