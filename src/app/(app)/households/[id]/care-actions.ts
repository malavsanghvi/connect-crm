"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { readTouches } from "@/lib/data/care";
import { failure } from "@/lib/errors";
import {
  NO_ACCESS,
  PROFILE_CHANNELS,
  RECOGNITION,
  THANKS,
  TOUCH_CHANNELS,
  TOUCH_KINDS,
  TOUCH_OUTCOMES,
  isNoAccess,
  offSentence,
  type CareTouchPage,
} from "@/lib/care/model";
import { careCan } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere, type CrmSession } from "@/lib/session";

// The Care card's writes (DonorDelight slice 2, connect-crm 0760-0762). Thin Server Actions: each checks the SHAPE of what came from
// the browser, then calls the database function AS THE SIGNED-IN PERSON, so app.care_household_can / app.care_can (no
// platform-admin branch) is the real gate; the careCan check here is a convenience. Every one answers { ok, error } in plain
// words next to what the person did, logs the technical detail on the server (failure()), and never says it worked when it
// did not. A refusal because of permissions reads "You don't have access to this area".
//
// Deliberately not recorded in the activity stream (withActivity): DonorDelight's actions stay inside the organization (W2).

export type CareSave = { ok: true; message: string } | { ok: false; error: string };
export type CareTouchesLoad = { ok: true; page: CareTouchPage } | { ok: false; error: string };

type Authorized = { ok: true; session: CrmSession };
type Refused = { ok: false; error: string };

const notUnderstood = (doing: string): Refused => ({ ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` });

async function authorize(doing: string): Promise<Authorized | Refused> {
  const auth = await authorizeActionWhere((s) => careCan(s, "own"), doing, "care.own, care.view or care.manage");
  if (!auth.ok) return /don't have permission/.test(auth.error) ? { ok: false, error: `${NO_ACCESS}. Nothing was changed.` } : auth;
  return auth;
}

function dbFailure(doing: string, error: unknown): Refused {
  const off = offSentence(error);
  if (off) {
    console.error(`[care] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${off} Nothing was changed.` };
  }
  if (isNoAccess(error)) {
    const msg = (error as { message?: string | null }).message ?? "";
    // The database's own sentence when it is more precise ("Only someone who manages ... can choose ...").
    const precise = msg && !/You don't have access to this area/i.test(msg) ? msg : `${NO_ACCESS}.`;
    console.error(`[care] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${precise.replace(/\.?$/, ".")} Nothing was changed.` };
  }
  return failure(`Could not ${doing}`, error);
}

function done(householdId: string, message: string): CareSave {
  revalidatePath(`/households/${householdId}`);
  revalidatePath("/care");
  return { ok: true, message };
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ── The care profile ─────────────────────────────────────────────────────────
export type ProfileCall = {
  householdId: string;
  /** Only the fields being changed; null clears one. */
  fields: {
    thanks?: string | null;
    recognition?: string | null;
    channel?: string | null;
    language?: string | null;
    contact_person_id?: string | null;
    do_not_ask?: boolean;
    rest_until?: string | null;
  };
};

export async function saveCareProfileAction(call: ProfileCall): Promise<CareSave> {
  const doing = "save the care profile";
  if (!call || !isUuid(call.householdId) || !call.fields || typeof call.fields !== "object") return notUnderstood(doing);
  const f = call.fields;
  const patch: Record<string, Json> = {};
  for (const [key, value] of Object.entries(f)) {
    if (key === "thanks" && (value === null || isOneOf(THANKS, value))) patch.thanks = value;
    else if (key === "recognition" && (value === null || isOneOf(RECOGNITION, value))) patch.recognition = value;
    else if (key === "channel" && (value === null || isOneOf(PROFILE_CHANNELS, value))) patch.channel = value;
    else if (key === "language" && (value === null || (typeof value === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$/.test(value)))) patch.language = value;
    else if (key === "contact_person_id" && (value === null || (typeof value === "string" && isUuid(value)))) patch.contact_person_id = value;
    else if (key === "do_not_ask" && typeof value === "boolean") patch.do_not_ask = value;
    else if (key === "rest_until" && (value === null || isDay(value))) patch.rest_until = value;
    else return notUnderstood(doing);
  }
  if (Object.keys(patch).length === 0) return notUnderstood(doing);
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_profile", { p_household: call.householdId, p_profile: patch });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Care profile saved.");
}

// ── Touches ──────────────────────────────────────────────────────────────────
export type TouchCall = {
  householdId: string;
  kind: string;
  channel: string;
  outcome?: string;
  isAsk?: boolean;
  note?: string | null;
  personId?: string | null;
  /** When it happened (ISO); left out: now. */
  touchedAt?: string | null;
};

export async function logCareTouchAction(call: TouchCall): Promise<CareSave> {
  const doing = "record the touch";
  if (!call || !isUuid(call.householdId) || !isOneOf(TOUCH_KINDS, call.kind) || !isOneOf(TOUCH_CHANNELS, call.channel)) return notUnderstood(doing);
  if (call.outcome !== undefined && !isOneOf(TOUCH_OUTCOMES, call.outcome)) return notUnderstood(doing);
  if (call.isAsk !== undefined && typeof call.isAsk !== "boolean") return notUnderstood(doing);
  if (call.note != null && (typeof call.note !== "string" || call.note.length > 1000)) {
    return { ok: false, error: "Could not record the touch — a note is at most 1,000 characters. Nothing was changed." };
  }
  if (call.personId != null && !isUuid(call.personId)) return notUnderstood(doing);
  if (call.touchedAt != null && (typeof call.touchedAt !== "string" || Number.isNaN(Date.parse(call.touchedAt)))) return notUnderstood(doing);
  if (call.kind === "care_moment" && call.isAsk) {
    return { ok: false, error: "Could not record the touch — a care moment is never an ask. Nothing was changed." };
  }
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const touch: Record<string, Json> = { kind: call.kind, channel: call.channel, outcome: call.outcome ?? "done", is_ask: call.isAsk ?? false };
  const note = typeof call.note === "string" ? call.note.trim() : "";
  if (note) touch.note = note;
  if (call.personId) touch.person_id = call.personId;
  if (call.touchedAt) touch.touched_at = new Date(call.touchedAt).toISOString();
  const res = await auth.session.db.rpc("log_care_touch", { p_household: call.householdId, p_touch: touch });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Touch recorded.");
}

export async function voidCareTouchAction(call: { householdId: string; touchId: string; reason?: string | null }): Promise<CareSave> {
  const doing = "remove the touch from the log";
  if (!call || !isUuid(call.householdId) || !isUuid(call.touchId)) return notUnderstood(doing);
  if (call.reason != null && (typeof call.reason !== "string" || call.reason.length > 500)) return notUnderstood(doing);
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("void_care_touch", { p_touch: call.touchId, p_reason: call.reason?.trim() || undefined });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Removed from the log.");
}

/** The next page of the touch log (older touches). */
export async function moreCareTouchesAction(call: { householdId: string; beforeAt: string; beforeKey: string }): Promise<CareTouchesLoad> {
  const doing = "load more touches";
  if (!call || !isUuid(call.householdId) || typeof call.beforeAt !== "string" || Number.isNaN(Date.parse(call.beforeAt))) return notUnderstood(doing);
  if (typeof call.beforeKey !== "string" || !/^[a-z_]{1,20}:[0-9a-f-]{36}$/.test(call.beforeKey)) return notUnderstood(doing);
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const read = await readTouches(auth.session, call.householdId, { at: call.beforeAt, key: call.beforeKey });
  if (read.status === "ok") return { ok: true, page: read.data };
  if (read.status === "no_access") return { ok: false, error: `Could not ${doing} — ${NO_ACCESS}.` };
  if (read.status === "off") return { ok: false, error: `Could not ${doing} — ${read.message}` };
  return { ok: false, error: `Could not ${doing} — ${read.error.replace(/\.?$/, ".")}` };
}

// ── Notes ────────────────────────────────────────────────────────────────────
export async function addCareNoteAction(call: { householdId: string; body: string; personId?: string | null }): Promise<CareSave> {
  const doing = "save the note";
  if (!call || !isUuid(call.householdId) || typeof call.body !== "string") return notUnderstood(doing);
  const body = call.body.trim();
  if (!body) return { ok: false, error: "Could not save the note — write the note first." };
  if (body.length > 2000) return { ok: false, error: "Could not save the note — a note is at most 2,000 characters." };
  if (call.personId != null && !isUuid(call.personId)) return notUnderstood(doing);
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("add_care_note", { p_household: call.householdId, p_body: body, p_person: call.personId ?? undefined });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Note saved.");
}

export async function editCareNoteAction(call: { householdId: string; noteId: string; body: string }): Promise<CareSave> {
  const doing = "change the note";
  if (!call || !isUuid(call.householdId) || !isUuid(call.noteId) || typeof call.body !== "string") return notUnderstood(doing);
  const body = call.body.trim();
  if (!body) return { ok: false, error: "Could not change the note — a note cannot be empty. Archive it instead." };
  if (body.length > 2000) return { ok: false, error: "Could not change the note — a note is at most 2,000 characters." };
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("edit_care_note", { p_note: call.noteId, p_body: body });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Note changed.");
}

export async function archiveCareNoteAction(call: { householdId: string; noteId: string }): Promise<CareSave> {
  const doing = "archive the note";
  if (!call || !isUuid(call.householdId) || !isUuid(call.noteId)) return notUnderstood(doing);
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("archive_care_note", { p_note: call.noteId });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, "Note archived.");
}

// ── Owners ───────────────────────────────────────────────────────────────────
export async function setCareOwnerAction(call: { householdId: string; ownerId: string | null; backupId: string | null; reason?: string | null }): Promise<CareSave> {
  const doing = "choose the relationship owner";
  if (!call || !isUuid(call.householdId)) return notUnderstood(doing);
  if (call.ownerId !== null && !isUuid(call.ownerId)) return notUnderstood(doing);
  if (call.backupId !== null && !isUuid(call.backupId)) return notUnderstood(doing);
  if (call.reason != null && (typeof call.reason !== "string" || call.reason.length > 500)) return notUnderstood(doing);
  if (call.ownerId === null && call.backupId !== null) {
    return { ok: false, error: "Could not choose the relationship owner — choose the owner first, then a backup. Nothing was changed." };
  }
  if (call.ownerId !== null && call.ownerId === call.backupId) {
    return { ok: false, error: "Could not choose the relationship owner — the backup has to be a different person. Nothing was changed." };
  }
  const auth = await authorizeActionWhere((s) => careCan(s, "manage"), doing, "care.manage");
  if (!auth.ok) return /don't have permission/.test(auth.error) ? { ok: false, error: `${NO_ACCESS}. Only someone who manages care chooses owners.` } : auth;
  const res = await auth.session.db.rpc("set_care_owner", {
    p_household: call.householdId,
    p_owner: call.ownerId ?? undefined,
    p_backup: call.backupId ?? undefined,
    p_reason: call.reason?.trim() || undefined,
  });
  if (res.error) return dbFailure(doing, res.error);
  return done(call.householdId, call.ownerId ? "Relationship owner saved." : "Owners cleared. The household needs an owner.");
}
