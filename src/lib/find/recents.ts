// The ten families a person opened last, remembered in THIS browser (a cookie, so the server can draw the cards on the People home
// without a flash). There is no per-person preference store in the database yet, and the owner asked for no migration for this, so
// the list is not shared between a person's devices; that is said on the People home. The cookie is named for the signed-in
// person and the community, so two people sharing a browser do not see each other's families. It holds family ids only; the
// cards are always read again under the viewer's own access, so a changed cookie can show nothing the person cannot already open.

export const RECENT_LIMIT = 10;
export const RECENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key8(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "x";
}

/** The cookie's name for one signed-in person in one community. */
export function recentCookieName(userId: string, centerId: string): string {
  return `weaver_rf_${key8(userId)}_${key8(centerId)}`;
}

/** The ids in a cookie value: only well-formed ids, no repeats, at most ten. */
export function parseRecents(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= RECENT_LIMIT) break;
  }
  return out;
}

export function serializeRecents(ids: readonly string[]): string {
  return ids.join(",");
}

/** This family moves to the front; the oldest drops off past ten. */
export function pushRecent(list: readonly string[], id: string, limit = RECENT_LIMIT): string[] {
  const next = id.toLowerCase();
  if (!UUID.test(next)) return [...list].slice(0, limit);
  return [next, ...list.filter((x) => x.toLowerCase() !== next)].slice(0, limit);
}

/** The family a page address shows ("/households/<id>"), or null. A sub-page of a family is not counted. */
export function familyIdFromPath(pathname: string): string | null {
  const m = /^\/households\/([0-9a-f-]{36})\/?$/i.exec(pathname);
  return m && UUID.test(m[1]) ? m[1].toLowerCase() : null;
}
