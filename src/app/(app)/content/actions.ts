"use server";

import { revalidatePath } from "next/cache";

import type { Json, TablesInsert } from "@/lib/database.types";
import { defaultMemberStep, isMemberStep, MEMBER_LEGAL_KINDS, mergePointsRules, mergeTimingRules, PRACTICE_CATEGORIES, publishEffect, quizFromFields, slugify } from "@/lib/content";
import { failure, type ActionResult } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}
function intOrNull(fd: FormData, key: string): number | null | "bad" {
  const v = text(fd, key);
  if (!v) return null;
  return /^-?\d+$/.test(v) ? Number(v) : "bad";
}
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Approval queue (content_items.status in_review → published | draft)
// ---------------------------------------------------------------------------
export async function decideContentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const decision = text(fd, "decision");
  const doing = decision === "return" ? "return the item to its author" : "publish the item";
  const auth = await authorizeAction("contentApprove", doing);
  if (!auth.ok) return auth;
  const { db, userId } = auth.session;
  if (!can(auth.session, "content.manage")) {
    return { ok: false, error: `Could not ${doing} — publishing also needs content.manage (the database only lets content managers change an item's status).` };
  }
  const id = text(fd, "id");
  if (!isUuid(id) || (decision !== "approve" && decision !== "return")) return { ok: false, error: `Could not ${doing} — the request was incomplete. Reload and try again.` };
  const cur = await db.from("content_items").select("id, title, status").eq("id", id).maybeSingle();
  if (cur.error) return failure(`Could not ${doing}`, cur.error);
  if (!cur.data) return { ok: false, error: `Could not ${doing} — the item no longer exists, or you can't see it.` };
  if (cur.data.status !== "in_review") return { ok: false, error: `Could not ${doing} — "${cur.data.title}" is no longer awaiting approval.` };
  const reason = text(fd, "reason").slice(0, 500);
  if (decision === "return" && !reason) return { ok: false, error: `Could not ${doing} — say what the author should change.` };
  const patch =
    decision === "approve"
      ? { status: "published", approved_by: userId, published_at: new Date().toISOString() }
      : { status: "draft", approved_by: null };
  // A return carries its reason onto the audit entry (x-audit-reason).
  const writer = decision === "return" ? await dbWithReason(auth.session, reason) : db;
  const { error } = await writer.from("content_items").update(patch).eq("id", id).eq("status", "in_review");
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content", "layout");
  return { ok: true, message: decision === "approve" ? `"${cur.data.title}" published.` : `"${cur.data.title}" returned to its author.` };
}

/** Approve or reject every photo still waiting in one album. */
export async function decideAlbumPhotosAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const decision = text(fd, "decision");
  const doing = decision === "return" ? "reject the waiting photos" : "approve the waiting photos";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const { db, userId, center } = auth.session;
  const albumId = text(fd, "album_id");
  if (!isUuid(albumId) || (decision !== "approve" && decision !== "return")) return { ok: false, error: `Could not ${doing} — the request was incomplete.` };
  const { data, error } = await db
    .from("photos")
    .update({ status: decision === "approve" ? "approved" : "rejected", moderated_by: userId })
    .eq("center_id", center.id)
    .eq("album_id", albumId)
    .eq("status", "pending")
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  const n = data?.length ?? 0;
  if (n === 0) return { ok: false, error: `Could not ${doing} — no photos in that album are waiting any more.` };
  revalidatePath("/content", "layout");
  return { ok: true, message: `${n} photo${n === 1 ? "" : "s"} ${decision === "approve" ? "approved" : "rejected"}.` };
}

export async function moderatePhotoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const status = text(fd, "status");
  const auth = await authorizeAction("contentManage", "moderate the photo");
  if (!auth.ok) return auth;
  const { db, userId } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id) || !["approved", "rejected", "removed"].includes(status)) return { ok: false, error: "Could not moderate the photo — the request was incomplete." };
  const { data, error } = await db.from("photos").update({ status, moderated_by: userId }).eq("id", id).select("id");
  if (error) return failure("Could not moderate the photo", error);
  if (!data?.length) return { ok: false, error: "Could not moderate the photo — it no longer exists, or you can't change it." };
  revalidatePath("/content", "layout");
  return { ok: true, message: status === "approved" ? "Photo approved." : status === "rejected" ? "Photo rejected." : "Photo removed." };
}

export async function createAlbumAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("contentManage", "create the album");
  if (!auth.ok) return auth;
  const { db, userId, center } = auth.session;
  const title = text(fd, "title");
  const eventId = text(fd, "event_id");
  const visibility = text(fd, "visibility") || "members";
  const externalUrl = text(fd, "external_url");
  if (!title) return { ok: false, error: "Could not create the album — give it a title." };
  if (!["public", "members", "private"].includes(visibility)) return { ok: false, error: "Could not create the album — choose who can see it." };
  if (externalUrl && !/^https?:\/\//i.test(externalUrl)) return { ok: false, error: "Could not create the album — the link must start with https://." };
  const { error } = await db.from("photo_albums").insert({
    center_id: center.id,
    title,
    event_id: isUuid(eventId) ? eventId : null,
    visibility,
    external_url: externalUrl || null,
    created_by: userId,
  });
  if (error) return failure("Could not create the album", error);
  revalidatePath("/content/photos");
  return { ok: true, message: `Album "${title}" created. Photos upload from the ops app or the web.` };
}

// ---------------------------------------------------------------------------
// Content items (Library, live darshan, Niva sources)
// ---------------------------------------------------------------------------
const ITEM_KINDS = ["sutra", "pachchakhan", "audio_lesson", "video", "guide_page", "explainer", "darshan_stream", "niva_source", "faq", "other"];
const META_KEYS = ["when", "series", "length_minutes", "source", "schedule", "stream_status", "items_count"] as const;

export async function saveContentItemAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const submit = text(fd, "submit") === "review";
  const doing = submit ? "send the item for approval" : "save the item";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  const { db, userId, center } = auth.session;
  const id = text(fd, "id");
  const kind = text(fd, "kind");
  const title = text(fd, "title");
  const bodyMd = text(fd, "body_md");
  const mediaUrl = text(fd, "media_url");
  const mediaPath = text(fd, "media_path");
  if (!ITEM_KINDS.includes(kind)) return { ok: false, error: `Could not ${doing} — choose what kind of item it is.` };
  if (!title) return { ok: false, error: `Could not ${doing} — give it a title.` };
  if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) return { ok: false, error: `Could not ${doing} — the media link must start with https://.` };
  const metadata: Record<string, Json> = {};
  for (const k of META_KEYS) {
    const v = text(fd, `meta_${k}`);
    if (!v) continue;
    if (k === "length_minutes" || k === "items_count") {
      if (!/^\d+$/.test(v)) return { ok: false, error: `Could not ${doing} — ${k === "length_minutes" ? "the length" : "the item count"} must be a whole number.` };
      metadata[k] = Number(v);
    } else metadata[k] = v.slice(0, 300);
  }
  const status = submit ? "in_review" : "draft";
  if (isUuid(id)) {
    const cur = await db.from("content_items").select("metadata, status, center_id").eq("id", id).maybeSingle();
    if (cur.error) return failure(`Could not ${doing}`, cur.error);
    if (!cur.data) return { ok: false, error: `Could not ${doing} — the item no longer exists, or you can't edit it.` };
    if (cur.data.center_id === null) return { ok: false, error: `Could not ${doing} — shared items come from the platform library and can't be edited here.` };
    const merged = { ...((cur.data.metadata ?? {}) as Record<string, Json>), ...metadata };
    for (const k of META_KEYS) if (fd.has(`meta_${k}`) && !text(fd, `meta_${k}`)) delete merged[k];
    // Any edit of a published item goes back through approval.
    const { error } = await db
      .from("content_items")
      .update({ kind, title, body_md: bodyMd || null, media_url: mediaUrl || null, media_path: mediaPath || null, metadata: merged, status, approved_by: null })
      .eq("id", id);
    if (error) return failure(`Could not ${doing}`, error);
  } else {
    const row: TablesInsert<"content_items"> = {
      center_id: center.id,
      kind,
      slug: slugify(text(fd, "slug") || title) || `item-${Date.now()}`,
      title,
      body_md: bodyMd || null,
      media_url: mediaUrl || null,
      media_path: mediaPath || null,
      metadata,
      status,
      created_by: userId,
    };
    const { error } = await db.from("content_items").insert(row);
    if (error) return failure(`Could not ${doing}`, error);
  }
  revalidatePath("/content", "layout");
  return { ok: true, message: submit ? `"${title}" sent for approval. It appears in the Approval queue.` : `"${title}" saved as a draft.` };
}

// ---------------------------------------------------------------------------
// Today & darshan
// ---------------------------------------------------------------------------
export async function saveTimingRulesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the daily timings");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const cur = await db.from("centers").select("rules").eq("id", center.id).single();
  if (cur.error) return failure("Could not save the daily timings", cur.error);
  const merged = mergeTimingRules(cur.data.rules, {
    derasar_hours: text(fd, "derasar_hours"),
    aarti: text(fd, "aarti"),
    snatra_puja: text(fd, "snatra_puja"),
  });
  if (!merged.ok) return { ok: false, error: `Could not save the daily timings — ${merged.error}` };
  const { error } = await db.from("centers").update({ rules: merged.rules as Json }).eq("id", center.id);
  if (error) return failure("Could not save the daily timings", error);
  revalidatePath("/content/today");
  return { ok: true, message: "Daily timings saved and audited." };
}

const DAY_FIELDS = ["sunrise", "sunset", "navkarsi", "chauvihar", "aarti", "temple_open", "temple_close"] as const;

/** Per-day override (connect-admin's "Enter timings for a day"). */
export async function saveDayTimingsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("contentManage", "save the timings for that day");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const onDate = text(fd, "on_date");
  if (!DATE.test(onDate)) return { ok: false, error: "Could not save the timings — choose the date." };
  const row: TablesInsert<"daily_timings"> = { center_id: center.id, on_date: onDate };
  for (const f of DAY_FIELDS) {
    const v = text(fd, f);
    if (v && !TIME.test(v)) return { ok: false, error: `Could not save the timings — ${f.replace("_", " ")} is not a valid time.` };
    row[f] = v || null;
  }
  const { error } = await db.from("daily_timings").upsert(row, { onConflict: "center_id,on_date" });
  if (error) return failure("Could not save the timings for that day", error);
  revalidatePath("/content/today");
  return { ok: true, message: `Timings for ${onDate} saved.` };
}

// ---------------------------------------------------------------------------
// Practices & points
// ---------------------------------------------------------------------------
export async function savePracticeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the practice" : "add the practice";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const name = text(fd, "name");
  const category = text(fd, "category");
  const key = (text(fd, "key") || slugify(name)).replace(/-/g, "_");
  const defaultTime = text(fd, "default_time");
  const points = intOrNull(fd, "points");
  const minutes = intOrNull(fd, "default_minutes");
  const order = intOrNull(fd, "sort_order");
  if (!name) return { ok: false, error: `Could not ${doing} — give it a name.` };
  if (!PRACTICE_CATEGORIES.some((c) => c.key === category)) return { ok: false, error: `Could not ${doing} — choose a category.` };
  if (!key) return { ok: false, error: `Could not ${doing} — give it a short key.` };
  if (defaultTime && !TIME.test(defaultTime)) return { ok: false, error: `Could not ${doing} — the default time is not a valid time.` };
  if (points === "bad" || (points !== null && (points < 0 || points > 1000))) return { ok: false, error: `Could not ${doing} — points must be a whole number from 0 to 1000.` };
  if (minutes === "bad" || (minutes !== null && minutes < 0)) return { ok: false, error: `Could not ${doing} — minutes must be a whole number.` };
  if (order === "bad") return { ok: false, error: `Could not ${doing} — the order must be a whole number.` };
  const values = {
    name,
    category,
    key,
    description: text(fd, "description") || null,
    default_time: defaultTime || null,
    default_minutes: minutes,
    points: points ?? 1,
    sort_order: order ?? 0,
    active: fd.get("active") === "on",
  };
  const { error } = isUuid(id)
    ? await db.from("practices").update(values).eq("id", id).eq("center_id", center.id)
    : await db.from("practices").insert({ ...values, center_id: center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/practices");
  return { ok: true, message: isUuid(id) ? `"${name}" saved.` : `"${name}" added to the catalog.` };
}

export async function savePointsRulesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the points and Saathi rules");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const cur = await db.from("centers").select("rules").eq("id", center.id).single();
  if (cur.error) return failure("Could not save the points and Saathi rules", cur.error);
  const input: Record<string, string> = {};
  for (const k of ["day_complete_bonus", "anumodana_points", "anumodana_daily_cap", "support_points", "behind_after_days", "streak_rest_days_per_month"]) {
    input[k] = text(fd, k);
  }
  const merged = mergePointsRules(cur.data.rules, input);
  if (!merged.ok) return { ok: false, error: `Could not save the rules — ${merged.error}` };
  const { error } = await db.from("centers").update({ rules: merged.rules as Json }).eq("id", center.id);
  if (error) return failure("Could not save the points and Saathi rules", error);
  revalidatePath("/content/practices");
  return { ok: true, message: "My Jain Way points and Saathi rules saved and audited." };
}

// ---------------------------------------------------------------------------
// Gyan Path (goals → levels → steps)
// ---------------------------------------------------------------------------
const TRADITIONS = ["shvetambar_murtipujak", "sthanakvasi", "terapanthi", "digambar", "other"] as const;

export async function saveGoalAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the goal" : "create the goal";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const name = text(fd, "name");
  const tradition = text(fd, "tradition");
  const order = intOrNull(fd, "sort_order");
  if (!name) return { ok: false, error: `Could not ${doing} — give it a name.` };
  if (tradition && !(TRADITIONS as readonly string[]).includes(tradition)) return { ok: false, error: `Could not ${doing} — choose a tradition.` };
  if (order === "bad") return { ok: false, error: `Could not ${doing} — the order must be a whole number.` };
  const values = {
    name,
    key: (text(fd, "key") || slugify(name)).replace(/-/g, "_"),
    tradition: (tradition || null) as (typeof TRADITIONS)[number] | null,
    description: text(fd, "description") || null,
    sort_order: order ?? 0,
    recommended: fd.get("recommended") === "on",
  };
  if (isUuid(id)) {
    const { error } = await db.from("gyan_goals").update(values).eq("id", id).eq("center_id", center.id);
    if (error) return failure(`Could not ${doing}`, error);
    revalidatePath("/content/gyan-path");
    return { ok: true, message: `"${name}" saved.` };
  }
  const { error } = await db.from("gyan_goals").insert({ ...values, center_id: center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/gyan-path");
  return { ok: true, message: `"${name}" created. Open it to add its levels.` };
}

export async function saveLevelAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the level" : "add the level";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const { db } = auth.session;
  const goalId = text(fd, "goal_id");
  const name = text(fd, "name");
  const points = intOrNull(fd, "points");
  const order = intOrNull(fd, "sort_order");
  if (!isUuid(goalId)) return { ok: false, error: `Could not ${doing} — choose the goal first.` };
  if (!name) return { ok: false, error: `Could not ${doing} — give the level a name.` };
  if (points === "bad" || (points !== null && points < 0)) return { ok: false, error: `Could not ${doing} — points must be a whole number.` };
  if (order === "bad") return { ok: false, error: `Could not ${doing} — the order must be a whole number.` };
  const values = {
    goal_id: goalId,
    name,
    key: text(fd, "key") || String(order ?? Date.now()),
    chapter: text(fd, "chapter") || null,
    points: points ?? 0,
    sort_order: order ?? 0,
    treasure: text(fd, "treasure") || null,
    requires_teacher_signoff: fd.get("requires_teacher_signoff") === "on",
  };
  const { error } = isUuid(id) ? await db.from("gyan_levels").update(values).eq("id", id) : await db.from("gyan_levels").insert(values);
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/gyan-path");
  return { ok: true, message: isUuid(id) ? `Level "${name}" saved.` : `Level "${name}" added.` };
}

const STEP_KINDS = ["read", "listen", "recite", "quiz", "video", "practice"];

export async function addStepAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("contentManage", "add the step");
  if (!auth.ok) return auth;
  const { db } = auth.session;
  const levelId = text(fd, "level_id");
  const kind = text(fd, "kind");
  const title = text(fd, "title");
  const contentId = text(fd, "content_item_id");
  const order = intOrNull(fd, "sort_order");
  const points = intOrNull(fd, "points");
  if (!isUuid(levelId)) return { ok: false, error: "Could not add the step — choose the level." };
  if (!STEP_KINDS.includes(kind)) return { ok: false, error: "Could not add the step — choose learn, listen, quiz, recite, video or practice." };
  if (!title) return { ok: false, error: "Could not add the step — give it a title." };
  if (order === "bad" || points === "bad") return { ok: false, error: "Could not add the step — order and points must be whole numbers." };
  const quiz = quizFromFields(text(fd, "quiz_question"), text(fd, "quiz_options"), text(fd, "quiz_answer"));
  if (!quiz.ok) return { ok: false, error: `Could not add the step — ${quiz.error}.` };
  if (kind === "quiz" && !quiz.quiz) return { ok: false, error: "Could not add the step — a quiz step needs its question and answers." };
  const { error } = await db.from("gyan_steps").insert({
    level_id: levelId,
    kind,
    title,
    content_item_id: isUuid(contentId) ? contentId : null,
    sort_order: order ?? 0,
    points: points ?? 0,
    quiz: kind === "quiz" ? quiz.quiz : null,
  });
  if (error) return failure("Could not add the step", error);
  revalidatePath("/content/gyan-path");
  return { ok: true, message: `Step "${title}" added.` };
}

export async function deleteStepAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("contentManage", "remove the step");
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: "Could not remove the step — the request was incomplete." };
  const { data, error } = await auth.session.db.from("gyan_steps").delete().eq("id", id).select("id");
  if (error) return failure("Could not remove the step", error);
  if (!data?.length) return { ok: false, error: "Could not remove the step — it no longer exists, or it belongs to a shared goal." };
  revalidatePath("/content/gyan-path");
  return { ok: true, message: "Step removed." };
}

// ---------------------------------------------------------------------------
// Guide & directory
// ---------------------------------------------------------------------------
export async function saveGuideSectionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const doing = isUuid(id) ? "save the guide section" : "add the guide section";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const slug = text(fd, "slug").toLowerCase();
  const title = text(fd, "title");
  const body = text(fd, "body_md");
  const order = intOrNull(fd, "sort_order");
  if (!title || !body) return { ok: false, error: `Could not ${doing} — the title and text are required.` };
  if (!/^[a-z0-9-]+$/.test(slug)) return { ok: false, error: `Could not ${doing} — the web address can only use lowercase letters, numbers and dashes.` };
  if (order === "bad") return { ok: false, error: `Could not ${doing} — the order must be a whole number.` };
  const values = { slug, title, body_md: body, sort_order: order ?? 0, public: fd.get("public") === "on", is_checklist: fd.get("is_checklist") === "on" };
  const { error } = isUuid(id)
    ? await db.from("guide_sections").update(values).eq("id", id)
    : await db.from("guide_sections").insert({ ...values, center_id: center.id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/guide");
  return { ok: true, message: isUuid(id) ? "Section saved." : "Section added." };
}

// ---------------------------------------------------------------------------
// Legal & waivers (legal_documents; writes need settings.manage)
// ---------------------------------------------------------------------------
const LEGAL_KINDS: readonly string[] = MEMBER_LEGAL_KINDS;

/**
 * Save a member document version as a draft: a new version, or (with `id`) an edit of a draft
 * that is not published yet. A published text is frozen in the database (0422), so a change
 * to it is always a new version and every acceptance keeps the words that were accepted.
 */
export async function newLegalVersionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = text(fd, "id");
  const auth = await authorizeAction("centerSettings", isUuid(id) ? "save the draft" : "save the new version");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const kind = text(fd, "kind");
  const title = text(fd, "title");
  const version = text(fd, "version");
  const body = text(fd, "body_md");
  const stepRaw = text(fd, "member_step");
  const step = isMemberStep(stepRaw) ? stepRaw : defaultMemberStep(kind);
  if (!LEGAL_KINDS.includes(kind)) return { ok: false, error: "Could not save the version — choose the document." };
  if (!title || !version || !body) return { ok: false, error: "Could not save the version — title, version and text are all required." };
  const values = { title, version, body_md: body, member_step: step, requires_yearly_resign: fd.get("requires_yearly_resign") === "on" };
  if (isUuid(id)) {
    const { data, error } = await db.from("legal_documents").update(values).eq("id", id).eq("center_id", center.id).is("published_at", null).select("id");
    if (error) return failure("Could not save the draft", error);
    if (!data?.length) return { ok: false, error: "Could not save the draft — it was published in the meantime (start a new version), or you can't change it." };
    revalidatePath("/content/legal");
    return { ok: true, message: `Draft ${title} ${version} saved. Review it, then publish.` };
  }
  const { error } = await db.from("legal_documents").insert({ center_id: center.id, kind, ...values, published_at: null });
  if (error) return failure("Could not save the new version", error);
  revalidatePath("/content/legal");
  return { ok: true, message: `${title} ${version} saved as a draft. Review it, then publish.` };
}

export async function publishLegalAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "publish the document");
  if (!auth.ok) return auth;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: "Could not publish the document — the request was incomplete." };
  const { data, error } = await auth.session.db
    .from("legal_documents")
    .update({ published_at: new Date().toISOString() })
    .eq("id", id)
    .is("published_at", null)
    .select("title, version, member_step");
  if (error) return failure("Could not publish the document", error);
  if (!data?.length) return { ok: false, error: "Could not publish the document — it is already published, or you can't change it." };
  revalidatePath("/content/legal");
  const step = isMemberStep(data[0].member_step) ? data[0].member_step : "none";
  return { ok: true, message: `${data[0].title} ${data[0].version} published. ${publishEffect(step)}` };
}
