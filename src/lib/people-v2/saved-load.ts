import "server-only";

// A person's own saved views and pinned families, the reads. The table (app.people_saved, 0722) lets a person read only their own rows,
// so these queries name the person and the community only to be explicit; the database is what enforces it. A pin is read again under
// the viewer's own access every time it is drawn (the household card): a family the person can no longer see, or that was merged into
// another, is skipped and counted, never shown.

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { householdCardLine } from "@/lib/find/labels";
import { familyHref } from "@/lib/find/rows";
import type { CrmSession } from "@/lib/session";

import { inOrder, isSavedList, type PinRow, type SavedViewRow } from "./saved-views";

export type ViewsLoad = { views: SavedViewRow[]; error: string | null };

function paramsOf(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

/** The signed-in person's saved views in this community, in the order they keep them. `error` in words when they could not be read. */
export async function loadSavedViews(session: CrmSession): Promise<ViewsLoad> {
  const { db, center, userId } = session;
  const res = await db.from("people_saved").select("id, name, list_view, params, sort, position, created_at").eq("center_id", center.id).eq("user_id", userId).eq("kind", "view").limit(100);
  if (res.error) {
    console.error("[people saved views] could not read the saved views:", res.error);
    return { views: [], error: explainError(res.error) };
  }
  const views: SavedViewRow[] = (res.data ?? []).flatMap((r) =>
    r.name && isSavedList(r.list_view) ? [{ id: r.id, name: r.name, list: r.list_view, params: paramsOf(r.params), sort: r.sort, position: r.position, createdAt: r.created_at }] : [],
  );
  return { views: inOrder(views), error: null };
}

export type PinsLoad = { pins: PinRow[]; error: string | null };

/** The signed-in person's pins, in order. */
export async function loadPinRows(session: CrmSession): Promise<PinsLoad> {
  const { db, center, userId } = session;
  const res = await db.from("people_saved").select("id, household_id, position, created_at").eq("center_id", center.id).eq("user_id", userId).eq("kind", "pin").limit(100);
  if (res.error) {
    console.error("[people saved views] could not read the pinned families:", res.error);
    return { pins: [], error: explainError(res.error) };
  }
  const pins: PinRow[] = (res.data ?? []).flatMap((r) => (r.household_id ? [{ id: r.id, householdId: r.household_id, position: r.position, createdAt: r.created_at }] : []));
  return { pins: inOrder(pins), error: null };
}

export type PinnedFamily = { id: string; householdId: string; title: string; cardLine: string; href: string };

/** The pinned families as cards, read again under THIS person's access. `hidden` counts the pins that are no longer available to them. */
export async function loadPinnedFamilies(session: CrmSession): Promise<{ pinned: PinnedFamily[]; hidden: number; error: string | null }> {
  const rows = await loadPinRows(session);
  if (rows.error) return { pinned: [], hidden: 0, error: rows.error };
  if (rows.pins.length === 0) return { pinned: [], hidden: 0, error: null };
  const { db, center } = session;
  try {
    const live = await db
      .from("households")
      .select("id")
      .in("id", rows.pins.map((p) => p.householdId))
      .eq("center_id", center.id)
      .is("merged_into_id", null);
    if (live.error) throw live.error;
    const keep = new Set((live.data ?? []).map((h) => h.id));
    const ordered = rows.pins.filter((p) => keep.has(p.householdId));
    const { cards } = ordered.length
      ? await adultHouseholdCards(db, ordered.map((p) => p.householdId), { today: todayInTz(center.time_zone), currency: center.currency, majority: communityMajority(center) })
      : { cards: [] };
    const byHousehold = new Map(cards.map((c) => [c.household_id, c]));
    const pinned: PinnedFamily[] = ordered.flatMap((p) => {
      const c = byHousehold.get(p.householdId);
      return c ? [{ id: p.id, householdId: p.householdId, title: c.household_name?.trim() || "Family", cardLine: householdCardLine(c), href: familyHref(p.householdId) }] : [];
    });
    return { pinned, hidden: rows.pins.length - pinned.length, error: null };
  } catch (error) {
    console.error("[people saved views] could not read the pinned families' cards:", error);
    return { pinned: [], hidden: 0, error: explainError(error) };
  }
}

/** Is this family pinned by the signed-in person? `pinned` is null when it could not be read (said in `error`). */
export async function loadPinState(session: CrmSession, householdId: string): Promise<{ pinned: boolean | null; error: string | null }> {
  const { db, center, userId } = session;
  const res = await db.from("people_saved").select("id").eq("center_id", center.id).eq("user_id", userId).eq("kind", "pin").eq("household_id", householdId).limit(1);
  if (res.error) {
    console.error("[people saved views] could not read whether the family is pinned:", res.error);
    return { pinned: null, error: explainError(res.error) };
  }
  return { pinned: (res.data ?? []).length > 0, error: null };
}
