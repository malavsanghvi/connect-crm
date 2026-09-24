"use server";

import { revalidatePath } from "next/cache";

import { eventActionContext } from "@/lib/data/events";
import type { ActionResult } from "@/lib/errors";
import { bool, FormError, isoDate, must, oneOf, reqStr, runAction, str } from "@/lib/events/forms";
import { can } from "@/lib/permissions";

type Result = ActionResult<unknown>;

export async function saveGroup(groupId: string | null, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("volunteers.saveGroup", "save the group", async () => {
    const { db, centerId } = await eventActionContext((a) => can(a, "volunteers.manage"), "only the volunteer coordinator can change groups.");
    const values = {
      name: reqStr(fd, "name", "Group name"),
      coordinator_person_id: str(fd, "coordinator_person_id"),
      requires_background_check: bool(fd, "requires_background_check"),
      requires_waiver_kind: str(fd, "requires_waiver_kind"),
    };
    if (groupId) {
      const res = must(await db.from("volunteer_groups").update(values).eq("id", groupId).select("id"), "save the group");
      if (!res?.length) throw new FormError("you can't edit this group.");
    } else must(await db.from("volunteer_groups").insert({ ...values, center_id: centerId }), "add the group");
    revalidatePath("/events/volunteers");
    return { ok: true, message: groupId ? "Group saved." : "Group added." };
  });
}

export async function setInterestStatus(interestId: string, _prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("volunteers.setInterestStatus", "update the volunteer", async () => {
    const { db } = await eventActionContext((a) => can(a, "volunteers.manage"), "only the volunteer coordinator can change volunteer status.");
    const status = oneOf(fd, "status", ["interested", "active", "inactive"] as const, "Status");
    const res = must(await db.from("volunteer_interests").update({ status }).eq("id", interestId).select("id"), "update the volunteer");
    if (!res?.length) throw new FormError("you can't change this volunteer.");
    revalidatePath("/events/volunteers");
    return { ok: true, message: status === "active" ? "Marked active." : status === "inactive" ? "Marked inactive." : "Updated." };
  });
}

export async function addInterest(_prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("volunteers.addInterest", "add the volunteer", async () => {
    const { db, centerId } = await eventActionContext((a) => can(a, "volunteers.manage"), "only the volunteer coordinator can add volunteers.");
    must(
      await db.from("volunteer_interests").insert({
        center_id: centerId,
        person_id: reqStr(fd, "person_id", "Person"),
        group_id: reqStr(fd, "group_id", "Group"),
        status: oneOf(fd, "status", ["interested", "active"] as const, "Status", "active"),
      }),
      "add the volunteer",
    );
    revalidatePath("/events/volunteers");
    return { ok: true, message: "Volunteer added." };
  });
}

export async function recordBackgroundCheck(_prev: Result | null, fd: FormData): Promise<Result> {
  return runAction("volunteers.recordBackgroundCheck", "record the background check", async () => {
    const { db, centerId, userId } = await eventActionContext((a) => can(a, "safety.manage"), "only people with safety access can record background checks.");
    const status = oneOf(fd, "status", ["requested", "clear", "flagged", "expired"] as const, "Result");
    const cleared = isoDate(fd, "cleared_on", "Cleared on");
    const expires = isoDate(fd, "expires_on", "Expires on");
    if (status === "clear" && !expires) throw new FormError("enter when a clear check expires (usually two years).");
    if (cleared && expires && expires <= cleared) throw new FormError("the expiry must be after the clearance date.");
    must(
      await db.from("background_checks").insert({
        center_id: centerId,
        person_id: reqStr(fd, "person_id", "Person"),
        provider: str(fd, "provider"),
        provider_ref: str(fd, "provider_ref"),
        status,
        cleared_on: cleared,
        expires_on: expires,
        recorded_by: userId,
      }),
      "record the background check",
    );
    revalidatePath("/events/volunteers");
    return { ok: true, message: "Background check recorded." };
  });
}
