"use server";

import { refresh } from "next/cache";

import type { ActionResult } from "@/lib/errors";
import { bool, cents, dateList, dateTime, FormError, int, isoDate, must, oneOf, reqStr, runAction, str, ok, time } from "@/lib/forms";
import { isAttendanceStatus, type AttendanceStatus } from "@/lib/logic/attendance";
import { pathshalaAreas as areas } from "@/lib/pathshala/access";
import { actionContext, searchPeople, type PersonOption } from "@/lib/pathshala/server";
import { can, hasScopedRole, type ScopedContext } from "@/lib/permissions";
import type { AppSupabase } from "@/lib/supabase/server";

const TERM_STATUSES = ["draft", "registration", "active", "closed"] as const;
const TEACHER_ROLES = ["teacher", "assistant", "substitute"] as const;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------
export async function saveTerm(termId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveTerm", "save the term", async () => {
    const { supabase, centerId, tz } = await actionContext(areas.manage, "Only the Pathshala principal can change terms.");
    const startsOn = isoDate(fd, "starts_on", "Start date");
    const endsOn = isoDate(fd, "ends_on", "End date");
    if (!startsOn || !endsOn) throw new FormError("Start and end dates are required.");
    if (endsOn < startsOn) throw new FormError("The term must end after it starts.");
    const opens = dateTime(fd, "registration_opens_at", "Registration opens", tz);
    const closes = dateTime(fd, "registration_closes_at", "Registration closes", tz);
    if (opens && closes && closes < opens) throw new FormError("Registration must close after it opens.");
    const values = {
      name: reqStr(fd, "name", "Term name"),
      starts_on: startsOn,
      ends_on: endsOn,
      registration_opens_at: opens,
      registration_closes_at: closes,
      membership_required: bool(fd, "membership_required"),
      fee_per_child_cents: cents(fd, "fee_per_child", "Fee per child") ?? 0,
      fee_per_family_cap_cents: cents(fd, "fee_family_cap", "Family cap"),
      sibling_discount_pct: int(fd, "sibling_discount_pct", "Sibling discount", { min: 0, max: 100 }) ?? 0,
      no_class_dates: dateList(fd, "no_class_dates", "No-class dates").filter((d) => d >= startsOn && d <= endsOn),
      status: oneOf(fd, "status", TERM_STATUSES, "Status", "draft"),
    };
    if (termId) {
      must(await supabase.from("pathshala_terms").update(values).eq("id", termId), "save the term");
    } else {
      must(await supabase.from("pathshala_terms").insert({ ...values, center_id: centerId }), "create the term");
    }
    refresh();
    return ok(termId ? "Term saved." : "Term created.");
  });
}

// ---------------------------------------------------------------------------
// Classes and teachers
// ---------------------------------------------------------------------------
export async function saveClass(classId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveClass", "save the class", async () => {
    const { supabase, centerId } = await actionContext(areas.manage, "Only the Pathshala principal can change classes.");
    const starts = time(fd, "starts_time", "Start time");
    const ends = time(fd, "ends_time", "End time");
    if (starts && ends && ends <= starts) throw new FormError("The class must end after it starts.");
    const values = {
      term_id: reqStr(fd, "term_id", "Term"),
      level_id: reqStr(fd, "level_id", "Level"),
      name: reqStr(fd, "name", "Class name"),
      room: str(fd, "room"),
      capacity: int(fd, "capacity", "Capacity", { min: 0 }),
      meets_on: oneOf(fd, "meets_on", ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], "Meeting day", "sunday"),
      starts_time: starts,
      ends_time: ends,
      class_email: str(fd, "class_email"),
      waitlist_enabled: bool(fd, "waitlist_enabled"),
    };
    if (classId) {
      must(await supabase.from("pathshala_classes").update(values).eq("id", classId), "save the class");
    } else {
      must(await supabase.from("pathshala_classes").insert({ ...values, center_id: centerId }), "create the class");
    }
    refresh();
    return ok(classId ? "Class saved." : "Class created.");
  });
}

/** Adds the teacher to the class and, when the signed-in user may manage roles, grants the class-scoped teacher role. */
export async function addTeacher(classId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.addTeacher", "add the teacher", async () => {
    const { supabase, centerId, viewer } = await actionContext(areas.manage, "Only the Pathshala principal can assign teachers.");
    const personId = reqStr(fd, "person_id", "Teacher");
    const role = oneOf(fd, "role", TEACHER_ROLES, "Role", "teacher");
    must(
      await supabase.from("pathshala_teachers").insert({ center_id: centerId, class_id: classId, person_id: personId, role }),
      "add the teacher to this class",
    );
    const note = await syncTeacherGrant(supabase, viewer, centerId, classId, personId, "grant", viewer.userId);
    refresh();
    return ok(`Teacher added.${note ? " " + note : ""}`);
  });
}

export async function removeTeacher(teacherRowId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("pathshala.removeTeacher", "remove the teacher", async () => {
    const { supabase, centerId, viewer } = await actionContext(areas.manage, "Only the Pathshala principal can remove teachers.");
    const row = must(await supabase.from("pathshala_teachers").select("class_id, person_id").eq("id", teacherRowId).maybeSingle(), "find the teacher");
    if (!row) throw new FormError("That teacher is no longer on this class.");
    must(await supabase.from("pathshala_teachers").delete().eq("id", teacherRowId), "remove the teacher");
    const note = await syncTeacherGrant(supabase, viewer, centerId, row.class_id, row.person_id, "revoke", viewer.userId);
    refresh();
    return ok(`Teacher removed.${note ? " " + note : ""}`);
  });
}

/**
 * A pathshala_teachers row alone does not give the teacher access: RLS checks
 * role_grants (teacher, scope = class). Keep them in step when we are allowed to
 * (roles.manage); otherwise say plainly what the center admin must do.
 */
async function syncTeacherGrant(
  supabase: AppSupabase,
  access: ScopedContext,
  centerId: string,
  classId: string,
  personId: string,
  mode: "grant" | "revoke",
  actorUserId: string,
): Promise<string | null> {
  const adminHint =
    mode === "grant"
      ? "Their access to this class must be granted by a center admin in Settings → Roles and access (role: Teacher, scoped to this class)."
      : "Ask a center admin to end their Teacher role for this class.";
  if (!can(access, "roles.manage")) return adminHint;
  const { data: cu, error: cuError } = await supabase
    .from("center_users")
    .select("user_id")
    .eq("center_id", centerId)
    .eq("person_id", personId)
    .maybeSingle();
  if (cuError) {
    console.error("[pathshala] teacher login lookup failed", cuError);
    return "We couldn't look up their login, so their class access was not changed. " + adminHint;
  }
  if (!cu) return "They haven't signed in yet, so their class access will need to be granted after they do.";
  if (mode === "grant") {
    const { data: existing, error: exError } = await supabase
      .from("role_grants")
      .select("id, ends_at")
      .eq("center_id", centerId)
      .eq("user_id", cu.user_id)
      .eq("role_key", "teacher")
      .eq("scope_id", classId);
    if (exError) {
      console.error("[pathshala] teacher grant lookup failed", exError);
      return "Their class access could not be checked. " + adminHint;
    }
    if ((existing ?? []).some((g) => !g.ends_at || g.ends_at > new Date().toISOString())) return "They already had teacher access to this class.";
    const { error } = await supabase.from("role_grants").insert({
      center_id: centerId,
      user_id: cu.user_id,
      role_key: "teacher",
      scope_kind: "class",
      scope_id: classId,
      granted_by: actorUserId,
      reason: "Assigned as Pathshala teacher",
    });
    if (error) {
      console.error("[pathshala] granting teacher role failed", error);
      return "Their class access could not be granted automatically. " + adminHint;
    }
    return "They can now open this class under Pathshala → My classes.";
  }
  const { error } = await supabase
    .from("role_grants")
    .update({ ends_at: new Date().toISOString() })
    .eq("center_id", centerId)
    .eq("user_id", cu.user_id)
    .eq("role_key", "teacher")
    .eq("scope_id", classId)
    .is("ends_at", null);
  if (error) {
    console.error("[pathshala] ending teacher role failed", error);
    return "Their class access could not be ended automatically. " + adminHint;
  }
  return "Their teacher access to this class has ended.";
}

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------
async function seatsTaken(supabase: AppSupabase, classId: string): Promise<number> {
  const res = await supabase
    .from("pathshala_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .in("status", ["placed", "active"]);
  if (res.error) throw new FormError("We couldn't check how many seats are left in that class. Try again.");
  return res.count ?? 0;
}

export async function placeEnrollment(enrollmentId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.placeEnrollment", "place the student", async () => {
    const { supabase } = await actionContext(areas.manage, "Only the Pathshala principal can place students.");
    const classId = reqStr(fd, "class_id", "Class");
    const cls = must(await supabase.from("pathshala_classes").select("id, name, capacity").eq("id", classId).maybeSingle(), "find the class");
    if (!cls) throw new FormError("That class no longer exists.");
    if (cls.capacity !== null && !bool(fd, "over_capacity")) {
      const taken = await seatsTaken(supabase, classId);
      if (taken >= cls.capacity) {
        throw new FormError(`${cls.name} is full (${taken} of ${cls.capacity}). Waitlist the student, raise the capacity, or tick "Place even if full".`);
      }
    }
    must(
      await supabase
        .from("pathshala_enrollments")
        .update({ class_id: classId, status: "placed", placed_at: new Date().toISOString() })
        .eq("id", enrollmentId),
      "place the student",
    );
    refresh();
    return ok(`Placed in ${cls.name}.`);
  });
}

/**
 * Staff enroll a student directly (walk-in or phone registration): the
 * student's household is looked up (the enrollment belongs to it), and the
 * student is placed straight into a class when one is chosen.
 */
export async function enrollStudent(termId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.enrollStudent", "enroll the student", async () => {
    const { supabase, centerId, viewer } = await actionContext(areas.manage, "Only the Pathshala principal can enroll students.");
    const personId = reqStr(fd, "person_id", "Student");
    const classId = str(fd, "class_id");
    let levelId = str(fd, "requested_level_id");
    const memberships = (must(
      await supabase.from("household_members").select("household_id, is_primary, role").eq("person_id", personId).is("left_at", null),
      "find the student's household",
    ) ?? []);
    if (!memberships.length) throw new FormError("This person isn't in a household yet. Add them to their family in People first, then enroll them.");
    const household = memberships.find((m) => m.is_primary) ?? memberships.find((m) => m.role === "child") ?? memberships[0];
    const existing = must(
      await supabase.from("pathshala_enrollments").select("id, status").eq("term_id", termId).eq("student_person_id", personId).maybeSingle(),
      "check for an existing enrollment",
    );
    if (existing) throw new FormError(`This student already has an enrollment this term (${existing.status}). Change it in the list below.`);
    let className: string | null = null;
    if (classId) {
      const cls = must(await supabase.from("pathshala_classes").select("id, name, capacity, level_id, term_id").eq("id", classId).maybeSingle(), "find the class");
      if (!cls || cls.term_id !== termId) throw new FormError("Choose a class in this term.");
      if (cls.capacity !== null && !bool(fd, "over_capacity")) {
        const taken = await seatsTaken(supabase, classId);
        if (taken >= cls.capacity) throw new FormError(`${cls.name} is full (${taken} of ${cls.capacity}). Tick "Place even if full" or choose another class.`);
      }
      levelId = levelId ?? cls.level_id;
      className = cls.name;
    }
    const now = new Date().toISOString();
    must(
      await supabase.from("pathshala_enrollments").insert({
        center_id: centerId,
        term_id: termId,
        student_person_id: personId,
        household_id: household.household_id,
        requested_level_id: levelId,
        class_id: classId,
        status: classId ? "placed" : "requested",
        placed_at: classId ? now : null,
        registered_by: viewer.userId,
        notes: str(fd, "notes"),
      }),
      "enroll the student",
    );
    refresh();
    return ok(className ? `Enrolled and placed in ${className}.` : "Enrollment added to Requested.");
  });
}

export async function waitlistEnrollment(enrollmentId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.waitlistEnrollment", "waitlist the student", async () => {
    const { supabase } = await actionContext(areas.manage, "Only the Pathshala principal can manage the waitlist.");
    const classId = str(fd, "class_id");
    must(
      await supabase.from("pathshala_enrollments").update({ status: "waitlisted", class_id: classId }).eq("id", enrollmentId),
      "waitlist the student",
    );
    refresh();
    return ok("Added to the waitlist.");
  });
}

export async function setEnrollmentStatus(enrollmentId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.setEnrollmentStatus", "update the enrollment", async () => {
    const { supabase } = await actionContext(areas.manage, "Only the Pathshala principal can change enrollments.");
    const status = oneOf(fd, "status", ["requested", "active", "withdrawn", "completed"] as const, "Status");
    const patch: { status: string; class_id?: null } = { status };
    if (status === "requested") patch.class_id = null;
    must(await supabase.from("pathshala_enrollments").update(patch).eq("id", enrollmentId), "update the enrollment");
    refresh();
    return ok(
      status === "withdrawn" ? "Enrollment withdrawn." : status === "active" ? "Marked active." : status === "requested" ? "Moved back to requests." : "Marked completed.",
    );
  });
}

export async function saveEnrollmentNote(enrollmentId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveEnrollmentNote", "save the note", async () => {
    const { supabase } = await actionContext(areas.manage, "Only the Pathshala principal can edit enrollment notes.");
    must(await supabase.from("pathshala_enrollments").update({ notes: str(fd, "notes") }).eq("id", enrollmentId), "save the note");
    refresh();
    return ok("Note saved.");
  });
}

// ---------------------------------------------------------------------------
// Attendance (teacher screen). Called with plain objects from the client.
// ---------------------------------------------------------------------------
const canTakeAttendance = areas.takeAttendance;

async function ensureSession(supabase: AppSupabase, centerId: string, classId: string, heldOn: string, userId: string) {
  const find = async () =>
    must(await supabase.from("pathshala_sessions").select("*").eq("class_id", classId).eq("held_on", heldOn).maybeSingle(), "open the class session");
  const existing = await find();
  if (existing) return existing;
  const inserted = await supabase
    .from("pathshala_sessions")
    .insert({ center_id: centerId, class_id: classId, held_on: heldOn, opened_by: userId })
    .select("*")
    .single();
  if (inserted.error) {
    // Someone else opened it at the same moment: use theirs.
    if (inserted.error.code === "23505") {
      const again = await find();
      if (again) return again;
    }
    must(inserted, "open the class session");
  }
  return inserted.data!;
}

function validDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new FormError("Pick a valid class date.");
  return v;
}

export async function markAttendance(input: {
  classId: string;
  heldOn: string;
  enrollmentId: string;
  status: AttendanceStatus;
  note?: string | null;
}): Promise<ActionResult<{ sessionId: string }>> {
  return runAction("pathshala.markAttendance", "save attendance", async () => {
    const { supabase, centerId, viewer } = await actionContext(
      (a) => canTakeAttendance(a, input.classId),
      "You can only take attendance for classes you teach.",
    );
    if (!isAttendanceStatus(input.status)) throw new FormError("Choose Present, Late, Absent or Excused.");
    const session = await ensureSession(supabase, centerId, input.classId, validDate(input.heldOn), viewer.userId);
    must(
      await supabase.from("pathshala_attendance").upsert(
        {
          center_id: centerId,
          session_id: session.id,
          enrollment_id: input.enrollmentId,
          status: input.status,
          note: input.note?.trim() || null,
          marked_by: viewer.userId,
          marked_via: hasScopedRole(viewer, input.classId, "teacher") && !viewer.isPlatformAdmin ? "teacher" : "admin",
          marked_at: new Date().toISOString(),
        },
        { onConflict: "session_id,enrollment_id" },
      ),
      "save attendance",
    );
    return ok("Saved.", { sessionId: session.id });
  }) as Promise<ActionResult<{ sessionId: string }>>;
}

export async function markAllPresent(input: { classId: string; heldOn: string; enrollmentIds: string[] }): Promise<ActionResult<unknown>> {
  return runAction("pathshala.markAllPresent", "mark everyone present", async () => {
    const { supabase, centerId, viewer } = await actionContext(
      (a) => canTakeAttendance(a, input.classId),
      "You can only take attendance for classes you teach.",
    );
    if (!input.enrollmentIds.length) return ok("Everyone is already marked.");
    const session = await ensureSession(supabase, centerId, input.classId, validDate(input.heldOn), viewer.userId);
    const now = new Date().toISOString();
    const via = hasScopedRole(viewer, input.classId, "teacher") && !viewer.isPlatformAdmin ? "teacher" : "admin";
    must(
      await supabase.from("pathshala_attendance").upsert(
        input.enrollmentIds.map((enrollment_id) => ({
          center_id: centerId,
          session_id: session.id,
          enrollment_id,
          status: "present",
          marked_by: viewer.userId,
          marked_via: via,
          marked_at: now,
        })),
        { onConflict: "session_id,enrollment_id", ignoreDuplicates: true },
      ),
      "mark everyone present",
    );
    return ok(`${input.enrollmentIds.length} marked present.`);
  });
}

export async function openAttendanceQr(input: { classId: string; heldOn: string; token: string; expiresAt: string }): Promise<ActionResult<unknown>> {
  return runAction("pathshala.openAttendanceQr", "show the class QR code", async () => {
    const { supabase, centerId, viewer } = await actionContext(
      (a) => canTakeAttendance(a, input.classId),
      "You can only show the QR code for classes you teach.",
    );
    if (!/^[0-9a-f]{16,128}$/.test(input.token)) throw new FormError("The QR code could not be generated. Try again.");
    const session = await ensureSession(supabase, centerId, input.classId, validDate(input.heldOn), viewer.userId);
    must(
      await supabase
        .from("pathshala_sessions")
        .update({ attendance_token: input.token, token_expires_at: input.expiresAt, opened_by: viewer.userId })
        .eq("id", session.id),
      "save the class QR code",
    );
    return ok("QR ready.", { sessionId: session.id });
  });
}

export async function closeAttendanceQr(input: { classId: string; heldOn: string }): Promise<ActionResult<unknown>> {
  return runAction("pathshala.closeAttendanceQr", "turn off the class QR code", async () => {
    const { supabase } = await actionContext((a) => canTakeAttendance(a, input.classId), "You can only manage classes you teach.");
    must(
      await supabase
        .from("pathshala_sessions")
        .update({ attendance_token: null, token_expires_at: null })
        .eq("class_id", input.classId)
        .eq("held_on", validDate(input.heldOn)),
      "turn off the class QR code",
    );
    return ok("QR code turned off.");
  });
}

export async function saveSessionTopic(classId: string, heldOn: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveSessionTopic", "save the topic", async () => {
    const { supabase, centerId, viewer } = await actionContext((a) => canTakeAttendance(a, classId), "You can only edit classes you teach.");
    const session = await ensureSession(supabase, centerId, classId, validDate(heldOn), viewer.userId);
    must(await supabase.from("pathshala_sessions").update({ topic: str(fd, "topic") }).eq("id", session.id), "save the topic");
    refresh();
    return ok("Topic saved.");
  });
}

// ---------------------------------------------------------------------------
// Gyan Path sign-offs
// ---------------------------------------------------------------------------
export async function decideSignoff(signoffId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.decideSignoff", "record the sign-off", async () => {
    const { supabase, viewer } = await actionContext(areas.signoffs, "Only teachers and the Pathshala principal can sign off Gyan Path levels.");
    // "Sign off" submits approved; "Needs practice" submits needs_work. A note is optional (prototype).
    const decision = oneOf(fd, "decision", ["approved", "needs_work"] as const, "Decision", "approved");
    const note = str(fd, "note");
    const updated = must(
      await supabase
        .from("gyan_signoffs")
        .update({ status: decision, note, teacher_user: viewer.userId, decided_at: new Date().toISOString() })
        .eq("id", signoffId)
        .select("id"),
      "record the sign-off",
    );
    if (!updated?.length) throw new FormError("You can't sign off this student (they may not be in a class you teach).");
    refresh();
    const who = str(fd, "student");
    return ok(
      decision === "approved"
        ? `Gyan Path sign-off recorded${who ? ` for ${who}` : ""}.`
        : `${who ?? "The student"} will practise more${note ? " — your note was sent" : ""}.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Class announcements
// ---------------------------------------------------------------------------
export async function saveAnnouncement(announcementId: string | null, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.saveAnnouncement", "save the announcement", async () => {
    const { supabase, centerId, viewer } = await actionContext(areas.announcements, "You can't post Pathshala announcements.");
    const termId = reqStr(fd, "term_id", "Term");
    const scope = reqStr(fd, "scope", "Audience");
    const classId = scope === "term" ? null : scope;
    if (!classId && !can(viewer, "pathshala.manage")) {
      throw new FormError("Only the Pathshala principal can post to the whole Pathshala. Choose one of your classes.");
    }
    if (classId && !can(viewer, "pathshala.manage") && !hasScopedRole(viewer, classId, "teacher")) {
      throw new FormError("You can only post to classes you teach.");
    }
    const publish = str(fd, "intent") === "publish";
    const values = {
      term_id: termId,
      class_id: classId,
      title: reqStr(fd, "title", "Title"),
      body_md: reqStr(fd, "body_md", "Message"),
      ...(publish ? { published_at: new Date().toISOString() } : {}),
    };
    if (announcementId) {
      must(await supabase.from("class_announcements").update(values).eq("id", announcementId), "save the announcement");
    } else {
      must(
        await supabase.from("class_announcements").insert({ ...values, center_id: centerId, author_user: viewer.userId }),
        "create the announcement",
      );
    }
    refresh();
    return ok(publish ? "Published to families." : "Draft saved.");
  });
}

export async function setAnnouncementPublished(announcementId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  return runAction("pathshala.publishAnnouncement", "update the announcement", async () => {
    const { supabase } = await actionContext(areas.announcements, "You can't post Pathshala announcements.");
    const publish = str(fd, "publish") === "1";
    const res = must(
      await supabase
        .from("class_announcements")
        .update({ published_at: publish ? new Date().toISOString() : null })
        .eq("id", announcementId)
        .select("id"),
      "update the announcement",
    );
    if (!res?.length) throw new FormError("You can only change announcements you wrote for your classes.");
    refresh();
    return ok(publish ? "Published." : "Moved back to draft.");
  });
}

export async function deleteAnnouncement(announcementId: string, _prev: unknown, fd: FormData): Promise<ActionResult<unknown>> {
  void fd;
  return runAction("pathshala.deleteAnnouncement", "delete the announcement", async () => {
    const { supabase } = await actionContext(areas.announcements, "You can't manage Pathshala announcements.");
    const res = must(await supabase.from("class_announcements").delete().eq("id", announcementId).select("id"), "delete the announcement");
    if (!res?.length) throw new FormError("You can only delete announcements you're allowed to manage.");
    refresh();
    return ok("Deleted.");
  });
}

// ---------------------------------------------------------------------------
// People search for the teacher picker (RLS decides who can be found)
// ---------------------------------------------------------------------------
export async function searchPeopleAction(query: string): Promise<ActionResult<PersonOption[]>> {
  return runAction("pathshala.searchPeople", "search people", async () => {
    const { supabase, centerId } = await actionContext();
    const { people, error } = await searchPeople(supabase, centerId, typeof query === "string" ? query : "");
    if (error) return { ok: false, error };
    return ok(undefined, people);
  });
}
