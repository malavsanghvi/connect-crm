// What the review screen reads from a stored matching run (0630-0632), as the signed-in person: the imports (resolve_runs), the
// chosen run's inbox (resolve_inbox), the item behind each card (resolve_item_detail), the links made without a question and
// the payment rows for the totals (import_record_links and import_staged_records, which RLS limits to the runs this person may
// use). Each part that fails says so in plain English; the rest of the screen still draws. A child's row never leaves the
// database here: the record query asks for adults only, and the payment query reads no names at all.

import { failure } from "@/lib/errors";
import { cardGroups, chooseRun, type AutoLinkRaw, type GiftRow, type RunChoice, type Section, type StagedName, type TotalsState } from "@/lib/onboarding-review/review";
import { loadInbox, loadItemDetail, loadRuns, resolveDbOf, type StoreResult } from "@/lib/onboarding/resolve/store";
import type { InboxGroup, InboxView, ItemDetail, RunRow } from "@/lib/onboarding/resolve/views";

type DbError = { message?: string; code?: string } | null;
type Res = PromiseLike<{ data: unknown; error: DbError; count?: number | null }>;
type Query = Res & {
  eq(column: string, value: string | boolean): Query;
  in(column: string, values: readonly string[]): Query;
  order(column: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  range(from: number, to: number): Query;
};
/** The few reads this module makes, without the client's generic types (JSON paths in a select do not type-check). */
type ReadClient = { from(table: string): { select(columns: string, opts?: { count?: "exact" }): Query } };

const PAGE = 1000;
/** More payment rows than this are not added up on the page (Data import adds them up when the file is loaded). */
export const MAX_GIFT_ROWS = 50_000;
const AUTO_SHOWN = 8;

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The payment rows of a run, page by page: what happens to each and its amount in cents. No names, no contact details. */
export async function loadGiftRows(client: unknown, runId: string): Promise<TotalsState> {
  const c = client as ReadClient;
  const rows: GiftRow[] = [];
  for (let from = 0; from < MAX_GIFT_ROWS; from += PAGE) {
    const res = await c
      .from("import_staged_records")
      .select("status, how, minor, cents:normalized->gift->cents, problem:normalized->gift->>problem")
      .eq("run_id", runId)
      .eq("kind", "gift")
      .order("order_no")
      .range(from, from + PAGE - 1);
    if (res.error) return { state: "error", error: failure("Could not add up the payments in this file", res.error).error };
    const page = Array.isArray(res.data) ? res.data : [];
    for (const raw of page) {
      const r = rec(raw);
      const cents = int(r.cents);
      rows.push({ status: str(r.status), how: str(r.how), minor: r.minor === true, cents: cents !== null && Number.isSafeInteger(cents) ? cents : null, problem: str(r.problem) });
    }
    if (page.length < PAGE) return rows.length === 0 ? { state: "none" } : { state: "rows", rows, capped: false };
  }
  return { state: "rows", rows: [], capped: true };
}

/** The links the engine made by itself (tier A, households and people), strongest first, and the adults they join. */
export async function loadAutoLinks(client: unknown, runId: string): Promise<Section<{ count: number; links: AutoLinkRaw[]; records: StagedName[] }>> {
  const c = client as ReadClient;
  const res = await c
    .from("import_record_links")
    .select("a, b, relation, evidence", { count: "exact" })
    .eq("run_id", runId)
    .eq("tier", "A")
    .in("relation", ["same_household", "same_person"])
    .order("score", { ascending: false })
    .limit(AUTO_SHOWN);
  if (res.error) return failure("Could not list the links Weaver made by itself", res.error);
  const links: AutoLinkRaw[] = (Array.isArray(res.data) ? res.data : []).map((raw) => {
    const r = rec(raw);
    return { a: String(r.a ?? ""), b: String(r.b ?? ""), relation: String(r.relation ?? ""), evidence: r.evidence };
  });
  const count = typeof res.count === "number" ? res.count : links.length;
  const ids = [...new Set(links.flatMap((l) => [l.a, l.b]))].filter(Boolean);
  if (ids.length === 0) return { ok: true, data: { count, links, records: [] } };
  const recs = await c
    .from("import_staged_records")
    .select("id, row_no, source, source_kind, minor, name:raw->>name, first_name:raw->>firstName, last_name:raw->>lastName, existing_number:raw->existing->>number, ids:raw->ids")
    .eq("run_id", runId)
    .eq("minor", false)
    .in("id", ids);
  if (recs.error) return failure("Could not list the links Weaver made by itself", recs.error);
  const records: StagedName[] = (Array.isArray(recs.data) ? recs.data : []).map((raw) => {
    const r = rec(raw);
    const idMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(rec(r.ids))) if (typeof v === "string" && v) idMap[k] = v;
    return {
      id: String(r.id ?? ""),
      rowNo: int(r.row_no) ?? 0,
      source: str(r.source) ?? "",
      sourceKind: str(r.source_kind),
      // Asked for adults only; kept as a second guard.
      minor: r.minor === true,
      name: str(r.name),
      firstName: str(r.first_name),
      lastName: str(r.last_name),
      existingNumber: str(r.existing_number),
      ids: idMap,
    };
  });
  return { ok: true, data: { count, links, records } };
}

/** The item behind each card, in order. The first that cannot be opened stops the section with its sentence. */
export async function loadCards(client: unknown, view: InboxView): Promise<Section<{ group: InboxGroup; detail: ItemDetail }[]>> {
  const db = resolveDbOf(client);
  const groups = cardGroups(view);
  const results = await Promise.all(groups.map((g) => loadItemDetail(db, g.nextItemId as string)));
  const out: { group: InboxGroup; detail: ItemDetail }[] = [];
  for (let i = 0; i < groups.length; i++) {
    const r = results[i];
    if (!r.ok) return { ok: false, error: r.error };
    out.push({ group: groups[i], detail: r.data });
  }
  return { ok: true, data: out };
}

export type ReviewLoad =
  | { state: "denied" }
  | { state: "error"; error: string }
  | { state: "choice"; choice: Extract<RunChoice, { kind: "empty" }> }
  | { state: "ready"; run: RunRow; inbox: InboxView; cards: Awaited<ReturnType<typeof loadCards>>; gifts: TotalsState; auto: Awaited<ReturnType<typeof loadAutoLinks>> };

const asError = <T>(r: Extract<StoreResult<T>, { ok: false }>): ReviewLoad => (r.denied ? { state: "denied" } : { state: "error", error: r.error });

/** Everything the review screen needs for the newest checked import (or the one asked for). */
export async function loadReview(client: unknown, centerId: string, wanted: string | null): Promise<ReviewLoad> {
  const db = resolveDbOf(client);
  const runs = await loadRuns(db, centerId);
  if (!runs.ok) return asError(runs);
  const choice = chooseRun(runs.data, wanted);
  if (choice.kind === "empty") return { state: "choice", choice };
  const inbox = await loadInbox(db, choice.run.id);
  if (!inbox.ok) return asError(inbox);
  if (inbox.data.status !== "ready") return { state: "choice", choice: { kind: "empty", reason: inbox.data.status === "storing" ? "busy" : "unchecked", run: choice.run } };
  const [cards, gifts, auto] = await Promise.all([loadCards(client, inbox.data), loadGiftRows(client, choice.run.id), loadAutoLinks(client, choice.run.id)]);
  return { state: "ready", run: choice.run, inbox: inbox.data, cards, gifts, auto };
}
