// The Supabase Storage API as the background service calls it (storage.retention, storage.scan), with the worker's own
// key (SUPABASE_SECRET_KEY on this service; WORKER_SUPABASE_SECRET_KEY in GitHub, docs/DEPLOY.md).
//
// How the key travels: a new-style secret key (sb_secret_…) is NOT a JWT, and Supabase says to send it in the apikey
// header only, never as Authorization: Bearer (anything that tries to verify it as a JWT fails). A legacy service_role
// key (a JWT) is sent in both headers, as before.

/** The headers that carry the worker's key. */
export function storageAuthHeaders(key: string): Record<string, string> {
  const k = key.trim();
  return k.startsWith("sb_") ? { apikey: k } : { apikey: k, authorization: `Bearer ${k}` };
}

/** <SUPABASE_URL>/storage/v1/object/<bucket>: where removals go (DELETE with {prefixes}). */
export function bucketUrl(base: string, bucket: string): string {
  return `${base.replace(/\/+$/, "")}/storage/v1/object/${encodeURIComponent(bucket)}`;
}

/** A "." or ".." segment: a URL parser resolves those (encoded or not), so such a name could point outside its bucket. */
export function hasDotSegment(name: string): boolean {
  return name.split("/").some((seg) => seg === "." || seg === "..");
}

/** <SUPABASE_URL>/storage/v1/object/<bucket>/<name>: one object, each path segment encoded; a name with a "." or ".." segment is refused. */
export function objectUrl(base: string, bucket: string, name: string): string {
  if (hasDotSegment(name)) throw new Error("An object name with a . or .. segment cannot be fetched safely.");
  return `${bucketUrl(base, bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`;
}
