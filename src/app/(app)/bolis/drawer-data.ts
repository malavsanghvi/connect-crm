import "server-only";

import { leadingEntry, nextMinimum, otherInterestedHouseholds, rankEntries } from "@/lib/bolis";
import { householdsById } from "@/lib/data/lookups";
import { explainError } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import type { BoliFormBoli } from "./boli-form";

export type DrawerBoli = BoliFormBoli & {
  status: string;
  winner_entry_id: string | null;
  winner_pledge_id: string | null;
  extended_until: string | null;
  closed_reason: string | null;
};

export type DrawerEntry = {
  id: string;
  household_id: string;
  amount_cents: number;
  entered_at: string;
  is_in_person: boolean;
  name: string;
  household_number: string | null;
};

export type BoliDrawerData = {
  boli: DrawerBoli;
  eventName: string | null;
  /** Ranked (winner first). Null when the viewer's role can't see individual entries. */
  entries: DrawerEntry[] | null;
  entriesProblem: string | null;
  topCents: number | null;
  count: number;
  minimumCents: number;
  leadingEntryId: string | null;
  otherFamilies: number;
};

export type DrawerLoad = { ok: true; data: BoliDrawerData } | { ok: false; error: string } | { ok: true; data: null };

/** Everything the boli drawer shows, for the `?boli=<id>` in the URL. */
export async function loadBoliDrawer(session: CrmSession, boliId: string | undefined): Promise<DrawerLoad> {
  if (!boliId || !isUuid(boliId)) return { ok: true, data: null };
  const { db, center } = session;
  const boliRes = await db
    .from("bolis")
    .select(
      "id, name, kind, event_id, floor_cents, step_cents, opens_at, closes_at, soft_close_minutes, hall_display, explainer_video_url, description, explainer_md, keep_all_entries, status, winner_entry_id, winner_pledge_id, extended_until, closed_reason",
    )
    .eq("id", boliId)
    .eq("center_id", center.id)
    .maybeSingle();
  if (boliRes.error) {
    console.error("[bolis] drawer: loading the boli failed:", boliRes.error);
    return { ok: false, error: `Could not open the boli — ${explainError(boliRes.error)}.` };
  }
  if (!boliRes.data) return { ok: false, error: "Could not open the boli — it was not found, or your role can't see it." };
  const boli = boliRes.data;

  const [event, entriesRes] = await Promise.all([
    boli.event_id ? db.from("events").select("name").eq("id", boli.event_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("boli_entries").select("id, household_id, amount_cents, entered_at, is_in_person, display_name, anonymous").eq("boli_id", boliId),
  ]);
  if (event.error) console.error("[bolis] drawer: event name unavailable:", event.error);

  let entries: DrawerEntry[] | null = null;
  let entriesProblem: string | null = null;
  if (entriesRes.error) {
    console.error("[bolis] drawer: entries unavailable:", entriesRes.error);
    entriesProblem = `Could not load the entries — ${explainError(entriesRes.error)}.`;
  } else {
    const raw = entriesRes.data ?? [];
    const hh = await householdsById(db, raw.map((e) => e.household_id));
    if (hh.error) console.error("[bolis] drawer: household names unavailable:", hh.error);
    entries = rankEntries(raw).map((e) => {
      const h = hh.map.get(e.household_id);
      const family = e.display_name ?? h?.display_name ?? "A family";
      return {
        id: e.id,
        household_id: e.household_id,
        amount_cents: e.amount_cents,
        entered_at: e.entered_at,
        is_in_person: e.is_in_person,
        name: e.anonymous ? `${family} (asked to stay anonymous)` : family,
        household_number: h?.household_number ?? null,
      };
    });
  }

  const list = entries ?? [];
  const lead = leadingEntry(list, boli.winner_entry_id);
  return {
    ok: true,
    data: {
      boli,
      eventName: event.data?.name ?? null,
      entries,
      entriesProblem,
      topCents: lead?.amount_cents ?? null,
      count: list.length,
      minimumCents: nextMinimum(list, boli.floor_cents, boli.step_cents),
      leadingEntryId: lead?.id ?? null,
      otherFamilies: otherInterestedHouseholds(list, boli.winner_entry_id).length,
    },
  };
}
