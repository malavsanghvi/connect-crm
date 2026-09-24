"use server";

import { revalidatePath } from "next/cache";

import type { HouseholdCardData } from "@/components/household-card";
import {
  checkUploadRows,
  householdKey,
  isClosed,
  MAX_UPLOAD_ROWS,
  otherInterestedHouseholds,
  parseCalledAt,
  type CheckedRow,
  type HouseholdMatch,
  type UploadBoli,
  type UploadRow,
} from "@/lib/bolis";
import { householdCards } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { dateInTz } from "@/lib/dates";
import { explainError, failure, type ActionResult } from "@/lib/errors";
import { householdIdsFromResolved, type ResolvedIdentifier } from "@/lib/identifiers";
import { localToUtc } from "@/lib/local-time";
import { formatCents, parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, type CrmSession } from "@/lib/session";

// Founder rule: bolis take "pledges", never "bids".

function refresh() {
  revalidatePath("/bolis");
  revalidatePath("/bolis/upload");
}

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------
type BoliValues = {
  name: string;
  kind: "digital" | "in_person";
  event_id: string | null;
  floor_cents: number;
  step_cents: number;
  opens_at: string | null;
  closes_at: string | null;
  soft_close_minutes: number;
  hall_display: boolean;
  explainer_video_url: string | null;
  description: string | null;
  explainer_md: string | null;
  keep_all_entries: boolean;
};

function boliValues(fd: FormData, tz: string): { ok: true; values: BoliValues } | { ok: false; error: string } {
  const name = text(fd, "name");
  if (!name) return { ok: false, error: "give the boli a name" };
  if (name.length > 160) return { ok: false, error: "the name is longer than 160 characters" };
  const kind = text(fd, "kind") === "in_person" ? "in_person" : "digital";
  const eventId = text(fd, "event_id");
  const floor = parseAmountToCents(text(fd, "floor") || "0");
  if (floor === null || floor < 0) return { ok: false, error: "the floor must be an amount like 101" };
  const step = parseAmountToCents(text(fd, "step") || "0");
  if (step === null || step <= 0) return { ok: false, error: "the step must be more than zero" };
  const opensText = text(fd, "opens_at");
  const closesText = text(fd, "closes_at");
  const opens = opensText ? localToUtc(opensText, tz) : null;
  const closes = closesText ? localToUtc(closesText, tz) : null;
  if (opensText && !opens) return { ok: false, error: "the opening time is not valid" };
  if (closesText && !closes) return { ok: false, error: "the cutoff is not valid" };
  if (opens && closes && closes <= opens) return { ok: false, error: "the cutoff must be after it opens" };
  const softMinutes = Number(text(fd, "soft_close_minutes") || "5");
  const video = text(fd, "explainer_video_url");
  if (video && !/^https?:\/\//i.test(video)) return { ok: false, error: "the explainer video must be a web link (https://…)" };
  return {
    ok: true,
    values: {
      name,
      kind,
      event_id: isUuid(eventId) ? eventId : null,
      floor_cents: floor,
      step_cents: step,
      opens_at: opens,
      closes_at: closes,
      soft_close_minutes: fd.get("soft_close") ? (Number.isInteger(softMinutes) && softMinutes > 0 && softMinutes <= 120 ? softMinutes : 5) : 0,
      hall_display: Boolean(fd.get("hall_display")),
      explainer_video_url: video || null,
      description: text(fd, "description") || null,
      explainer_md: text(fd, "explainer_md") || null,
      keep_all_entries: Boolean(fd.get("keep_all_entries")),
    },
  };
}

export async function saveBoliAction(boliId: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = boliId ? "save the boli" : "create the boli";
  const auth = await authorizeAction("bolisManage", doing);
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const parsed = boliValues(fd, center.time_zone);
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}.` };
  if (boliId) {
    if (!isUuid(boliId)) return { ok: false, error: `Could not ${doing} — unknown boli.` };
    const { data, error } = await db.from("bolis").update(parsed.values).eq("id", boliId).eq("center_id", center.id).select("id");
    if (error) return failure(`Could not ${doing}`, error);
    if (!data?.length) return { ok: false, error: `Could not ${doing} — it was not found, or you can't change it.` };
    refresh();
    return { ok: true, message: "Boli saved." };
  }
  const { error } = await db.from("bolis").insert({ ...parsed.values, center_id: center.id, created_by: userId, status: "draft" });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Boli scheduled · visible to members at publish time" };
}

const STATUS_CHANGE: Record<string, { from: string[]; label: string; done: string }> = {
  open: { from: ["draft", "paused"], label: "publish the boli", done: "Published — pledges are open." },
  paused: { from: ["open"], label: "pause the boli", done: "Paused. Members can't pledge until you resume." },
  draft: { from: ["paused"], label: "move the boli back to draft", done: "Back to draft." },
};

export async function setBoliStatusAction(boliId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const to = text(fd, "status");
  const t = STATUS_CHANGE[to];
  const auth = await authorizeAction("bolisManage", t?.label ?? "change the boli");
  if (!auth.ok) return auth;
  if (!t || !isUuid(boliId)) return { ok: false, error: "Could not change the boli — unknown change." };
  const { data, error } = await auth.session.db
    .from("bolis")
    .update({ status: to })
    .eq("id", boliId)
    .eq("center_id", auth.session.center.id)
    .in("status", t.from)
    .select("id");
  if (error) return failure(`Could not ${t.label}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${t.label} — its status changed meanwhile. Reload and try again.` };
  refresh();
  return { ok: true, message: t.done };
}

export async function setHallDisplayAction(boliId: string, on: boolean): Promise<ActionResult> {
  const doing = on ? "show the boli on the hall display" : "take the boli off the hall display";
  const auth = await authorizeAction("bolisManage", doing);
  if (!auth.ok) return auth;
  if (!isUuid(boliId)) return { ok: false, error: `Could not ${doing} — unknown boli.` };
  const { data, error } = await auth.session.db
    .from("bolis")
    .update({ hall_display: on })
    .eq("id", boliId)
    .eq("center_id", auth.session.center.id)
    .select("id");
  if (error) return failure(`Could not ${doing}`, error);
  if (!data?.length) return { ok: false, error: `Could not ${doing} — the boli was not found.` };
  refresh();
  return { ok: true, message: on ? "Hall display on · live amounts shown on the TV" : "Hall display off" };
}

// ---------------------------------------------------------------------------
// Close (winner becomes a pledge; the reason is stored and audited)
// ---------------------------------------------------------------------------
export async function closeBoliAction(boliId: string, reason: string, early: boolean): Promise<ActionResult> {
  const auth = await authorizeAction("bolisManage", "close the boli");
  if (!auth.ok) return auth;
  if (!isUuid(boliId)) return { ok: false, error: "Could not close the boli — unknown boli." };
  const why = String(reason ?? "").trim();
  if (early && !why) return { ok: false, error: "Could not close the boli early — give a reason. It is kept in the audit log." };
  if (why.length > 500) return { ok: false, error: "Could not close the boli — keep the reason under 500 characters." };
  const { data, error } = await auth.session.db.rpc("close_boli", { p_boli: boliId, p_reason: why || undefined });
  if (error) return failure("Could not close the boli", error);
  refresh();
  revalidatePath("/giving/pledges");
  return {
    ok: true,
    message: data ? "Closed · the top pledge is now a pledge on the household" : "Closed with no pledges.",
  };
}

// ---------------------------------------------------------------------------
// Accommodate others: one draft message per other interested family
// ---------------------------------------------------------------------------
export async function accommodateOthersAction(boliId: string): Promise<ActionResult<{ created: number; skipped: number }>> {
  const doing = "draft offers to the other families";
  const boliAuth = await authorizeAction("bolisManage", doing);
  if (!boliAuth.ok) return boliAuth;
  const auth = await authorizeAction("commsDraft", doing);
  if (!auth.ok) return auth;
  if (!isUuid(boliId)) return { ok: false, error: `Could not ${doing} — unknown boli.` };
  const { db, center, userId } = auth.session;
  const boli = await db.from("bolis").select("id, name, winner_entry_id, event_id").eq("id", boliId).eq("center_id", center.id).maybeSingle();
  if (boli.error) return failure(`Could not ${doing}`, boli.error);
  if (!boli.data) return { ok: false, error: `Could not ${doing} — the boli was not found.` };
  const entries = await db.from("boli_entries").select("id, household_id, amount_cents, entered_at").eq("boli_id", boliId);
  if (entries.error) return failure(`Could not ${doing}`, entries.error);
  const others = otherInterestedHouseholds(entries.data ?? [], boli.data.winner_entry_id);
  if (others.length === 0) return { ok: false, error: `Could not ${doing} — no other family pledged on this boli.` };

  const existing = await db
    .from("comms_campaigns")
    .select("id, audience")
    .eq("center_id", center.id)
    .eq("audience->>boli_id", boliId)
    .in("status", ["draft", "pending_approval", "scheduled", "sending", "sent"]);
  if (existing.error) return failure(`Could not ${doing}`, existing.error);
  const already = new Set(
    (existing.data ?? []).flatMap((c) => {
      const ids = (c.audience as { household_ids?: unknown })?.household_ids;
      return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    }),
  );
  const todo = others.filter((h) => !already.has(h));
  if (todo.length === 0) {
    return { ok: false, error: `Could not ${doing} — every other family already has a draft offer for this boli (Communications → drafts).` };
  }
  const names = await householdCards(db, todo);
  if (names.error) console.error("[bolis] household names for offer drafts unavailable; using a generic greeting:", names.error);
  const rows = todo.map((householdId) => {
    const hh = names.map.get(householdId)?.household_name ?? null;
    return {
      center_id: center.id,
      kind: "appeal",
      name: `Boli · ${boli.data!.name} · similar labh${hh ? ` · ${hh}` : ""}`,
      title: `A labh like ${boli.data!.name}`,
      body_md:
        `${hh ? `Dear ${hh},` : "Jai Jinendra,"}\n\n` +
        `Thank you for pledging for ${boli.data!.name}. Another family's pledge was recorded first, and we would like to offer your family a similar labh. ` +
        `Reply to this message or speak with the religious coordinator.\n\n${center.short_name ?? center.name}`,
      channels: ["email", "push"] as ("email" | "push")[],
      audience: { household_ids: [householdId], boli_id: boliId, source: "boli_accommodate" },
      status: "draft",
      requires_second_approver: false,
      created_by: userId,
    };
  });
  const { error } = await db.from("comms_campaigns").insert(rows);
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/bolis");
  const skipped = others.length - todo.length;
  return {
    ok: true,
    message: `Offer similar labh to ${todo.length} ${todo.length === 1 ? "family" : "families"} · created draft messages${skipped ? ` (${skipped} already had one)` : ""}`,
    data: { created: todo.length, skipped },
  };
}

// ---------------------------------------------------------------------------
// In-person pledges, one by one
// ---------------------------------------------------------------------------
export async function recordInPersonPledgeAction(boliId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("bolisRecord", "record the pledge");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  if (!isUuid(boliId)) return { ok: false, error: "Could not record the pledge — unknown boli." };
  const householdId = text(fd, "household_id");
  if (!isUuid(householdId)) return { ok: false, error: "Could not record the pledge — find and choose the family first." };
  const amount = parseAmountToCents(text(fd, "amount"));
  if (amount === null || amount <= 0) return { ok: false, error: "Could not record the pledge — enter the pledge amount, like 151." };
  const boli = await db.from("bolis").select("id, kind, status, floor_cents").eq("id", boliId).eq("center_id", center.id).maybeSingle();
  if (boli.error) return failure("Could not record the pledge", boli.error);
  if (!boli.data) return { ok: false, error: "Could not record the pledge — the boli was not found, or you can't see it." };
  if (boli.data.kind !== "in_person") return { ok: false, error: "Could not record the pledge — members pledge on digital bolis in the app." };
  if (isClosed(boli.data.status)) return { ok: false, error: "Could not record the pledge — this boli is closed." };
  if (amount < boli.data.floor_cents) {
    return { ok: false, error: `Could not record the pledge — it is below the floor (${formatCents(boli.data.floor_cents, center.currency)}).` };
  }
  const { error } = await db.from("boli_entries").insert({
    center_id: center.id,
    boli_id: boliId,
    household_id: householdId,
    amount_cents: amount,
    entered_by: userId,
    is_in_person: true,
    display_name: text(fd, "display_name") || null,
    anonymous: Boolean(fd.get("anonymous")),
  });
  if (error) return failure("Could not record the pledge", error);
  refresh();
  return { ok: true, message: `Pledge of ${formatCents(amount, center.currency)} recorded.` };
}

export type BoliHouseholdFind = { cards: HouseholdCardData[]; hits: ResolvedIdentifier[]; more: boolean };

/** Household search for boli recorders (every hit is a household card, never a bare name). */
export async function findBoliHouseholdsAction(query: string): Promise<ActionResult<BoliHouseholdFind>> {
  const auth = await authorizeAction("bolisRecord", "search households");
  if (!auth.ok) return auth;
  const q = String(query ?? "").trim();
  if (q.length < 2) return { ok: false, error: "Type at least 2 characters — a name or a member or household ID." };
  if (q.length > 120) return { ok: false, error: "That search is too long." };
  const { db, center } = auth.session;
  const found = await searchHouseholds(db, center.id, q, { limit: 60 });
  if (found.error && found.householdIds.length === 0) return failure("Could not search households", found.error);
  const ids = found.householdIds.slice(0, 12);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0) return failure("Could not load the household details", cards.error);
  return {
    ok: true,
    data: {
      cards: ids.map((id) => cards.map.get(id)).filter((c): c is HouseholdCardData => !!c),
      hits: found.identifierMatches,
      more: found.householdIds.length > 12,
    },
  };
}

// ---------------------------------------------------------------------------
// In-person upload: validate, then import
// ---------------------------------------------------------------------------
function cleanRows(input: unknown): UploadRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_UPLOAD_ROWS) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 300) : "");
  return input.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      row: Number.isInteger(o.row) ? Number(o.row) : i + 2,
      boli: str(o.boli),
      event: str(o.event),
      household: str(o.household),
      amountText: str(o.amountText),
      calledAt: str(o.calledAt),
    };
  });
}

async function uploadLookups(
  session: CrmSession,
  rows: UploadRow[],
): Promise<{ ok: true; bolis: UploadBoli[]; households: Map<string, HouseholdMatch>; dates: Map<string, string> } | { ok: false; error: string }> {
  const { db, center } = session;
  const bolisRes = await db
    .from("bolis")
    .select("id, name, kind, status, event_id, floor_cents, closes_at, opens_at")
    .eq("center_id", center.id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (bolisRes.error) return failure("Could not check the file — the bolis could not be loaded", bolisRes.error);
  const bolis = bolisRes.data ?? [];
  const eventIds = [...new Set(bolis.map((b) => b.event_id).filter((x): x is string => !!x))];
  const events = eventIds.length ? await db.from("events").select("id, name, starts_at").in("id", eventIds.slice(0, 150)) : { data: [], error: null };
  if (events.error) return failure("Could not check the file — the events could not be loaded", events.error);
  const eventById = new Map((events.data ?? []).map((e) => [e.id, e]));
  const openIds = bolis.filter((b) => !isClosed(b.status) && b.kind === "in_person").map((b) => b.id);
  const tops = new Map<string, number>();
  if (openIds.length) {
    const entries = await db.from("boli_entries").select("boli_id, amount_cents").in("boli_id", openIds.slice(0, 150));
    if (entries.error) return failure("Could not check the file — pledges already recorded could not be loaded", entries.error);
    for (const e of entries.data ?? []) tops.set(e.boli_id, Math.max(tops.get(e.boli_id) ?? 0, e.amount_cents));
  }
  const dates = new Map<string, string>();
  for (const b of bolis) {
    const when = b.closes_at ?? (b.event_id ? eventById.get(b.event_id)?.starts_at : null) ?? b.opens_at;
    if (when) dates.set(b.id, dateInTz(when, center.time_zone));
  }

  // Households: any identifier first (household or member number, org IDs),
  // then an exact household name. A name alone must be unique.
  const households = new Map<string, HouseholdMatch>();
  const wanted = [...new Set(rows.map((r) => r.household).filter(Boolean))];
  const resolved = new Map<string, string[]>();
  let lookupError: unknown = null;
  await Promise.all(
    wanted.map(async (value) => {
      const res = await db.rpc("resolve_identifier", { p_center: center.id, p_value: value });
      if (res.error) {
        lookupError ??= res.error;
        return;
      }
      const hits = (res.data ?? []).map((h) => ({ ...h, household_id: h.household_id ?? null })) as ResolvedIdentifier[];
      const ids = householdIdsFromResolved(hits);
      if (ids.length > 0) {
        resolved.set(value, ids);
        return;
      }
      const escaped = value.replace(/[\\%_]/g, (c) => `\\${c}`);
      const byName = await db
        .from("households")
        .select("id")
        .eq("center_id", center.id)
        .is("merged_into_id", null)
        .ilike("display_name", escaped)
        .limit(5);
      if (byName.error) {
        lookupError ??= byName.error;
        return;
      }
      if ((byName.data ?? []).length > 0) resolved.set(`name:${value}`, byName.data!.map((h) => h.id));
    }),
  );
  if (lookupError) {
    return { ok: false, error: `Could not check the households in the file — ${explainError(lookupError)}. Looking up families needs people.view or giving.view.` };
  }
  const single = [...resolved.values()].filter((ids) => ids.length === 1).map((ids) => ids[0]);
  const cards = await householdCards(session.db, single);
  if (cards.error) console.error("[bolis] household cards for the upload check unavailable; showing names only:", cards.error);
  for (const value of wanted) {
    const byId = resolved.get(value);
    const byName = resolved.get(`name:${value}`);
    const ids = byId ?? byName;
    if (!ids) households.set(householdKey(value), { status: "not_found" });
    else if (ids.length > 1) households.set(householdKey(value), { status: "ambiguous", count: ids.length });
    else {
      const c = cards.map.get(ids[0]);
      const label = c
        ? [c.household_name ?? "Household", c.household_number, c.org_household_id, c.city].filter(Boolean).join(" · ")
        : "Household";
      households.set(householdKey(value), { status: "found", household_id: ids[0], label, byName: !byId });
    }
  }

  return {
    ok: true,
    dates,
    households,
    bolis: bolis.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      status: b.status,
      event_id: b.event_id,
      event_name: b.event_id ? (eventById.get(b.event_id)?.name ?? null) : null,
      floor_cents: b.floor_cents,
      top_cents: tops.get(b.id) ?? null,
    })),
  };
}

export async function validateBoliUploadAction(input: unknown): Promise<ActionResult<CheckedRow[]>> {
  const auth = await authorizeAction("bolisManage", "check the file");
  if (!auth.ok) return auth;
  const rows = cleanRows(input);
  if (!rows) return { ok: false, error: `Could not check the file — it needs between 1 and ${MAX_UPLOAD_ROWS} rows.` };
  const look = await uploadLookups(auth.session, rows);
  if (!look.ok) return look;
  return { ok: true, data: checkUploadRows(rows, look.bolis, look.households, auth.session.center.currency) };
}

export type ImportOutcome = { created: number; skipped: number; failed: { row: number; reason: string }[] };

/**
 * Re-check every row on the server, then for each valid row record the
 * in-person entry and close the boli with app.close_boli — the same RPC the
 * coordinator uses — so the winner becomes a pledge on the household and the
 * close is audited with the reason.
 */
export async function importBoliUploadAction(input: unknown, fileName: string): Promise<ActionResult<ImportOutcome>> {
  const auth = await authorizeAction("bolisManage", "import the in-person bolis");
  if (!auth.ok) return auth;
  const rows = cleanRows(input);
  if (!rows) return { ok: false, error: `Could not import — the file needs between 1 and ${MAX_UPLOAD_ROWS} rows.` };
  const look = await uploadLookups(auth.session, rows);
  if (!look.ok) return look;
  const { db, center, userId } = auth.session;
  const checked = checkUploadRows(rows, look.bolis, look.households, center.currency);
  const valid = checked.filter((r) => r.ok);
  if (valid.length === 0) return { ok: false, error: "Could not import — no row passed the checks. Fix the file and upload it again." };
  const reason = `In-person result imported from ${String(fileName ?? "a file").slice(0, 120) || "a file"}`;
  const failed: { row: number; reason: string }[] = [];
  let created = 0;
  for (const r of valid) {
    const local = parseCalledAt(r.calledAt, look.dates.get(r.boli_id!) ?? dateInTz(new Date(), center.time_zone));
    const enteredAt = local ? localToUtc(local, center.time_zone) : null;
    const entry = await db
      .from("boli_entries")
      .insert({
        center_id: center.id,
        boli_id: r.boli_id!,
        household_id: r.household_id!,
        amount_cents: r.amount_cents!,
        entered_by: userId,
        is_in_person: true,
        ...(enteredAt ? { entered_at: enteredAt } : {}),
      })
      .select("id")
      .single();
    if (entry.error) {
      console.error(`[bolis] upload row ${r.row}: recording the entry failed:`, entry.error);
      failed.push({ row: r.row, reason: `the pledge could not be recorded — ${explainError(entry.error)}` });
      continue;
    }
    const closed = await db.rpc("close_boli", { p_boli: r.boli_id!, p_reason: reason });
    if (closed.error) {
      console.error(`[bolis] upload row ${r.row}: closing the boli failed:`, closed.error);
      failed.push({
        row: r.row,
        reason: `the pledge was recorded on the boli but the boli could not be closed — ${explainError(closed.error)}. Close it from its drawer.`,
      });
      continue;
    }
    created += 1;
  }
  refresh();
  revalidatePath("/giving/pledges");
  const skipped = checked.length - created;
  if (created === 0) {
    return { ok: false, error: `Could not import — none of the ${valid.length} valid rows went through. ${failed[0] ? `Row ${failed[0].row}: ${failed[0].reason}` : ""}`.trim() };
  }
  return {
    ok: true,
    message: `${created} ${created === 1 ? "pledge" : "pledges"} created · ${skipped} ${skipped === 1 ? "row" : "rows"} skipped`,
    data: { created, skipped, failed },
  };
}
