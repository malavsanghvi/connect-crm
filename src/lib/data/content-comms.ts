import "server-only";

import { photoLocation } from "@/lib/content";
import { chunk } from "@/lib/data/fetch-all";
import { personName } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

function uniq(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

/**
 * Names for person ids: `people` where RLS allows, then the opt-in member
 * directory for the rest. Missing names stay absent; callers show a neutral
 * label ("Member") rather than an id.
 */
export async function personNames(db: AppSupabase, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = uniq(ids);
  for (const part of chunk(wanted)) {
    const { data, error } = await db.from("people").select("id, first_name, last_name, preferred_name").in("id", part);
    if (error) {
      console.error("[content-comms] people name lookup failed; trying the directory:", error);
      break;
    }
    for (const p of data ?? []) out.set(p.id, personName(p));
  }
  const rest = wanted.filter((id) => !out.has(id));
  for (const part of chunk(rest)) {
    const { data, error } = await db.from("directory").select("person_id, name").in("person_id", part);
    if (error) {
      console.error("[content-comms] directory name lookup failed; some names stay hidden:", error);
      break;
    }
    for (const d of data ?? []) if (d.person_id && d.name) out.set(d.person_id, d.name);
  }
  return out;
}

export type AudienceOption = { id: string; name: string };
export type AudienceOptions = {
  zones: AudienceOption[];
  classes: AudienceOption[];
  events: AudienceOption[];
  /** Lists the user's roles could not read, named for a plain-English note. */
  unavailable: string[];
};

/**
 * Pickers for the audience chips. Zones are public; classes and events are
 * optional (a comms officer without Pathshala or Events access still composes),
 * so a failure there is logged and named, not fatal.
 */
export async function audienceOptions(db: AppSupabase, centerId: string): Promise<{ data: AudienceOptions; error: DbErrorLike | null }> {
  const [zones, terms, events] = await Promise.all([
    db.from("zones").select("id, name").eq("center_id", centerId).order("name"),
    db.from("pathshala_terms").select("id, status").eq("center_id", centerId).in("status", ["registration", "active"]),
    db.from("events").select("id, name, starts_at").eq("center_id", centerId).order("starts_at", { ascending: false, nullsFirst: true }).limit(50),
  ]);
  const unavailable: string[] = [];
  let classes: AudienceOption[] = [];
  if (terms.error) {
    console.error("[content-comms] Pathshala terms unavailable for the audience picker:", terms.error);
    unavailable.push("Pathshala classes");
  } else {
    const termIds = (terms.data ?? []).map((t) => t.id);
    if (termIds.length > 0) {
      const cls = await db.from("pathshala_classes").select("id, name").eq("center_id", centerId).in("term_id", termIds).order("name");
      if (cls.error) {
        console.error("[content-comms] Pathshala classes unavailable for the audience picker:", cls.error);
        unavailable.push("Pathshala classes");
      } else classes = cls.data ?? [];
    }
  }
  if (events.error) {
    console.error("[content-comms] events unavailable for the audience picker:", events.error);
    unavailable.push("events");
  }
  return {
    data: { zones: zones.data ?? [], classes, events: (events.data ?? []).map((e) => ({ id: e.id, name: e.name })), unavailable },
    error: zones.error,
  };
}

export type SignedPhoto = { url: string | null; problem: string | null };

/**
 * Short-lived signed URLs for photo thumbnails (Supabase Storage, "photos"
 * bucket). A photo that cannot be signed carries the reason instead.
 */
export async function signedPhotoUrls(db: AppSupabase, photos: { id: string; storage_path: string }[], expiresIn = 600): Promise<Map<string, SignedPhoto>> {
  const out = new Map<string, SignedPhoto>();
  const byBucket = new Map<string, { id: string; key: string }[]>();
  for (const p of photos) {
    const loc = photoLocation(p.storage_path);
    if (!loc) out.set(p.id, { url: null, problem: "No file is attached to this photo." });
    else if (loc.kind === "url") out.set(p.id, { url: loc.url, problem: null });
    else byBucket.set(loc.bucket, [...(byBucket.get(loc.bucket) ?? []), { id: p.id, key: loc.key }]);
  }
  for (const [bucket, items] of byBucket) {
    const { data, error } = await db.storage.from(bucket).createSignedUrls(
      items.map((i) => i.key),
      expiresIn,
    );
    if (error) {
      console.error(`[content-comms] could not sign photo URLs in bucket "${bucket}":`, error);
      for (const i of items) out.set(i.id, { url: null, problem: `Preview unavailable — ${error.message || "storage refused the request"}.` });
      continue;
    }
    items.forEach((i, idx) => {
      const r = data?.[idx];
      if (r?.signedUrl) out.set(i.id, { url: r.signedUrl, problem: null });
      else {
        if (r?.error) console.error(`[content-comms] photo ${i.id} could not be signed:`, r.error);
        out.set(i.id, { url: null, problem: `Preview unavailable — ${r?.error ?? "the file was not found in storage"}.` });
      }
    });
  }
  return out;
}
