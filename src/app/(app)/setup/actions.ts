"use server";

import { revalidatePath } from "next/cache";

import { TIME_ZONES } from "@/lib/center-wizard";
import type { Json } from "@/lib/database.types";
import { readPublicEnv } from "@/lib/env";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid, safeFilterText } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";
import {
  BRAND_FILES,
  checkUpload,
  DOCUMENT_KINDS,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
  extensionFor,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  isBrandFileKey,
  isStepStatus,
  MONTHS,
  osmLinkUrl,
  parseBrandColors,
  parseLeader,
  parseLegalIdentity,
  parseProfile,
  publicObjectUrl,
  safeFileName,
} from "@/lib/setup";

const text = (fd: FormData) => (n: string) => {
  const v = fd.get(n);
  return typeof v === "string" ? v : null;
};
const texts = (fd: FormData) => (n: string) => fd.getAll(n).filter((v): v is string => typeof v === "string");
const file = (fd: FormData, n: string): File | null => {
  const v = fd.get(n);
  return v && typeof v === "object" && "arrayBuffer" in v ? (v as File) : null;
};

function refresh() {
  revalidatePath("/setup", "layout");
}

// ── Checklist ─────────────────────────────────────────────────────────────────

/** Save one checklist step: status, owner, due date, notes (app.center_setup_steps; audited). */
export async function saveSetupStepAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const read = text(fd);
  const key = (read("step_key") ?? "").trim();
  const auth = await authorizeAction("setup", "save this step");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(key)) return { ok: false, error: "Could not save the step — it is not one this app knows. Reload and try again." };
  const manual = read("manual") !== "false";
  const status = (read("status") ?? "not_started").trim();
  if (!isStepStatus(status) || status === "needs_review") return { ok: false, error: "Could not save the step — choose a status from the list." };
  const owner = (read("owner_person_id") ?? "").trim();
  if (owner && !isUuid(owner)) return { ok: false, error: "Could not save the step — choose the owner again from the list." };
  const due = (read("due_on") ?? "").trim();
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return { ok: false, error: "Could not save the step — the due date is not a date." };
  const notes = (read("notes") ?? "").trim();
  if (notes.length > 2000) return { ok: false, error: "Could not save the step — keep the notes under 2,000 characters." };
  const { error } = await db.from("center_setup_steps").upsert(
    {
      center_id: center.id,
      step_key: key,
      // Steps worked out automatically keep "not started" as their stored status; the checklist shows the computed one.
      status: manual ? status : "not_started",
      owner_person_id: owner || null,
      due_on: due || null,
      notes: notes || null,
    },
    { onConflict: "center_id,step_key" },
  );
  if (error) return failure("Could not save the step", error);
  refresh();
  return { ok: true, message: "Step saved · audit logged" };
}

// ── Step 0.2 · legal identity and documents ─────────────────────────────────────

export async function saveLegalIdentityAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "save the legal identity");
  if (!auth.ok) return auth;
  const parsed = parseLegalIdentity(text(fd));
  if (!parsed.ok) return { ok: false, error: `Could not save the legal identity — ${parsed.error}` };
  const { db, center } = auth.session;
  const before = await db.from("org_profiles").select("verification_status").eq("center_id", center.id).maybeSingle();
  if (before.error) return failure("Could not save the legal identity", before.error);
  const { data, error } = await db
    .from("org_profiles")
    .upsert({ center_id: center.id, ...parsed.value, registered_address: parsed.value.registered_address as Json }, { onConflict: "center_id" })
    .select("verification_status")
    .single();
  if (error) return failure("Could not save the legal identity", error);
  refresh();
  const was = before.data?.verification_status;
  if ((was === "verified" || was === "submitted") && data.verification_status === "unverified") {
    return { ok: true, message: "Legal identity saved. It changed after it was reviewed, so submit it for verification again." };
  }
  return { ok: true, message: "Legal identity saved · audit logged" };
}

export async function uploadOrgDocumentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "upload the document");
  if (!auth.ok) return auth;
  const read = text(fd);
  const kind = (read("kind") ?? "").trim();
  const kindDef = DOCUMENT_KINDS.find((k) => k.value === kind);
  if (!kindDef) return { ok: false, error: "Could not upload — choose what the document is." };
  const f = file(fd, "file");
  const check = checkUpload(f, DOCUMENT_TYPES, DOCUMENT_MAX_BYTES, "document");
  if (!check.ok) return { ok: false, error: `Could not upload the ${kindDef.label.toLowerCase()} — ${check.error}` };
  const note = (read("note") ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "Could not upload — keep the note under 1,000 characters." };
  const { db, center, userId } = auth.session;
  const path = `${center.id}/${kind}/${Date.now()}-${safeFileName(f!.name)}`;
  const up = await db.storage.from("org-documents").upload(path, f!, { contentType: f!.type, upsert: false });
  if (up.error) {
    console.error(`[setup] upload to org-documents/${path} failed:`, up.error);
    const missing = /bucket not found/i.test(up.error.message);
    return {
      ok: false,
      error: missing
        ? "Could not upload — the private document storage is not set up on this server yet. Ask Community Connect to create the org-documents storage area."
        : failure(`Could not upload the ${kindDef.label.toLowerCase()}`, up.error).error,
    };
  }
  const { error } = await db.from("org_documents").insert({
    center_id: center.id,
    kind,
    storage_path: path,
    file_name: f!.name.slice(0, 255),
    content_type: f!.type,
    size_bytes: f!.size,
    uploaded_by: userId,
    note: note || null,
  });
  if (error) {
    console.error(`[setup] the file org-documents/${path} was stored but its record failed; it is not listed anywhere:`, error);
    return failure(`Could not record the ${kindDef.label.toLowerCase()} (the file was stored but is not listed; upload it again)`, error);
  }
  refresh();
  return { ok: true, message: `${kindDef.label} uploaded · audit logged` };
}

export async function submitVerificationAction(): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "submit for verification");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const { error } = await db.rpc("submit_org_verification", { p_center: center.id });
  if (error) return failure("Could not submit for verification", error);
  refresh();
  return { ok: true, message: "Submitted. Community Connect will review the documents and the IRS record." };
}

// ── Step 0.3 · profile and brand kit ───────────────────────────────────────────

export async function saveProfileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "save the profile");
  if (!auth.ok) return auth;
  const parsed = parseProfile(text(fd), texts(fd), TIME_ZONES);
  if (!parsed.ok) return { ok: false, error: `Could not save the profile — ${parsed.error}` };
  const fyRaw = Number(text(fd)("fiscal_year_start_month") ?? "");
  if (!Number.isInteger(fyRaw) || fyRaw < 1 || fyRaw > 12) return { ok: false, error: "Could not save the profile — choose the month the fiscal year starts." };
  const p = parsed.value;
  const { db, center } = auth.session;

  const c = await db
    .from("centers")
    .update({ name: p.name, short_name: p.short_name, time_zone: p.time_zone, currency: p.currency })
    .eq("id", center.id)
    .select("id");
  if (c.error) return failure("Could not save the display name, time zone and currency", c.error);
  if (!c.data || c.data.length === 0) return { ok: false, error: "Could not save the display name — you don't have permission to change this community (needs settings.manage)." };

  const prof = await db.from("org_profiles").upsert(
    {
      center_id: center.id,
      mission: p.mission,
      about: p.about,
      website: p.website,
      social: p.social,
      public_email: p.public_email,
      public_phone: p.public_phone,
      office_hours: p.office_hours,
      latitude: p.latitude,
      longitude: p.longitude,
      languages: p.languages,
      fiscal_year_start_month: fyRaw,
    },
    { onConflict: "center_id" },
  );
  if (prof.error) return failure("Could not save the profile (the name, time zone and currency were saved)", prof.error);

  // The member app already reads these contact keys from centers.branding (Guide › Contact).
  const mirror = await db.rpc("set_center_branding", {
    p_center: center.id,
    p_patch: {
      website: p.website,
      phone: p.public_phone,
      address: p.address,
      map_url: p.latitude !== null && p.longitude !== null ? osmLinkUrl(p.latitude, p.longitude) : null,
    },
  });
  if (mirror.error) return failure("Could not copy the contact details to the member app (the profile itself was saved)", mirror.error);
  revalidatePath("/", "layout");
  return { ok: true, message: `Profile saved · fiscal year starts in ${MONTHS[fyRaw - 1]} · audit logged` };
}

export async function saveBrandColorsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "save the brand colors");
  if (!auth.ok) return auth;
  const parsed = parseBrandColors(text(fd));
  if (!parsed.ok) return { ok: false, error: `Could not save the brand colors — ${parsed.error}` };
  const { db, center } = auth.session;
  const { error } = await db.rpc("set_center_branding", { p_center: center.id, p_patch: { colors: parsed.value } });
  if (error) return failure("Could not save the brand colors", error);
  revalidatePath("/", "layout");
  return { ok: true, message: "Brand colors saved · audit logged" };
}

export async function uploadBrandFileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "upload the brand file");
  if (!auth.ok) return auth;
  const key = text(fd)("key");
  if (!isBrandFileKey(key)) return { ok: false, error: "Could not upload — choose which brand file this is." };
  const def = BRAND_FILES.find((b) => b.key === key)!;
  const f = file(fd, "file");
  const check = checkUpload(f, IMAGE_TYPES, IMAGE_MAX_BYTES, def.label.toLowerCase());
  if (!check.ok) return { ok: false, error: `Could not upload — ${check.error}` };
  const env = readPublicEnv();
  if (!env.ok) return { ok: false, error: "Could not upload — the app is not configured (NEXT_PUBLIC_SUPABASE_URL)." };
  const { db, center } = auth.session;
  const path = `${center.id}/brand/${key.replace("_path", "")}-${Date.now()}.${extensionFor(f!.type)}`;
  const up = await db.storage.from("branding").upload(path, f!, { contentType: f!.type, upsert: false });
  if (up.error) {
    console.error(`[setup] upload to branding/${path} failed:`, up.error);
    if (/bucket not found/i.test(up.error.message)) {
      return { ok: false, error: "Could not upload — the branding storage is not set up on this server yet. Ask Community Connect to create the branding storage area." };
    }
    return failure(`Could not upload the ${def.label.toLowerCase()}`, up.error);
  }
  const { error } = await db.rpc("set_center_branding", {
    p_center: center.id,
    p_patch: { [key]: path, [def.urlKey]: publicObjectUrl(env.env.supabaseUrl, "branding", path) },
  });
  if (error) return failure(`Could not use the uploaded ${def.label.toLowerCase()}`, error);
  revalidatePath("/", "layout");
  return { ok: true, message: `${def.label} uploaded · audit logged` };
}

export async function removeBrandFileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "remove the brand file");
  if (!auth.ok) return auth;
  const key = text(fd)("key");
  if (!isBrandFileKey(key)) return { ok: false, error: "Could not remove — choose which brand file this is." };
  const def = BRAND_FILES.find((b) => b.key === key)!;
  const { db, center } = auth.session;
  // The file stays in storage (nothing is deleted); the brand kit just stops using it.
  const { error } = await db.rpc("set_center_branding", { p_center: center.id, p_patch: { [key]: null, [def.urlKey]: null } });
  if (error) return failure(`Could not stop using the ${def.label.toLowerCase()}`, error);
  revalidatePath("/", "layout");
  return { ok: true, message: `${def.label} removed from the brand kit` };
}

// ── Leaders ──────────────────────────────────────────────────────────────────

export async function saveLeaderAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "save the leader");
  if (!auth.ok) return auth;
  const parsed = parseLeader(text(fd));
  if (!parsed.ok) return { ok: false, error: `Could not save the leader — ${parsed.error}` };
  const id = (text(fd)("id") ?? "").trim();
  if (id && !isUuid(id)) return { ok: false, error: "Could not save the leader — reload and try again." };
  const { db, center } = auth.session;
  if (id) {
    const { data, error } = await db.from("org_leaders").update(parsed.value).eq("id", id).eq("center_id", center.id).select("id");
    if (error) return failure("Could not save the leader", error);
    if (!data || data.length === 0) return { ok: false, error: "Could not save the leader — it was not found, or you can't change it." };
  } else {
    const { error } = await db.from("org_leaders").insert({ ...parsed.value, center_id: center.id });
    if (error) return failure("Could not add the leader", error);
  }
  refresh();
  return { ok: true, message: `${parsed.value.full_name} saved${parsed.value.show_publicly ? " · shown in the member app's Administration list" : " · not shown publicly"}` };
}

export async function uploadLeaderPhotoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("setup", "upload the photo");
  if (!auth.ok) return auth;
  const id = (text(fd)("id") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "Could not upload the photo — save the leader first." };
  const f = file(fd, "file");
  const check = checkUpload(f, IMAGE_TYPES.filter((t) => t !== "image/svg+xml"), IMAGE_MAX_BYTES, "photo");
  if (!check.ok) return { ok: false, error: `Could not upload the photo — ${check.error}` };
  const { db, center } = auth.session;
  const path = `${center.id}/leaders/${id}-${Date.now()}.${extensionFor(f!.type)}`;
  const up = await db.storage.from("branding").upload(path, f!, { contentType: f!.type, upsert: false });
  if (up.error) {
    console.error(`[setup] upload to branding/${path} failed:`, up.error);
    if (/bucket not found/i.test(up.error.message)) {
      return { ok: false, error: "Could not upload the photo — the branding storage is not set up on this server yet." };
    }
    return failure("Could not upload the photo", up.error);
  }
  const { data, error } = await db.from("org_leaders").update({ photo_path: path }).eq("id", id).eq("center_id", center.id).select("id");
  if (error) return failure("Could not use the uploaded photo", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not use the photo — the leader was not found." };
  refresh();
  return { ok: true, message: "Photo uploaded" };
}

export type LeaderPersonOption = { id: string; name: string; detail: string | null };

/** People of this community for linking a leader to their record. */
export async function searchLeaderPeopleAction(query: string): Promise<ActionResult<LeaderPersonOption[]>> {
  const auth = await authorizeAction("setup", "search people");
  if (!auth.ok) return auth;
  const q = safeFilterText(String(query ?? "").trim());
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters of a name, email or member number." };
  const { db, center } = auth.session;
  const tokens = q.split(" ").filter(Boolean);
  let req = db.from("people").select("id, first_name, last_name, preferred_name, member_number, email").eq("center_id", center.id).is("merged_into_id", null).limit(15);
  req =
    tokens.length >= 2
      ? req.ilike("first_name", `${tokens[0]}%`).ilike("last_name", `${tokens[tokens.length - 1]}%`)
      : req.or(`first_name.ilike.%${tokens[0]}%,last_name.ilike.%${tokens[0]}%,email.ilike.%${tokens[0]}%,member_number.ilike.%${tokens[0]}%`);
  const { data, error } = await req;
  if (error) return failure("Could not search people", error);
  return {
    ok: true,
    data: (data ?? []).map((p) => ({
      id: p.id,
      name: `${p.preferred_name || p.first_name} ${p.last_name}`,
      detail: [p.member_number, p.email].filter(Boolean).join(" · ") || null,
    })),
  };
}
