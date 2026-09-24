import "server-only";

import { chunk } from "@/lib/data/fetch-all";
import type { DbErrorLike } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

export type BoliListRow = {
  id: string;
  name: string;
  kind: string;
  status: string;
  event_id: string | null;
  floor_cents: number;
  closes_at: string | null;
  extended_until: string | null;
  hall_display: boolean;
  created_at: string;
};

export type BoliList = {
  bolis: BoliListRow[];
  bolisError: DbErrorLike | null;
  events: { id: string; name: string }[];
  eventsError: DbErrorLike | null;
  /** Top pledge and entry count per boli; null when entries can't be read. */
  totals: Map<string, { top: number; count: number }> | null;
  totalsError: DbErrorLike | null;
};

export async function loadBoliList(session: CrmSession, kind: "digital" | "in_person"): Promise<BoliList> {
  const { db, center } = session;
  const [bolis, events] = await Promise.all([
    db
      .from("bolis")
      .select("id, name, kind, status, event_id, floor_cents, closes_at, extended_until, hall_display, created_at")
      .eq("center_id", center.id)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(300),
    db.from("events").select("id, name").eq("center_id", center.id).order("starts_at", { ascending: false, nullsFirst: true }).limit(200),
  ]);
  if (events.error) console.error("[bolis] events for the boli list unavailable:", events.error);
  const rows = bolis.data ?? [];
  let totals: Map<string, { top: number; count: number }> | null = new Map();
  let totalsError: DbErrorLike | null = null;
  for (const part of chunk(rows.map((b) => b.id))) {
    const res = await db.from("boli_entries").select("boli_id, amount_cents").in("boli_id", part);
    if (res.error) {
      console.error("[bolis] pledge totals unavailable:", res.error);
      totals = null;
      totalsError = res.error;
      break;
    }
    for (const e of res.data ?? []) {
      const t = totals.get(e.boli_id) ?? { top: 0, count: 0 };
      t.top = Math.max(t.top, e.amount_cents);
      t.count += 1;
      totals.set(e.boli_id, t);
    }
  }
  return {
    bolis: rows,
    bolisError: bolis.error,
    events: events.data ?? [],
    eventsError: events.error,
    totals,
    totalsError,
  };
}
